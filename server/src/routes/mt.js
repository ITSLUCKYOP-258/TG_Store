import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { upsertTelegramUser, getUserById, listCategories } from '../db.js';
import { requireAuth, clientIp } from '../auth.js';
import { finishLogin } from './auth.js';
import { resolveMime } from '../mime.js';
import {
  isConfigured,
  startLoginFlow,
  verifyLoginCode,
  verifyLoginPassword,
  saveUserSession,
  disconnectUser,
  listDialogs,
  listMedia,
  getMessage,
  getMessageThumb,
  downloadBytes,
  getSavedMessagesId,
  copySavedMediaToChannel,
} from '../mtproto.js';

const router = Router();

function errorStatus(err) {
  return err.status || 502;
}

/** Tiny in-memory rate limiter (per key) — protects OTP sending / guessing. */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length > max;
}

/**
 * Complete MT login: link the Telegram account to ONE local user (keyed by the
 * Telegram id) + open a device session. Logging in again from another phone /
 * browser returns the SAME user — only a new device session is added.
 */
async function completeLogin(req, res, me, session) {
  const user = upsertTelegramUser({
    id: me.id,
    first_name: me.firstName,
    last_name: me.lastName,
    username: me.username,
    phone: me.phone,
    photo_url: '',
  });
  if (user.banned) {
    const err = new Error('This account has been blocked.');
    err.status = 403;
    throw err;
  }
  await saveUserSession(user.id, session, me.phone);
  return finishLogin(req, res, user, 'telegram-phone');
}

/* ---------- login flow (no auth) ---------- */
router.get('/config', (_req, res) => {
  res.json({ enabled: isConfigured() });
});

router.post('/send-code', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').replace(/[\s()-]/g, '');
    if (limited(`send:${clientIp(req)}`, 8, 10 * 60_000) || limited(`sendp:${phone}`, 5, 10 * 60_000)) {
      return res.status(429).json({ error: 'Too many code requests — wait a few minutes and try again.' });
    }
    if (!/^\+?\d{8,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter phone in international format, e.g. +911234567890' });
    }
    const result = await startLoginFlow(phone.startsWith('+') ? phone : `+${phone}`);
    res.json(result);
  } catch (err) {
    res.status(errorStatus(err)).json({ error: err.message });
  }
});

router.post('/verify-code', async (req, res) => {
  try {
    if (limited(`verify:${clientIp(req)}`, 20, 10 * 60_000)) {
      return res.status(429).json({ error: 'Too many attempts — wait a few minutes and try again.' });
    }
    const result = await verifyLoginCode(String(req.body?.flowId), String(req.body?.code || '').replace(/\s/g, ''));
    if (result.needPassword) return res.json({ needPassword: true });
    res.json(await completeLogin(req, res, result.me, result.session));
  } catch (err) {
    res.status(errorStatus(err)).json({ error: err.message });
  }
});

router.post('/verify-password', async (req, res) => {
  try {
    if (limited(`pwd:${clientIp(req)}`, 10, 10 * 60_000)) {
      return res.status(429).json({ error: 'Too many attempts — wait a few minutes and try again.' });
    }
    const result = await verifyLoginPassword(String(req.body?.flowId), String(req.body?.password || ''));
    res.json(await completeLogin(req, res, result.me, result.session));
  } catch (err) {
    res.status(errorStatus(err)).json({ error: err.message });
  }
});

/* ---------- authenticated: browse own Telegram ---------- */
router.get('/status', requireAuth, async (req, res) => {
  const user = getUserById(req.userId);
  res.json({ connected: Boolean(user?.mt_session), phone: user?.mt_phone || null, tgId: user?.tg_id || null });
});

router.post('/disconnect', requireAuth, async (req, res) => {
  await disconnectUser(req.userId);
  res.json({ ok: true });
});

router.get('/dialogs', requireAuth, async (req, res) => {
  try {
    res.json({ dialogs: await listDialogs(req.userId) });
  } catch (err) {
    res.status(errorStatus(err)).json({ error: err.message });
  }
});

