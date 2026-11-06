import Database from './sqlite-compat.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a writable DATA_DIR. On Render, `/data` only exists when a
 * persistent disk is attached — otherwise mkdir throws EACCES and the
 * whole process crash-loops. Fall back to the server dir instead of dying
 * so the app at least becomes healthy (with a loud warning that data
 * will be ephemeral until the disk is mounted).
 */
function resolveDataDir() {
  const wanted = process.env.DATA_DIR;
  const fallback = path.join(__dirname, '..');
  if (!wanted) return fallback;
  try {
    fs.mkdirSync(wanted, { recursive: true });
    fs.accessSync(wanted, fs.constants.W_OK);
    return wanted;
  } catch (err) {
    console.error(
      `[db] DATA_DIR "${wanted}" is not writable (${err.code || err.message}). ` +
        `Falling back to "${fallback}". Attach a persistent disk at ${wanted} in Render ` +
        `or set DATA_DIR to a writable path — DB will be wiped on redeploy until then.`
    );
    return fallback;
  }
}
const dataDir = resolveDataDir();
const db = new Database(path.join(dataDir, 'tgstore.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  is_dev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER REFERENCES categories(id),
  parent_id INTEGER REFERENCES folders(id),
  name TEXT NOT NULL,
  starred INTEGER NOT NULL DEFAULT 0,
  trashed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, category_id, parent_id);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER REFERENCES categories(id),
  folder_id INTEGER REFERENCES folders(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  trashed INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, category_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(user_id, name);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  tg_file_id TEXT NOT NULL,
  size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id, idx);

CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT UNIQUE NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---------- migrations (add columns to pre-existing databases) ---------- */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
ensureColumn('users', 'mt_session', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'mt_phone', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'last_login', 'TEXT');
ensureColumn('categories', 'access_hash', "TEXT NOT NULL DEFAULT ''");
ensureColumn('folders', 'category_id', 'INTEGER REFERENCES categories(id)');
ensureColumn('files', 'category_id', 'INTEGER REFERENCES categories(id)');
ensureColumn('folders', 'channel_message_id', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('files', 'channel_message_id', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'banned', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'login_count', 'INTEGER NOT NULL DEFAULT 0');

/* One row per signed-in device/browser. The JWT carries the session id (sid),
 * so every device of the SAME account is listed under the SAME user id and
 * can be revoked individually. */
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  event TEXT NOT NULL DEFAULT 'login',
  method TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_events_time ON login_events(created_at);
CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id);
`);

export default db;

/* ---------- users ---------- */
/**
 * Telegram accounts are identified ONLY by their Telegram user id (tg_id), so
 * the same account always maps to the same row — no matter which phone,
 * browser or login method (phone OTP / login widget) is used.
 */
export const upsertTelegramUser = db.transaction((u) => {
  const tgId = String(u.id);
  const existing = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
  if (existing) {
    db.prepare(
      `UPDATE users SET first_name=?, last_name=?, username=?,
         photo_url=COALESCE(NULLIF(?, ''), photo_url),
         mt_phone=COALESCE(NULLIF(?, ''), mt_phone),
         last_login=datetime('now'), login_count=login_count+1 WHERE id=?`
    ).run(
      u.first_name || '', u.last_name || '', u.username || '',
      u.photo_url || '', u.phone || '', existing.id
    );
    return db.prepare('SELECT * FROM users WHERE id=?').get(existing.id);
  }
  const info = db
    .prepare(
      `INSERT INTO users (tg_id, first_name, last_name, username, photo_url, mt_phone, last_login, login_count)
       VALUES (?,?,?,?,?,?,datetime('now'),1)`
    )
    .run(tgId, u.first_name || '', u.last_name || '', u.username || '', u.photo_url || '', u.phone || '');
  return db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
});

export const createDevUser = db.transaction((name) => {
  // Reuse the same dev account across logins so uploads persist between sessions
  const existing = db
    .prepare('SELECT * FROM users WHERE is_dev=1 ORDER BY id LIMIT 1')
    .get();
  if (existing) {
    db.prepare(`UPDATE users SET last_login=datetime('now'), login_count=login_count+1 WHERE id=?`).run(existing.id);
    return db.prepare('SELECT * FROM users WHERE id=?').get(existing.id);
  }
  const info = db
    .prepare(`INSERT INTO users (first_name, is_dev, last_login, login_count) VALUES (?, 1, datetime('now'), 1)`)
    .run(name || 'Dev User');
  return db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
});

export const getUserById = (id) =>
  db.prepare('SELECT * FROM users WHERE id=?').get(id);

export const setUserBanned = (id, banned) =>
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(banned ? 1 : 0, id);

export const setMtSession = (userId, session, phone) =>
  db
    .prepare(`UPDATE users SET mt_session=?, mt_phone=COALESCE(NULLIF(?, ''), mt_phone) WHERE id=?`)
    .run(session, phone || '', userId);

/* ---------- sessions / login history ---------- */
export const createSessionRow = db.transaction((s) => {
  db.prepare(
    `INSERT INTO sessions (id, user_id, method, ip, user_agent, device, browser, os) VALUES (?,?,?,?,?,?,?,?)`
  ).run(s.id, s.userId, s.method, s.ip, s.userAgent, s.device, s.browser, s.os);
  db.prepare(
    `INSERT INTO login_events (user_id, session_id, event, method, ip, user_agent, device, browser, os) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(s.userId, s.id, 'login', s.method, s.ip, s.userAgent, s.device, s.browser, s.os);
});

