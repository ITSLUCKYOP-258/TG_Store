/**
 * MTProto (GramJS) client management — phone-number login + access to the
 * user's own Telegram account media (chats, Saved Messages, channels...).
 *
 * Requires MT_API_ID / MT_API_HASH from https://my.telegram.org
 */
import { TelegramClient, Api, utils } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import { CustomFile } from 'telegram/client/uploads.js';
import bigInt from 'big-integer';
import db, { getUserById, setMtSession } from './db.js';

export const isConfigured = () =>
  Boolean(process.env.MT_API_ID) && Boolean(process.env.MT_API_HASH);

const creds = () => ({
  apiId: Number(process.env.MT_API_ID),
  apiHash: process.env.MT_API_HASH,
});

function makeClient(sessionString) {
  const client = new TelegramClient(
    new StringSession(sessionString || ''),
    creds().apiId,
    creds().apiHash,
    { connectionRetries: 3, requestRetries: 2 }
  );
  client.setLogLevel?.('error');
  return client;
}

/** Detect Telegram AUTH_KEY_UNREGISTERED errors (session invalidated by Telegram). */
function isAuthKeyUnregistered(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('AUTH_KEY_UNREGISTERED');
}

/** Invalidate a user's Telegram session: disconnect cached client + clear DB session. */
export async function invalidateUserSession(userId) {
  const client = clients.get(userId);
  if (client) {
    await client.disconnect?.().catch(() => {});
    clients.delete(userId);
  }
  setMtSession(userId, '', '');
}

/* ------------------------------------------------------------------ */
/* Channel peer helpers                                               */
/*                                                                    */
/* Overview: Telegram channels need BOTH the raw channel id AND the   */
/* matching accessHash. Every API call that touches a channel must    */
/* include an InputPeerChannel (or InputChannel for channels.* calls)  */
/* constructed with those two values as BigInt. Passing a bare number  */
/* (especially Bot-API style "-100<id>") fails with CHANNEL_INVALID.   */
/* ------------------------------------------------------------------ */
const bigIntOf = (v) => {
  if (v == null) return bigInt.zero;
  if (bigInt.isInstance(v)) return v;
  const s = String(v).trim();
  return bigInt(s === '' ? '0' : s);
};

/** Strip a Bot-API style "-100" prefix to get the raw MTProto channel id. */
export function rawChannelId(channelId) {
  return String(channelId || '').replace(/^-100/, '');
}

function requireAccessHash(channelId, accessHash) {
  if (!accessHash) {
    const err = new Error(
      `Missing accessHash for channel ${channelId}. ` +
      'Recreate the category so its access hash is saved during channel creation.'
    );
    err.status = 500;
    throw err;
  }
}

/** Build InputPeerChannel from a channel id + access hash (BigInt). */
export function channelPeer(channelId, accessHash) {
  requireAccessHash(channelId, accessHash);
  return new Api.InputPeerChannel({
    channelId: bigIntOf(rawChannelId(channelId)),
    accessHash: bigIntOf(accessHash),
  });
}

/** Build InputChannel (for channels.* methods) from a channel id + access hash. */
export function channelInput(channelId, accessHash) {
  requireAccessHash(channelId, accessHash);
  return new Api.InputChannel({
    channelId: bigIntOf(rawChannelId(channelId)),
    accessHash: bigIntOf(accessHash),
  });
}

/* ------------------------------------------------------------------ */
/* Login flows (phone -> code -> optional password), kept in memory    */
/* ------------------------------------------------------------------ */
const flows = new Map(); // flowId -> { client, phone, phoneCodeHash, createdAt }
const FLOW_TTL = 10 * 60 * 1000;

function sweepFlows() {
  const now = Date.now();
  for (const [id, f] of flows) {
    if (now - f.createdAt > FLOW_TTL) {
      f.client.disconnect?.().catch(() => {});
      flows.delete(id);
    }
  }
}

