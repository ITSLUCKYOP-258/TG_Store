import crypto from 'node:crypto';

const CHUNK_SIZE = 19 * 1024 * 1024; // 19 MB — safe under Bot API's 50MB upload / 20MB getFile limits

const apiBase = () => `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

/** Call a Bot API method with JSON params. */
export async function tg(method, params = {}) {
  const res = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'invalid response' }));
  if (!data.ok) {
    const err = new Error(`Telegram ${method} failed: ${data.error_code ?? ''} ${data.description ?? ''}`);
    err.code = data.error_code;
    throw err;
  }
  return data.result;
}

export const CHUNK_SIZE_REF = CHUNK_SIZE;
export const getChunkSize = () => CHUNK_SIZE;

/**
 * Upload one chunk of a file as a document into a specific channel.
 * Returns { chatId, messageId, tgFileId, size }.
 */
export async function sendChunkToChannel(buffer, idx, total, originalName, chatId) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(
    'caption',
    `TGSTORE|part ${idx + 1}/${total}|${originalName.slice(0, 120)}`
  );
  form.append('document', new Blob([buffer]), `part_${String(idx).padStart(5, '0')}.bin`);

  const res = await fetch(`${apiBase()}/sendDocument`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({ ok: false, description: 'invalid response' }));
  if (!data.ok) {
    throw new Error(`sendDocument failed: ${data.error_code ?? ''} ${data.description ?? ''}`);
  }
  const msg = data.result;
  return {
    chatId: String(msg.chat.id),
    messageId: msg.message_id,
    tgFileId: msg.document.file_id,
    size: buffer.length,
  };
}

/**
 * Upload one chunk of a file as a document into the default storage channel.
 * Returns { chatId, messageId, tgFileId, size }.
 */
export async function sendChunk(buffer, idx, total, originalName) {
  return sendChunkToChannel(buffer, idx, total, originalName, process.env.STORAGE_CHANNEL_ID);
}

/** Best-effort delete of a stored message (used when files are removed forever). */
export async function deleteStoredMessage(chatId, messageId) {
  try {
    await tg('deleteMessage', { chat_id: chatId, message_id: messageId });
    return true;
  } catch {
    return false;
  }
}

/* ---------- file_path cache (valid ~1h on Telegram's side) ---------- */
const pathCache = new Map(); // file_id -> { path, expires }
const PATH_TTL = 40 * 60 * 1000;

/** Drop a cached file_path — used when Telegram's CDN 404s a premature path. */
export function invalidateFilePath(tgFileId) {
  pathCache.delete(tgFileId);
}

export async function getFilePath(tgFileId) {
  const cached = pathCache.get(tgFileId);
  if (cached && cached.expires > Date.now()) return cached.path;
  const file = await tg('getFile', { file_id: tgFileId });
  if (!file.file_path) throw new Error('getFile returned no file_path');
  pathCache.set(tgFileId, { path: file.file_path, expires: Date.now() + PATH_TTL });
  return file.file_path;
}

export function fileDownloadUrl(filePath) {
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
}

/* ---------- Telegram Login Widget verification ---------- */
export function verifyLoginWidget(query) {
  const { hash, ...rest } = query;
  if (!hash) return false;
  const dataCheckString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(process.env.BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (hmac !== hash) return false;
  // reject older than 24h
  const authDate = Number(query.auth_date || 0) * 1000;
  if (!authDate || Date.now() - authDate > 24 * 60 * 60 * 1000) return false;
  return true;
}

/** Verify the bot token is usable and the bot is admin of the storage channel. */
export async function healthCheck() {
  const me = await tg('getMe');
  const chat = await tg('getChat', { chat_id: process.env.STORAGE_CHANNEL_ID });
  const member = await tg('getChatMember', {
    chat_id: process.env.STORAGE_CHANNEL_ID,
    user_id: me.id,
  });
  const canPost = ['administrator', 'creator'].includes(member.status);
  return {
    bot: { id: me.id, username: me.username, firstName: me.first_name },
    channel: { id: chat.id, title: chat.title ?? chat.username ?? String(chat.id) },
    canPostToChannel: canPost,
    ok: canPost,
  };
}