export const getSession = (id) => db.prepare('SELECT * FROM sessions WHERE id=?').get(id);

export const touchSession = (id) =>
  db.prepare(`UPDATE sessions SET last_seen=datetime('now') WHERE id=?`).run(id);

export const listUserSessions = (userId) =>
  db
    .prepare(`SELECT * FROM sessions WHERE user_id=? AND revoked=0 ORDER BY last_seen DESC`)
    .all(userId);

/** Revoke one session (only if it belongs to userId when given). */
export const revokeSession = (id, userId = null) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  if (!row || row.revoked || (userId != null && row.user_id !== userId)) return false;
  db.prepare('UPDATE sessions SET revoked=1 WHERE id=?').run(id);
  db.prepare(
    `INSERT INTO login_events (user_id, session_id, event, method, ip, user_agent, device, browser, os) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(row.user_id, row.id, 'logout', row.method, row.ip, row.user_agent, row.device, row.browser, row.os);
  return true;
};

export const revokeAllSessions = (userId, exceptId = null) => {
  const rows = db
    .prepare('SELECT id FROM sessions WHERE user_id=? AND revoked=0')
    .all(userId)
    .filter((r) => r.id !== exceptId);
  rows.forEach((r) => revokeSession(r.id, userId));
  return rows.length;
};

export const listLoginEvents = (limit = 200, userId = null) =>
  db
    .prepare(
      `SELECT e.*, u.first_name, u.last_name, u.username, u.tg_id, u.mt_phone, u.is_dev
       FROM login_events e LEFT JOIN users u ON u.id = e.user_id
       ${userId != null ? 'WHERE e.user_id = ?' : ''}
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(...(userId != null ? [userId, limit] : [limit]));

/** Every account that has ever logged in — for the admin API (no secrets). */
export const listUsers = () =>
  db
    .prepare(
      `SELECT u.id, u.tg_id, u.first_name, u.last_name, u.username, u.photo_url, u.is_dev,
              u.banned, u.login_count,
              (u.mt_session != '') AS telegram_connected, u.mt_phone, u.last_login, u.created_at,
              COALESCE(f.file_count, 0)    AS file_count,
              COALESCE(f.storage_bytes, 0) AS storage_bytes,
              (SELECT COUNT(*) FROM categories c WHERE c.user_id = u.id) AS category_count,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked = 0) AS active_sessions,
              (SELECT s.device || ' · ' || s.browser || ' · ' || s.os FROM sessions s
                 WHERE s.user_id = u.id ORDER BY s.last_seen DESC LIMIT 1) AS last_device,
              (SELECT s.ip FROM sessions s WHERE s.user_id = u.id ORDER BY s.last_seen DESC LIMIT 1) AS last_ip
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS file_count, COALESCE(SUM(size), 0) AS storage_bytes
         FROM files WHERE trashed = 0 GROUP BY user_id
       ) f ON f.user_id = u.id
       ORDER BY COALESCE(u.last_login, u.created_at) DESC`
    )
    .all();

/** Full detail for one account: devices, login history, categories, recent files. */
export const getUserDetail = (id) => {
  const user = db
    .prepare(
      `SELECT id, tg_id, first_name, last_name, username, photo_url, is_dev, banned, login_count,
              (mt_session != '') AS telegram_connected, mt_phone, last_login, created_at
       FROM users WHERE id=?`
    )
    .get(id);
  if (!user) return null;
  return {
    user,
    sessions: db.prepare('SELECT * FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 50').all(id),
    logins: listLoginEvents(100, id),
    categories: db
      .prepare(
        `SELECT c.id, c.name, c.created_at,
                (SELECT COUNT(*) FROM files f WHERE f.category_id=c.id AND f.trashed=0) AS file_count
         FROM categories c WHERE c.user_id=? ORDER BY c.name COLLATE NOCASE`
      )
      .all(id),
    recentFiles: db
      .prepare(
        `SELECT id, name, mime, size, created_at, trashed FROM files WHERE user_id=? ORDER BY id DESC LIMIT 25`
      )
      .all(id),
  };
};

/** Aggregate stats for the admin API. */
export const getUserStats = () => {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total_users,
              COALESCE(SUM(CASE WHEN mt_session != '' THEN 1 ELSE 0 END),0) AS telegram_connected,
              COALESCE(SUM(CASE WHEN last_login >= datetime('now', '-1 day') THEN 1 ELSE 0 END),0) AS active_last_24h,
              COALESCE(SUM(CASE WHEN last_login >= datetime('now', '-7 day') THEN 1 ELSE 0 END),0) AS active_last_7d,
              COALESCE(SUM(CASE WHEN banned = 1 THEN 1 ELSE 0 END),0) AS banned_users,
              COALESCE(SUM(CASE WHEN is_dev = 1 THEN 1 ELSE 0 END),0) AS dev_users
       FROM users`
    )
    .get();
  const files = db
    .prepare(`SELECT COUNT(*) AS total_files, COALESCE(SUM(size),0) AS total_bytes FROM files WHERE trashed=0`)
    .get();
  const sess = db
    .prepare(`SELECT COUNT(*) AS active_sessions FROM sessions WHERE revoked=0`)
    .get();
  const logins24 = db
    .prepare(`SELECT COUNT(*) AS logins_24h FROM login_events WHERE event='login' AND created_at >= datetime('now','-1 day')`)
    .get();
  const cats = db.prepare(`SELECT COUNT(*) AS total_categories FROM categories`).get();
  return { ...totals, ...files, ...sess, ...logins24, ...cats };
};

/* ---------- categories ---------- */
export const insertCategory = (userId, name, channelId, accessHash = '') =>
  db
    .prepare(
      'INSERT INTO categories (user_id, name, channel_id, access_hash) VALUES (?,?,?,?)'
    )
    .run(userId, name, channelId || '', String(accessHash || '')).lastInsertRowid;

export const listCategories = (userId) =>
  db.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY name COLLATE NOCASE').all(userId);

export const getCategory = (id, userId) =>
  db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, userId);

/** Get category by name (case-insensitive) for duplicate prevention */
export const getCategoryByName = (userId, name) =>
  db.prepare('SELECT * FROM categories WHERE user_id=? AND name COLLATE NOCASE = ?').get(userId, name);


export const deleteCategoryRow = (id, userId) =>
  db.prepare('DELETE FROM categories WHERE id=? AND user_id=?').run(id, userId);

export const renameCategory = (id, userId, name) =>
  db.prepare('UPDATE categories SET name=? WHERE id=? AND user_id=?').run(name, id, userId);

export const listFilesByCategory = (userId, categoryId) =>
  db.prepare('SELECT * FROM files WHERE user_id=? AND category_id=?').all(userId, categoryId);

export const listFoldersByCategory = (userId, categoryId) =>
  db.prepare('SELECT * FROM folders WHERE user_id=? AND category_id=?').all(userId, categoryId);

/* ---------- folders ---------- */
export const insertFolder = (userId, categoryId, parentId, name, channelMessageId = 0) =>
  db
    .prepare('INSERT INTO folders (user_id, category_id, parent_id, name, channel_message_id) VALUES (?,?,?,?,?)')
    .run(userId, categoryId, parentId, name, channelMessageId).lastInsertRowid;

export const getFolder = (id, userId) =>
  db.prepare('SELECT * FROM folders WHERE id=? AND user_id=?').get(id, userId);

export const listFolders = (userId, categoryId, parentId) =>
  db
    .prepare(
      `SELECT f.*,
         (SELECT COUNT(*) FROM files fi WHERE fi.folder_id=f.id AND fi.user_id=f.user_id AND fi.trashed=0) AS itemCount,
         (SELECT COALESCE(SUM(fi.size),0) FROM files fi WHERE fi.folder_id=f.id AND fi.user_id=f.user_id AND fi.trashed=0) AS totalSize
       FROM folders f
       WHERE f.user_id=? AND f.trashed=0 AND f.category_id IS ? AND f.parent_id IS ?
       ORDER BY f.name COLLATE NOCASE`
    )
    .all(userId, categoryId ?? null, parentId ?? null);

export const listTrashedFolders = (userId) =>
  db.prepare('SELECT * FROM folders WHERE user_id=? AND trashed=1 ORDER BY name').all(userId);

export const listStarredFolders = (userId) =>
  db.prepare('SELECT * FROM folders WHERE user_id=? AND trashed=0 AND starred=1 ORDER BY name').all(userId);

export const searchFolders = (userId, q) =>
  db
    .prepare(`SELECT * FROM folders WHERE user_id=? AND trashed=0 AND name LIKE ? ORDER BY name LIMIT 100`)
    .all(userId, `%${q}%`);

export const renameFolder = (id, userId, name) =>
  db.prepare('UPDATE folders SET name=? WHERE id=? AND user_id=?').run(name, id, userId);

export const setFolderStar = (id, userId, v) =>
  db.prepare('UPDATE folders SET starred=? WHERE id=? AND user_id=?').run(v ? 1 : 0, id, userId);

export const setFolderTrash = (id, userId, v) =>
  db.prepare('UPDATE folders SET trashed=? WHERE id=? AND user_id=?').run(v ? 1 : 0, id, userId);

/** Count all non-trashed files that live directly inside a folder (non-recursive). */
export const countFolderItems = (folderId, userId) =>
  db
    .prepare(
      'SELECT COUNT(*) AS count FROM files WHERE user_id=? AND folder_id=? AND trashed=0'
    )
    .get(userId, folderId).count;

/** Recursively collect all descendant folder ids (including the folder itself). */
export function collectFolderIds(id, userId) {
  const ids = [id];
  const walk = (pid) => {
    for (const row of db.prepare('SELECT id FROM folders WHERE parent_id=? AND user_id=?').all(pid, userId)) {
      ids.push(row.id);
      walk(row.id);
    }
  };
  walk(id);
  return ids;
}

/** True if candidateId is inside the subtree rooted at ancestorId. */
export function isDescendant(candidateId, ancestorId, userId) {
  let cur = candidateId;
  const seen = new Set();
  while (cur != null) {
    if (seen.has(cur)) return false;
    seen.add(cur);
    if (cur === ancestorId) return true;
    const row = db.prepare('SELECT parent_id FROM folders WHERE id=? AND user_id=?').get(cur, userId);
    if (!row) return false;
    cur = row.parent_id;
  }
  return false;
}

export const moveFolder = (id, userId, parentId) =>
  db.prepare('UPDATE folders SET parent_id=? WHERE id=? AND user_id=?').run(parentId, id, userId);

export const deleteFolderRow = (id, userId) =>
  db.prepare('DELETE FROM folders WHERE id=? AND user_id=?').run(id, userId);

/**
 * Delete many folders at once. With foreign_keys=ON a parent cannot be removed
 * while a child still points at it, so detach them all first, then delete.
 */
export const deleteFolderRows = db.transaction((ids, userId) => {
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  db.prepare(`UPDATE folders SET parent_id=NULL WHERE id IN (${ph}) AND user_id=?`).run(...ids, userId);
  db.prepare(`DELETE FROM folders WHERE id IN (${ph}) AND user_id=?`).run(...ids, userId);
});

export const listFilesInFolders = (ids, userId) => {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM files WHERE folder_id IN (${ph}) AND user_id=?`).all(...ids, userId);
};