export async function startLoginFlow(phone) {
  if (!isConfigured()) throw new Error('MTProto login is not configured on this server');
  sweepFlows();
  const client = makeClient('');
  let phoneCodeHash, isCodeViaApp;
  try {
    await client.connect();
    ({ phoneCodeHash, isCodeViaApp } = await client.sendCode(creds(), phone));
  } catch (err) {
    // Don't leak a connected client on every failed attempt
    await client.disconnect?.().catch(() => {});
    const msg = String(err.errorMessage || err.message || '');
    if (msg.includes('PHONE_NUMBER_INVALID')) throw Object.assign(new Error('Invalid phone number'), { status: 400 });
    if (msg.includes('PHONE_NUMBER_BANNED')) throw Object.assign(new Error('This phone number is banned by Telegram'), { status: 400 });
    if (msg.startsWith('FLOOD')) throw Object.assign(new Error('Too many attempts — wait a few minutes and retry'), { status: 429 });
    throw err;
  }
  const flowId = bigInt(Date.now()).add(bigInt.randBetween(0, 1e9)).toString();
  flows.set(flowId, { client, phone, phoneCodeHash, createdAt: Date.now() });
  return { flowId, isCodeViaApp };
}

function finishLogin(client) {
  return client.getMe().then(async (me) => {
    const session = client.session.save();
    await client.disconnect?.();
    return {
      me: {
        id: String(me.id),
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || '',
        phone: me.phone || '',
      },
      session,
    };
  });
}

export async function verifyLoginCode(flowId, code) {
  const flow = flows.get(flowId);
  if (!flow) throw new Error('Login session expired — request a new code');
  try {
    await flow.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: flow.phone,
        phoneCodeHash: flow.phoneCodeHash,
        phoneCode: code,
      })
    );
  } catch (err) {
    const msg = String(err.errorMessage || err.message || '');
    if (msg.includes('SESSION_PASSWORD_NEEDED')) return { needPassword: true };
    if (msg.includes('PHONE_CODE_INVALID')) throw new Error('Invalid code — check your Telegram and try again');
    if (msg.includes('PHONE_CODE_EXPIRED')) throw new Error('Code expired — request a new one');
    if (msg.startsWith('FLOOD_WAIT')) throw new Error('Too many attempts — wait a few minutes and retry');
    throw new Error(msg || 'Login failed');
  }
  const { me, session } = await finishLogin(flow.client);
  flows.delete(flowId);
  return { me, session };
}

export async function verifyLoginPassword(flowId, password) {
  const flow = flows.get(flowId);
  if (!flow) throw new Error('Login session expired — start again');
  try {
    const pwdInfo = await flow.client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(pwdInfo, password);
    await flow.client.invoke(new Api.auth.CheckPassword({ password: check }));
  } catch (err) {
    const msg = String(err.errorMessage || err.message || '');
    if (msg.includes('PASSWORD_HASH_INVALID')) throw new Error('Wrong password');
    throw new Error(msg || 'Login failed');
  }
  const { me, session } = await finishLogin(flow.client);
  flows.delete(flowId);
  return { me, session };
}

/* ------------------------------------------------------------------ */
/* Authenticated user clients                                          */
/* ------------------------------------------------------------------ */
const clients = new Map(); // userId -> TelegramClient

export async function getUserClient(userId) {
  const cached = clients.get(userId);
  if (cached) {
    if (!cached.connected) {
      try {
        await cached.connect();
      } catch (err) {
        if (isAuthKeyUnregistered(err)) {
          await invalidateUserSession(userId);
          const authErr = new Error(
            'Telegram session expired — please log in again (Disconnect Telegram account, then reconnect).'
          );
          authErr.status = 401;
          throw authErr;
        }
        throw new Error('Could not connect to Telegram: ' + err.message);
      }
    }
    return cached;
  }
  const user = getUserById(userId);
  if (!user?.mt_session) {
    const err = new Error('Telegram account not connected');
    err.status = 401;
    throw err;
  }
  const client = makeClient(user.mt_session);
  try {
    await client.connect();
  } catch (err) {
    if (isAuthKeyUnregistered(err)) {
      await invalidateUserSession(userId);
      const authErr = new Error(
        'Telegram session expired — please log in again (Disconnect Telegram account, then reconnect).'
      );
      authErr.status = 401;
      throw authErr;
    }
    throw new Error('Could not connect to Telegram: ' + err.message);
  }
  clients.set(userId, client);
  return client;
}

export async function saveUserSession(userId, session, phone) {
  // A fresh login (e.g. from another phone) replaces the stored Telegram
  // session. Drop any cached client built from the OLD session string so the
  // server never keeps talking through a stale, possibly-revoked auth key.
  const old = clients.get(userId);
  if (old) {
    await old.disconnect?.().catch(() => {});
    clients.delete(userId);
  }
  setMtSession(userId, session, phone);
}