router.get('/media', requireAuth, async (req, res) => {
  try {
    const chatId = String(req.query.chat || '');
    const filter = String(req.query.filter || 'all');
    if (!chatId) return res.status(400).json({ error: 'chat is required' });
    res.json({ media: await listMedia(req.userId, chatId, filter) });
  } catch (err) {
    res.status(errorStatus(err)).json({ error: err.message });
  }
});

/* ---------- streaming download of a media message ---------- */
async function serve(req, res, asAttachment) {
  try {
    const { client, info, loc } = (await getMessage(req.userId, req.params.chat, req.params.msg)) || {};
    if (!client) return res.status(404).json({ error: 'Media not found' });
    const size = loc.size;
    const baseHeaders = {
      'Content-Type': resolveMime(info.name, info.mime),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(info.name)}`,
    };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m && size > 0) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start == null) {
        start = Math.max(0, size - (end ?? 0));
        end = size - 1;
      } else if (end == null || end >= size) end = size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
      return pipeline(
        Readable.from(downloadBytes(client, loc.location, { start, end })),
        res
      ).catch(() => res.end());
    }
    if (size > 0) res.writeHead(200, { ...baseHeaders, 'Content-Length': size });
    else res.writeHead(200, baseHeaders);
    return pipeline(Readable.from(downloadBytes(client, loc.location)), res).catch(() => res.end());
  } catch (err) {
    if (!res.headersSent) res.status(errorStatus(err)).json({ error: err.message });
  }
}

router.get('/media/:chat/:msg/download', requireAuth, (req, res) => serve(req, res, true));
router.get('/media/:chat/:msg/raw', requireAuth, (req, res) => serve(req, res, false));

/**
 * GET /media/:chat/:msg/thumb — small JPEG preview Telegram embeds inside
 * image/video messages. Used by the Saved Messages grid (and any other
 * Telegram-backed media listing).
 */
router.get('/media/:chat/:msg/thumb', requireAuth, async (req, res) => {
  try {
    const jpeg = await getMessageThumb(req.userId, req.params.chat, req.params.msg);
    if (!jpeg) return res.status(404).json({ error: 'No thumbnail available' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(jpeg);
  } catch (err) {
    if (!res.headersSent) res.status(errorStatus(err)).json({ error: err.message });
  }
});

/* ---------- Saved Messages ---------- */
router.get('/saved-messages', requireAuth, async (req, res) => {
  try {
    const filter = String(req.query.filter || 'all');
    const savedId = await getSavedMessagesId(req.userId);
    const media = await listMedia(req.userId, savedId, filter);
    res.json({ media });
  } catch (err) {
    res.status(errorStatus(err)).json({ error: err.message });
  }
});

/** Copy media from Saved Messages to a category channel */
router.post('/saved-messages/copy', requireAuth, async (req, res) => {
  try {
    const { savedMessageId, channelId, caption } = req.body || {};
    if (!savedMessageId) return res.status(400).json({ error: 'savedMessageId is required' });
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    // Resolve the access hash server-side from the user's own categories —
    // never trust client-supplied secrets.
    const cat = listCategories(req.userId).find(
      (c) =>
        c.channel_id === String(channelId) ||
        `-100${c.channel_id}` === String(channelId)
    );
    if (!cat || !cat.access_hash) {
      return res.status(400).json({
        error:
          'This endpoint only works for your own category channels (access hash not found). ' +
          'Use POST /api/files/upload-from-saved instead.'
      });
    }

    const result = await copySavedMediaToChannel(
      req.userId,
      savedMessageId,
      cat.channel_id,
      cat.access_hash,
      caption || ''
    );
    console.log(
      `[mt] saved-messages/copy user=${req.userId} channel=${cat.channel_id} ` +
      `messageId=${result.messageId}`
    );
    res.json({ messageId: result.messageId, fileId: result.fileId });
  } catch (err) {
    res.status(errorStatus(err)).json({ error: err.message });
  }
});

export default router;