/* ---------- files ---------- */
export const insertFile = db.transaction((userId, categoryId, folderId, name, mime, size, chunks, channelMessageId = 0) => {
  const info = db
    .prepare(
      `INSERT INTO files (user_id, category_id, folder_id, name, mime, size, chunk_count, channel_message_id) VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(userId, categoryId, folderId, name, mime, size, chunks.length, channelMessageId);
  const fileId = info.lastInsertRowid;
  const stmt = db.prepare(
    `INSERT INTO chunks (file_id, idx, chat_id, message_id, tg_file_id, size) VALUES (?,?,?,?,?,?)`
  );
  chunks.forEach((c, i) => stmt.run(fileId, i, c.chatId, c.messageId, c.tgFileId, c.size));
  return fileId;
});

export const getFile = (id, userId) =>
  db.prepare('SELECT * FROM files WHERE id=? AND user_id=?').get(id, userId);

export const getChunks = (fileId) =>
  db.prepare('SELECT * FROM chunks WHERE file_id=? ORDER BY idx').all(fileId);

export const listFiles = (userId, categoryId, folderId) =>
  db
    .prepare(
      `SELECT * FROM files WHERE user_id=? AND trashed=0 AND category_id IS ? AND folder_id IS ? ORDER BY name COLLATE NOCASE`
    )
    .all(userId, categoryId ?? null, folderId ?? null);

export const listTrashedFiles = (userId) =>
  db.prepare('SELECT * FROM files WHERE user_id=? AND trashed=1 ORDER BY name').all(userId);

export const listStarredFiles = (userId) =>
  db.prepare('SELECT * FROM files WHERE user_id=? AND trashed=0 AND starred=1 ORDER BY name').all(userId);

export const searchFiles = (userId, q) =>
  db
    .prepare(`SELECT * FROM files WHERE user_id=? AND trashed=0 AND name LIKE ? ORDER BY created_at DESC LIMIT 200`)
    .all(userId, `%${q}%`);

export const updateFile = (id, userId, fields) => {
  const allowed = ['name', 'starred', 'trashed', 'folder_id', 'category_id'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k}=?`);
      vals.push(fields[k]);
    }
  }
  if (!sets.length) return;
  vals.push(id, userId);
  db.prepare(`UPDATE files SET ${sets.join(', ')} WHERE id=? AND user_id=?`).run(...vals);
};