export async function disconnectUser(userId) {
  const client = clients.get(userId);
  if (client) {
    await client.disconnect?.().catch(() => {});
    clients.delete(userId);
  }
  setMtSession(userId, '', '');
}

/* ------------------------------------------------------------------ */
/* Browsing: dialogs (chats) and media messages                        */
/* ------------------------------------------------------------------ */
export async function listDialogs(userId, limit = 100) {
  const client = await getUserClient(userId);
  const dialogs = await client.getDialogs({ limit });
  return dialogs.map((d) => {
    const e = d.entity;
    return {
      id: String(utils.getPeerId(e)),
      type: e.className === 'User' ? 'user' : e.className === 'Channel' ? (e.megagroup ? 'group' : 'channel') : 'group',
      title: [e.firstName, e.lastName].filter(Boolean).join(' ') || e.title || e.username || 'Chat',
      username: e.username || null,
      lastMessage: d.message?.message?.slice(0, 80) || (d.message?.media ? '📎 Media' : ''),
    };
  });
}

const MEDIA_FILTERS = {
  all: () => null,
  photo: () => new Api.InputMessagesFilterPhotos(),
  photos: () => new Api.InputMessagesFilterPhotos(),
  video: () => new Api.InputMessagesFilterVideo(),
  videos: () => new Api.InputMessagesFilterVideo(),
  doc: () => new Api.InputMessagesFilterDocument(),
  docs: () => new Api.InputMessagesFilterDocument(),
  music: () => new Api.InputMessagesFilterMusic(),
};

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v?.toNumber === 'function') return v.toNumber();
  if (typeof v?.value !== 'undefined') return Number(v.value);
  const s = typeof v?.toString === 'function' ? v.toString() : String(v);
  if (/^-?\d+$/.test(s)) return Number(s);
  return 0;
}

function kindOf(mime, name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'music';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('text/') || ['txt', 'md', 'log', 'json', 'js', 'ts', 'py', 'csv'].includes(ext)) return 'text';
  return 'doc';
}

/** Extract display info from a message's media. Returns null for non-media. */
export function mediaInfo(msg) {
  const m = msg.media;
  if (!m) return null;
  if (m.className === 'MessageMediaDocument' && m.document?.className === 'Document') {
    const doc = m.document;
    let name = '';
    for (const a of doc.attributes || []) {
      if (a.className === 'DocumentAttributeFilename' && a.fileName) name = a.fileName;
    }
    if (!name) name = `file_${msg.id}`;
    return {
      msgId: msg.id,
      name,
      mime: doc.mimeType || 'application/octet-stream',
      size: toNum(doc.size),
      date: msg.date ? new Date(msg.date * 1000).toISOString() : null,
      kind: kindOf(doc.mimeType || '', name),
    };
  }
  if (m.className === 'MessageMediaPhoto' && m.photo?.className === 'Photo') {
    const photo = m.photo;
    let size = 0;
    for (const s of photo.sizes || []) {
      if (s.className === 'PhotoSizeProgressive' && s.sizes?.length) {
        size = Math.max(size, s.sizes[s.sizes.length - 1]);
      } else if (s.className === 'PhotoSize' && s.size) {
        size = Math.max(size, s.size);
      }
    }
    return {
      msgId: msg.id,
      name: `photo_${photo.id}.jpg`,
      mime: 'image/jpeg',
      size,
      date: msg.date ? new Date(msg.date * 1000).toISOString() : null,
      kind: 'image',
    };
  }
  return null;
}

