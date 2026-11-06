import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../db.js';
import { requireAuth } from '../auth.js';
import { sendChunkToChannel, getChunkSize } from '../telegram.js';
import { purgeFile } from './drive.js';
import { copySavedMediaToChannel, sendFileToChannel, rawChannelId, getMessageThumb } from '../mtproto.js';
import { serveFileStream } from '../stream.js';

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgstore-'));
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, 'upload.bin'),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB per file
});

/** POST /upload  (multipart: file, categoryId, folderId, name, mime) */
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const filePath = req.file.path;
  const dir = path.dirname(filePath);
  const user = db.getUserById(req.userId);
  try {
    const name = String(req.body?.name || req.file.originalname || 'untitled');
    const mime = String(req.body?.mime || req.file.mimetype || 'application/octet-stream');
    // E2EE (zero-knowledge): the client may send an armored encrypted-metadata
    // string ("TGS1:…") as `name`. It is persisted verbatim in our DB, but the
    // Telegram-facing filename/caption must stay neutral so nothing readable
    // ever reaches Telegram.
    const isEncrypted = name.startsWith('TGS1:');
    const tgName = isEncrypted ? 'file.bin' : name;
    const categoryId =
      req.body?.categoryId && req.body.categoryId !== 'null'
        ? Number(req.body.categoryId)
        : null;
    const folderId =
      req.body?.folderId && req.body.folderId !== 'null' ? Number(req.body.folderId) : null;
    const size = req.file.size;

    console.log(
      `[files/upload] user=${req.userId} phone=${user?.mt_phone || 'n/a'} ` +
      `name="${name}" mime=${mime} size=${size} categoryId=${categoryId} folderId=${folderId}`
    );

    // Validate category is owned by this user
    const category = categoryId != null ? db.getCategory(categoryId, req.userId) : null;
    if (categoryId != null && !category) {
      return res.status(404).json({ error: 'Target category not found' });
    }

    // Validate folder exists and belongs to same category
    let folder = null;
    if (folderId != null) {
      folder = db.getFolder(folderId, req.userId);
      if (!folder) return res.status(404).json({ error: 'Target folder not found' });
      if (categoryId != null && folder.category_id !== categoryId) {
        return res.status(400).json({ error: 'Folder must belong to the selected category' });
      }
    }

    const chunks = [];
    let channelMessageId = 0;

    if (category && category.channel_id && category.access_hash) {
      // ================= USER-account path (MTProto) =================
      // The file is posted into the USER's own channel as a reply to the
      // folder marker message (folder.channel_message_id).
      const replyTo = folder ? Number(folder.channel_message_id || 0) : 0;
      console.log(
        `[files/upload] posting to USER channel ${category.channel_id} ` +
        `accessHash=${category.access_hash} replyToFolderMarker=${replyTo || 'none'}`
      );
      const result = await sendFileToChannel(req.userId, category.channel_id, category.access_hash, {
        file: filePath, // stream from disk — memory-safe for large files
        filename: tgName,
        mime,
        fileSize: size,
        replyToMessageId: replyTo,
        caption: `📎 ${tgName}`,
      });
      console.log(
        `[files/upload] stored in USER channel messageId=${result.messageId} mediaId=${result.fileId}`
      );
      chunks.push({
        chatId: rawChannelId(category.channel_id), // raw MTProto channel id for downloads
        messageId: result.messageId,
        tgFileId: result.fileId || '',
        size,
      });
      channelMessageId = result.messageId;
    } else {
      // ================= Legacy fallback (Bot API) =================
      // Only reached when there is no user category channel (older categories
      // without accessHash, or category-less uploads).
      console.log(
        '[files/upload] no user category channel available — falling back to Bot API storage channel'
      );
      const targetChannelId = category?.channel_id || process.env.STORAGE_CHANNEL_ID;
      if (!targetChannelId) {
        return res.status(400).json({ error: 'No storage channel configured' });
      }
      const chunkSize = getChunkSize();
      const total = Math.max(1, Math.ceil(size / chunkSize));
      const fd = await fs.promises.open(filePath, 'r');
      try {
        for (let idx = 0; idx < total; idx++) {
          const start = idx * chunkSize;
          const length = Math.min(chunkSize, size - start);
          const buf = Buffer.alloc(length);
          await fd.read(buf, 0, length, start);
          const stored = await sendChunkToChannel(buf, idx, total, tgName, targetChannelId);
          chunks.push(stored);
          if (idx === 0) channelMessageId = stored.messageId;
        }
      } finally {
        await fd.close();
      }
    }

    const id = db.insertFile(req.userId, categoryId, folderId, name, mime, size, chunks, channelMessageId);
    console.log(
      `[files/upload] saved fileId=${id} user=${req.userId} chunks=${chunks.length} ` +
      `channelMessageId=${channelMessageId}`
    );
    res.status(201).json({ file: db.getFile(id, req.userId) });
  } catch (err) {
    console.error('[files/upload] FAILED:', err?.message || err);
    res
      .status(err?.status || 502)
      .json({ error: `Upload to Telegram failed: ${err?.message || err}` });
  } finally {
    // Clean up the temp upload file on success AND failure.
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

/** POST /upload-from-saved — copy media from Saved Messages to a folder */
router.post('/upload-from-saved', requireAuth, async (req, res) => {
  try {
    const { savedMessageId, categoryId: catId, folderId: folId, name, mime, size } = req.body || {};
    if (!savedMessageId) return res.status(400).json({ error: 'savedMessageId is required' });

    const categoryId = catId && catId !== 'null' ? Number(catId) : null;
    const folderId = folId && folId !== 'null' ? Number(folId) : null;

    // Validate category exists and belongs to this user
    const category = categoryId != null ? db.getCategory(categoryId, req.userId) : null;
    if (categoryId != null && !category) {
      return res.status(404).json({ error: 'Target category not found' });
    }

    // Validate folder exists and belongs to same category
    if (folderId != null) {
      const folder = db.getFolder(folderId, req.userId);
      if (!folder) return res.status(404).json({ error: 'Target folder not found' });
      if (categoryId != null && folder.category_id !== categoryId) {
        return res.status(400).json({ error: 'Folder must belong to the selected category' });
      }
    }

    if (!category || !category.channel_id || !category.access_hash) {
      return res.status(400).json({
        error: 'Category has no usable Telegram channel (missing accessHash). Recreate the category.'
      });
    }

    console.log(
      `[files/upload-from-saved] user=${req.userId} savedMessageId=${savedMessageId} ` +
      `channel=${category.channel_id} accessHash=${category.access_hash} folderId=${folderId}`
    );

    // Copy media from Saved Messages to the USER's category channel
    const result = await copySavedMediaToChannel(
      req.userId,
      savedMessageId,
      category.channel_id,
      category.access_hash,
      name || 'Saved Media'
    );

    const chunks = [{
      chatId: rawChannelId(category.channel_id),
      messageId: result.messageId,
      tgFileId: result.fileId || '',
      size: Number(size || 0),
    }];

    const id = db.insertFile(
      req.userId,
      categoryId,
      folderId,
      name || 'Saved Media',
      mime || 'application/octet-stream',
      Number(size || 0),
      chunks,
      result.messageId
    );
    console.log(
      `[files/upload-from-saved] saved fileId=${id} messageId=${result.messageId} user=${req.userId}`
    );

    res.status(201).json({ file: db.getFile(id, req.userId) });
  } catch (err) {
    console.error('[files/upload-from-saved] FAILED:', err?.message || err);
    res
      .status(err?.status || 502)
      .json({ error: `Upload from Saved Messages failed: ${err?.message || err}` });
  }
});

router.patch('/:id', requireAuth, (req, res) => {
  const file = db.getFile(Number(req.params.id), req.userId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const { name, starred, trashed, folderId } = req.body || {};
  const fields = {};
  if (typeof name === 'string' && name.trim()) fields.name = name.trim();
  if (starred !== undefined) fields.starred = starred ? 1 : 0;
  if (trashed !== undefined) fields.trashed = trashed ? 1 : 0;
  if (folderId !== undefined) {
    const target = folderId == null ? null : Number(folderId);
    if (target != null && !db.getFolder(target, req.userId))
      return res.status(404).json({ error: 'Target folder not found' });
    fields.folder_id = target;
  }
  db.updateFile(file.id, req.userId, fields);
  res.json({ file: db.getFile(file.id, req.userId) });
});

/** DELETE /api/files/:id — permanent delete (removes stored Telegram messages). */
router.delete('/:id', requireAuth, async (req, res) => {
  const file = db.getFile(Number(req.params.id), req.userId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  await purgeFile(file, req.userId);
  res.json({ ok: true });
});

function handleStream(req, res, asAttachment) {
  const file = db.getFile(Number(req.params.id), req.userId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const chunks = db.getChunks(file.id);
  if (!chunks.length) return res.status(404).json({ error: 'File has no stored data' });
  // Streaming now runs through the USER's own Telegram session for files stored
  // in the user's channels (private channels + fresh file references require it).
  serveFileStream(chunks, file, req, res, { asAttachment, userId: req.userId });
}

router.get('/:id/download', requireAuth, (req, res) => handleStream(req, res, true));
router.get('/:id/raw', requireAuth, (req, res) => handleStream(req, res, false));

/**
 * GET /:id/thumb — small JPEG preview for images/videos stored via the USER's
 * session. Telegram embeds a tiny thumbnail inside every media message; we
 * fetch it instead of the full file. Falls back to a redirect to /raw when
 * no thumbnail exists (e.g. tiny files, or media without previews).
 */
router.get('/:id/thumb', requireAuth, async (req, res) => {
  const file = db.getFile(Number(req.params.id), req.userId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const isMedia = /^image\//.test(file.mime || '') || /^video\//.test(file.mime || '');
  if (!isMedia) return res.status(404).json({ error: 'No thumbnail available' });

  // For small-to-medium images (under 2.5 MB), redirect straight to /raw for
  // exact original full-resolution sharpness — zero blur, fast download.
  if (/^image\//.test(file.mime || '') && file.size > 0 && file.size <= 2.5 * 1024 * 1024) {
    return res.redirect(302, `/api/files/${file.id}/raw`);
  }

  const chunks = db.getChunks(file.id);
  const c = chunks?.[0];
  const isMT = /^\d+$/.test(String(c?.tg_file_id || ''));
  if (!c || !isMT) return res.redirect(302, `/api/files/${file.id}/raw`);

  try {
    const accessHash = file.category_id
      ? db.getCategory(file.category_id, req.userId)?.access_hash || null
      : null;
    const jpeg = await getMessageThumb(req.userId, c.chat_id, c.message_id, accessHash);
    if (!jpeg) return res.redirect(302, `/api/files/${file.id}/raw`);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(jpeg);
  } catch (err) {
    console.error(`[files/thumb] file ${file.id} user ${req.userId}:`, err?.message || err);
    if (!res.headersSent) res.redirect(302, `/api/files/${file.id}/raw`);
  }
});



export default router;