export const deleteFileRow = (id, userId) =>
  db.prepare('DELETE FROM files WHERE id=? AND user_id=?').run(id, userId);

export const storageStats = (userId) =>
  db
    .prepare(`SELECT COALESCE(SUM(size),0) AS used, COUNT(*) AS count FROM files WHERE user_id=? AND trashed=0`)
    .get(userId);

/* ---------- shares ---------- */
export const createShare = (userId, fileId, token) =>
  db
    .prepare('INSERT INTO shares (user_id, file_id, token) VALUES (?,?,?)')
    .run(userId, fileId, token).lastInsertRowid;

export const listShares = (userId) =>
  db
    .prepare(
      `SELECT s.id, s.token, s.created_at, s.file_id, f.name, f.size, f.mime
       FROM shares s JOIN files f ON f.id = s.file_id WHERE s.user_id=? ORDER BY s.created_at DESC`
    )
    .all(userId);

export const getShareByToken = (token) =>
  db
    .prepare(
      `SELECT s.token, s.created_at, s.user_id, f.id AS file_id, f.category_id, f.name, f.size, f.mime
       FROM shares s JOIN files f ON f.id = s.file_id WHERE s.token=? AND f.trashed=0`
    )
    .get(token);

export const getShareForUser = (id, userId) =>
  db.prepare('SELECT * FROM shares WHERE id=? AND user_id=?').get(id, userId);

export const deleteShare = (id, userId) =>
  db.prepare('DELETE FROM shares WHERE id=? AND user_id=?').run(id, userId);