export async function listMedia(userId, chatId, filter = 'all', limit = 200) {
  const client = await getUserClient(userId);
  const out = [];
  const opts = { limit };
  if (MEDIA_FILTERS[filter]) opts.filter = MEDIA_FILTERS[filter]();
  for await (const msg of client.iterMessages(Number(chatId), opts)) {
    const info = mediaInfo(msg);
    if (!info) continue;
    const isMedia = /^image\//.test(info.mime || '') || /^video\//.test(info.mime || '');
    out.push({
      ...info,
      id: info.msgId,
      chatId: String(chatId),
      type: 'saved',
      // Real preview for images/videos — served through the user's session
      thumbnail: isMedia ? `/api/mt/media/${chatId}/${info.msgId}/thumb` : undefined,
      url: `/api/mt/media/${chatId}/${info.msgId}/raw`,
      downloadUrl: `/api/mt/media/${chatId}/${info.msgId}/download`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Media download streaming (with byte-range support)                  */
/* ------------------------------------------------------------------ */
function pickLargestPhotoSize(photo) {
  let best = null;
  for (const s of photo.sizes || []) {
    if (s.className === 'PhotoSizeProgressive' && s.sizes?.length) {
      if (!best || s.sizes[s.sizes.length - 1] > (best.bytes || 0)) {
        best = { type: s.type, bytes: s.sizes[s.sizes.length - 1], progressive: s.sizes };
      }
    } else if (s.className === 'PhotoSize' && s.size) {
      if (!best || s.size > (best.bytes || 0)) best = { type: s.type, bytes: s.size };
    }
  }
  return best;
}

/** Build the download location + exact total size for a message's media. */
export function fileLocation(msg) {
  const m = msg.media;
  if (!m) return null;
  if (m.className === 'MessageMediaDocument' && m.document?.className === 'Document') {
    const doc = m.document;
    return {
      location: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference || Buffer.alloc(0),
        thumbSize: '', // required string in current layer — empty = full file
      }),
      size: toNum(doc.size),
    };
  }
  if (m.className === 'MessageMediaPhoto' && m.photo?.className === 'Photo') {
    const photo = m.photo;
    const best = pickLargestPhotoSize(photo);
    if (!best) return null;
    const total = best.progressive ? best.progressive[best.progressive.length - 1] : best.bytes;
    return {
      location: new Api.InputPhotoFileLocation({
        id: photo.id,
        accessHash: photo.accessHash,
        fileReference: photo.fileReference,
        thumbSize: best.type,
      }),
      size: total || 0,
    };
  }
  return null;
}

const ALIGN = 4096;
const REQ_SIZE = 512 * 1024; // divisible by 4096, within Telegram limits

/**
 * Yield raw bytes for [start, end] of the given file location.
 * Telegram requires 4096-aligned offsets, so we align down and skip.
 */
export async function* downloadBytes(client, location, { start = 0, end = Infinity } = {}) {
  let alignedStart = Math.floor(start / ALIGN) * ALIGN;
  let skip = start - alignedStart;
  let remaining = end - start + 1;
  for await (const buf of client.iterDownload({
    file: location,
    offset: bigInt(alignedStart),
    requestSize: REQ_SIZE,
  })) {
    if (remaining <= 0) break;
    let b = buf;
    if (skip > 0) {
      if (skip >= b.length) {
        skip -= b.length;
        continue;
      }
      b = b.subarray(skip);
      skip = 0;
    }
    if (b.length > remaining) b = b.subarray(0, remaining);
    remaining -= b.length;
    yield Buffer.from(b);
  }
}

/** Fetch a single message (re-fetches to refresh fileReference). */
export async function getMessage(userId, chatId, msgId, accessHash = null) {
  const client = await getUserClient(userId);
  const peer = accessHash ? channelPeer(chatId, accessHash) : Number(chatId);
  const msgs = await client.getMessages(peer, { ids: [Number(msgId)] });
  const msg = msgs?.[0];
  if (!msg || !msg.media) return null;
  const info = mediaInfo(msg);
  const loc = fileLocation(msg);
  if (!info || !loc) return null;
  return { client, info, loc };
}

/**
 * Fetch the small JPEG preview Telegram stores inside image/video messages.
 * Downloads the smallest usable PhotoSize ('s'/'m'/'x'/'t') via the user's
 * session. Returns a Buffer of JPEG bytes, or null if no thumbnail exists.
 */
export async function getMessageThumb(userId, chatId, msgId, accessHash = null) {
  const client = await getUserClient(userId);
  const peer = accessHash ? channelPeer(chatId, accessHash) : Number(chatId);
  const msgs = await client.getMessages(peer, { ids: [Number(msgId)] });
  const msg = msgs?.[0];
  if (!msg?.media) return null;
  const m = msg.media;

  let buildLocation = null;
  let sizes = [];
  let stripped = null;
  const isUsableSize = (t) =>
    Boolean(t?.type) &&
    (t.className === 'PhotoSize' ||
      t.className === 'PhotoSizeProgressive' ||
      t.className === 'PhotoCachedSize');

  if (m.className === 'MessageMediaDocument' && m.document?.className === 'Document') {
    const doc = m.document;
    stripped = (doc.thumbs || []).find((t) => t.className === 'PhotoStrippedSize' && t.bytes);
    buildLocation = (type) => new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference || Buffer.alloc(0),
      thumbSize: type,
    });
    sizes = (doc.thumbs || []).filter(isUsableSize);
  } else if (m.className === 'MessageMediaPhoto' && m.photo?.className === 'Photo') {
    const photo = m.photo;
    stripped = (photo.sizes || []).find((t) => t.className === 'PhotoStrippedSize' && t.bytes);
    buildLocation = (type) => new Api.InputPhotoFileLocation({
      id: photo.id,
      accessHash: photo.accessHash,
      fileReference: photo.fileReference || Buffer.alloc(0),
      thumbSize: type,
    });
    sizes = (photo.sizes || []).filter(isUsableSize);
  }
  if (!buildLocation && !stripped) return null;

  // Rank sizes to match Telegram Saved Messages preview quality:
  // 'y' (1280/1080p) > 'x' (800p) > 'w' (2560p) > 'm' (320p) > small/stripped
  const typeRank = { y: 6, x: 5, w: 4, m: 3, d: 2, c: 2, b: 2, a: 1, s: 1, t: 0 };
  sizes.sort((a, b) => (typeRank[b.type] ?? 0) - (typeRank[a.type] ?? 0));

  for (const s of sizes) {
    try {
      const bufs = [];
      for await (const b of client.iterDownload({ file: buildLocation(s.type), requestSize: REQ_SIZE })) {
        bufs.push(Buffer.from(b));
      }
      const buf = Buffer.concat(bufs);
      if (buf.length > 0) {
        console.log(`[MT:thumb] user=${userId} msg=${msgId} type=${s.type} bytes=${buf.length}`);
        return buf;
      }
    } catch (err) {
      console.log(`[MT:thumb] user=${userId} msg=${msgId} size ${s.type} failed: ${err?.message || err}`);
    }
  }

  // Fallback to stripped only if no PhotoSize was downloadable
  if (stripped) {
    try {
      const jpg = utils.strippedPhotoToJpg(stripped.bytes);
      if (jpg && jpg.length > 0) return jpg;
    } catch {}
  }
  return null;
}

