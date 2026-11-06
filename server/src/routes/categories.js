import { Router } from 'express';
import * as db from '../db.js';
import { requireAuth } from '../auth.js';
import { isConfigured as mtConfigured, createChannel, inviteBotToChannel } from '../mtproto.js';

const router = Router();

// All category routes require auth
router.use(requireAuth);

/** Never expose the channel access hash to the browser — it is a capability token. */
const shapeCategory = (row) => ({
  id: row.id,
  name: row.name,
  channelId: row.channel_id,
  channelActive: Boolean(row.channel_id && (row.access_hash || process.env.STORAGE_CHANNEL_ID)),
  createdAt: row.created_at,
});

/** GET / — list user's categories */
router.get('/', (req, res) => {
  const categories = db.listCategories(req.userId).map(shapeCategory);
  res.json({ categories });
});

/** POST / — create a new category with its own Telegram channel */
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });

  // Prevent duplicate categories (case-insensitive)
  const existing = db.getCategoryByName(req.userId, name);
  if (existing) {
    return res.status(409).json({
      error: `Category "${name}" already exists`,
      category: shapeCategory(existing)
    });
  }

  const user = db.getUserById(req.userId);
  let channel = null;
  let channelId = null;
  let accessHash = null;
  let botInvited = false;

  if (user?.mt_session && mtConfigured()) {
    console.log(
      `[categories] creating category name="${name}" user=${req.userId} phone=${user.mt_phone || 'n/a'}`
    );
    try {
      // Create the Telegram channel via the USER's MTProto session
      channel = await createChannel(req.userId, `TGStore: ${name}`);

      if (!channel?.channelId) {
        throw new Error('No channel ID returned from Telegram');
      }

      channelId = channel.channelId;
      accessHash = channel.accessHash;

      // Invite bot to the newly created channel (uses accessHash to address it).
      const botUsername = process.env.BOT_USERNAME;
      if (botUsername) {
        botInvited = true;
        try {
          await inviteBotToChannel(
            req.userId,
            channel.rawChannelId,
            channel.accessHash,
            botUsername.replace('@', '')
          );
        } catch (inviteErr) {
          botInvited = false;
          console.warn(
            `[categories] bot @${botUsername} could not be invited to user channel: ${inviteErr.message}`
          );
        }
      }
    } catch (err) {
      console.error(
        `[categories] failed to create Telegram channel (user ${req.userId}):`,
        err.message
      );
      return res.status(err.status || 502).json({
        error: `Failed to create Telegram channel: ${err.message}`
      });
    }
  } else if (process.env.STORAGE_CHANNEL_ID) {
    // User does not have an MTProto session (e.g. dev login):
    // Fall back to the configured Bot API storage channel!
    channelId = process.env.STORAGE_CHANNEL_ID;
    accessHash = null;
    channel = {
      channelId,
      botApiId: channelId,
      title: name,
      botInvited: true
    };
    console.log(
      `[categories] created bot-fallback category name="${name}" user=${req.userId} channel=${channelId}`
    );
  } else {
    return res.status(400).json({
      error: 'MTProto session or STORAGE_CHANNEL_ID is required to create categories.'
    });
  }

  // Save category with the Telegram channel ID + accessHash
  const id = db.insertCategory(req.userId, name, channelId, accessHash);
  const category = db.getCategory(id, req.userId);

  res.status(201).json({
    category: shapeCategory(category),
    channel: channel
      ? {
          channelId: channel.channelId,
          botApiId: channelId,
          title: channel.title,
          botInvited
        }
      : null
  });
});

/** PATCH /:id — rename a category */
router.patch('/:id', (req, res) => {
  const category = db.getCategory(Number(req.params.id), req.userId);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  db.renameCategory(category.id, req.userId, name);
  res.json({ category: shapeCategory(db.getCategory(category.id, req.userId)) });
});

/** DELETE /:id — delete a category and all its contents */
router.delete('/:id', async (req, res) => {
  const category = db.getCategory(Number(req.params.id), req.userId);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  // Delete all files in this category (purge from Telegram)
  const files = db.listFilesByCategory(req.userId, category.id);
  for (const f of files) {
    const { purgeFile } = await import('./drive.js');
    await purgeFile(f, req.userId);
  }

  // Delete all folders in this category
  const folders = db.listFoldersByCategory(req.userId, category.id);
  db.deleteFolderRows(folders.map((f) => f.id), req.userId);

  db.deleteCategoryRow(category.id, req.userId);
  res.json({ ok: true, removedFiles: files.length, removedFolders: folders.length });
});

export default router;