/**
 * Create a new private Telegram channel for a category.
 * Returns { channelId, accessHash, title }.
 */
export async function createChannel(userId, title) {
  const client = await getUserClient(userId);
  console.log(`[MT:createChannel] user=${userId} title="${title}" — using the USER's own session`);
  const result = await client.invoke(
    new Api.channels.CreateChannel({
      title,
      about: `TGStore category: ${title}`,
      broadcast: true, // true = channel (not supergroup)
    })
  );
  const channel = result.chats?.[0];
  if (!channel) throw new Error('Failed to create channel');
  const rawId = String(channel.id);
  const accessHash = channel.accessHash ? String(channel.accessHash) : null;
  if (!accessHash) {
    // Without the access hash we can never address this channel again.
    throw new Error('Telegram did not return an accessHash for the new channel');
  }
  // Bot API uses -100<id> for channel chat_ids; MTProto uses the raw positive id + accessHash
  const botChatId = `-100${rawId}`;
  console.log(`[MT:createChannel] OK channelId=${rawId} botChatId=${botChatId} accessHash=${accessHash} title="${channel.title || title}"`);
  return {
    channelId: botChatId,
    rawChannelId: rawId,
    accessHash,
    title: channel.title || title,
  };
}

/**
 * Upload a file (Buffer or path on disk) into a channel using the USER's own
 * session. When replyToMessageId is set (the folder marker message), the file
 * is posted as a reply to it inside the user's channel.
 * Returns { messageId, fileId }.
 */
export async function sendFileToChannel(
  userId,
  channelId,
  accessHash,
  { file, filename, mime, replyToMessageId = 0, caption = '', fileSize = 0 } = {}
) {
  if (!file) throw new Error('sendFileToChannel: no file provided');
  const client = await getUserClient(userId);
  const peer = channelPeer(channelId, accessHash);
  const safeName = String(filename || 'upload.bin').slice(0, 255);

  // CustomFile lets us stream a big file from disk (memory-safe) or wrap a Buffer.
  const input =
    typeof file === 'string'
      ? new CustomFile(safeName, Number(fileSize || 0), file)
      : new CustomFile(safeName, Number(fileSize || file.length || 0), '', file);

  // Preserve the ORIGINAL upload bytes. Telegram re-encodes photos/videos sent
  // without this flag (moov/audio tracks can be dropped → silent videos), and
  // byte-exact downloads / range seeking need the original file.
  const attrs = [new Api.DocumentAttributeFilename({ fileName: safeName })];
  const resolvedMime = String(mime || '');
  if (resolvedMime.startsWith('video/')) {
    attrs.push(new Api.DocumentAttributeVideo({
      duration: 0,
      w: 0,
      h: 0,
      supportsStreaming: true,
    }));
  } else if (resolvedMime.startsWith('audio/')) {
    attrs.push(new Api.DocumentAttributeAudio({
      duration: 0,
      voice: false,
    }));
  }

  console.log(
    `[MT:uploadFile] user=${userId} channel=${rawChannelId(channelId)} accessHash=${accessHash} ` +
    `name="${filename}" size=${fileSize} replyTo=${replyToMessageId || 'none'}`
  );

  // Upload original bytes directly via client.uploadFile
  let fileHandle;
  try {
    fileHandle = await client.uploadFile({
      file: input,
      workers: 1,
    });
  } catch (err) {
    if (isAuthKeyUnregistered(err)) {
      await invalidateUserSession(userId);
      const authErr = new Error(
        'Telegram session expired — please log in again (Disconnect Telegram account, then reconnect).'
      );
      authErr.status = 401;
      throw authErr;
    }
    throw err;
  }

  // Explicitly set forceFile: true on InputMediaUploadedDocument so Telegram
  // NEVER compresses or transcodes images/videos to photos. Original bytes stay intact.
  const media = new Api.InputMediaUploadedDocument({
    file: fileHandle,
    mimeType: resolvedMime || 'application/octet-stream',
    attributes: attrs,
    forceFile: true,
  });

  const request = new Api.messages.SendMedia({
    peer,
    media,
    message: caption || '',
    replyTo:
      replyToMessageId && Number(replyToMessageId) > 0
        ? new Api.InputReplyToMessage({ replyToMsgId: Number(replyToMessageId) })
        : undefined,
  });

  let invokeResult;
  try {
    invokeResult = await client.invoke(request);
  } catch (err) {
    if (isAuthKeyUnregistered(err)) {
      await invalidateUserSession(userId);
      const authErr = new Error(
        'Telegram session expired — please log in again (Disconnect Telegram account, then reconnect).'
      );
      authErr.status = 401;
      throw authErr;
    }
    throw err;
  }
  const msg = client._getResponseMessage(request, invokeResult, peer);
  const doc = msg?.document || msg?.media?.document;

  let messageId = toNum(msg?.id) || 0;
  let fileId = doc?.id ? String(doc.id) : null;

  if (!messageId || !fileId) {
    for (const u of invokeResult?.updates || []) {
      if (u.className === 'UpdateMessageID') messageId = toNum(u.id) || messageId;
      if (u.message && (u.className === 'UpdateNewChannelMessage' || u.className === 'UpdateNewMessage')) {
        const m = u.message;
        messageId = toNum(m.id) || messageId;
        const d = m.media?.document || m.document;
        if (d?.id) fileId = String(d.id);
      }
    }
  }

  console.log(
    `[MT:uploadFile] sent messageId=${messageId || 'n/a'} mediaId=${fileId || 'n/a'}`
  );
  return {
    messageId,
    fileId,
  };
}

/**
 * Delete messages from a channel using the USER's own session (revoke=true
 * removes them for everyone). Used when files/folders/categories are deleted.
 */
export async function deleteMessages(userId, chatId, messageIds, accessHash = null) {
  const client = await getUserClient(userId);
  const peer = accessHash ? channelPeer(chatId, accessHash) : Number(chatId);
  await client.deleteMessages(peer, messageIds.map(Number), { revoke: true });
}

/**
 * Post a text message (e.g. the folder marker) into a channel using the
 * USER's own session. Returns { messageId }.
 */
export async function postTextMessage(userId, channelId, accessHash, text) {
  const client = await getUserClient(userId);
  const peer = channelPeer(channelId, accessHash);
  console.log(
    `[MT:postMessage] user=${userId} channel=${rawChannelId(channelId)} text="${String(text).slice(0, 80)}"`
  );
  const result = await client.invoke(
    new Api.messages.SendMessage({
      peer,
      message: text,
      randomId: bigInt.randBetween('1', '9007199254740991'),
    })
  );
  // SendMessage returns an Updates object — the real message id lives inside
  // updates[] as UpdateNewChannelMessage/UpdateNewMessage.message.id.
  let messageId = 0;
  for (const u of result?.updates || []) {
    const msg = u?.message;
    if (msg && (u.className === 'UpdateNewChannelMessage' || u.className === 'UpdateNewMessage')) {
      messageId = toNum(msg.id) || 0;
      if (messageId) break;
    }
  }
  if (!messageId) messageId = toNum(result?.id) || 0;
  console.log(`[MT:postMessage] OK messageId=${messageId || 'n/a'} (updates=${result?.updates?.length ?? 0})`);
  return { messageId };
}

/**
 * Get Saved Messages chat ID (the user's own "Saved Messages" chat).
 */
export async function getSavedMessagesId(userId) {
  const client = await getUserClient(userId);
  const me = await client.getMe();
  return String(me.id);
}

/**
 * Copy media from Saved Messages to a category channel using the USER's session.
 * Returns { messageId, fileId }.
 */
export async function copySavedMediaToChannel(userId, savedMsgId, channelId, accessHash, caption) {
  const client = await getUserClient(userId);
  console.log(`[MT:copySaved] user=${userId} channel=${rawChannelId(channelId)} savedMsgId=${savedMsgId}`);
  const result = await client.invoke(
    new Api.messages.ForwardMessages({
      fromPeer: new Api.InputPeerSelf(), // Saved Messages live under the user's own id ("self")
      id: [Number(savedMsgId)],
      toPeer: channelPeer(channelId, accessHash),
      randomId: [bigInt.randBetween('1', '9007199254740991')],
    })
  );
  // ForwardMessages returns Updates — UpdateMessageID carries the new id,
  // UpdateNewMessage/UpdateNewChannelMessage carries the full message.
  let messageId = 0;
  let msg = null;
  for (const u of result?.updates || []) {
    if (u.className === 'UpdateMessageID') messageId = toNum(u.id) || messageId;
    if (u.message && (u.className === 'UpdateNewChannelMessage' || u.className === 'UpdateNewMessage')) msg = u.message;
  }
  if (!msg) msg = Array.isArray(result) ? result[0] : result;
  console.log(`[MT:copySaved] OK messageId=${messageId || toNum(msg?.id) || 'n/a'}`);
  return {
    messageId: messageId || toNum(msg?.id) || 0,
    fileId: msg?.photo?.id?.toString() || msg?.document?.id?.toString() || null,
  };
}

export async function inviteBotToChannel(userId, channelId, accessHash, botUsername) {
  const client = await getUserClient(userId);
  const bot = await client.getEntity(botUsername);
  if (!bot) throw new Error(`Bot @${botUsername} not found`);
  const channel = channelInput(channelId, accessHash);
  const botInput = new Api.InputUser({
    userId: bigIntOf(String(bot.id)),
    accessHash: bigIntOf(bot.accessHash || 0),
  });
  console.log(`[MT:inviteBot] user=${userId} channel=${rawChannelId(channelId)} bot=@${botUsername} accessHash=${accessHash}`);
  await client.invoke(
    new Api.channels.InviteToChannel({
      channel,
      users: [botInput],
    })
  );
  // Promote bot to admin so the Bot API can also reach the channel (backup)
  await client.invoke(
    new Api.channels.EditAdmin({
      channel,
      userId: botInput,
      adminRights: new Api.ChatAdminRights({
        postMessages: true,
        editMessages: true,
        deleteMessages: true,
        changeInfo: true,
      }),
      rank: 'bot',
    })
  );
  console.log(`[MT:inviteBot] OK @${botUsername} is admin of channel ${rawChannelId(channelId)}`);
  return true;
}


