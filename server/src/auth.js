import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSessionRow,
  getSession,
  getUserById,
  touchSession,
} from './db.js';

export const COOKIE_NAME = 'tgstore_token';
const SESSION_DAYS = 30;

/* ------------------------------------------------------------------ */
/* JWT secret — never crash (or sign with `undefined`) when it's unset */
/* ------------------------------------------------------------------ */
function resolveSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== 'change-me-to-a-long-random-string') {
    return process.env.JWT_SECRET;
  }
  // Generate once and persist next to the DB, so restarts don't log everyone out.
  // Mirror db.js: if DATA_DIR isn't writable (e.g. /data not mounted on Render),
  // fall back to the server dir instead of losing the secret every restart.
  const fallbackDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  let dir = process.env.DATA_DIR || fallbackDir;
  if (process.env.DATA_DIR) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      dir = fallbackDir;
    }
  }
  const file = path.join(dir, '.jwt_secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    try {
      fs.writeFileSync(file, secret, { mode: 0o600 });
    } catch {
      /* read-only FS: secret lives only for this process */
    }
    console.warn('[auth] JWT_SECRET is not set — generated a persistent one. Set JWT_SECRET in your env for production.');
    return secret;
  }
}
const SECRET = resolveSecret();

/* ------------------------------------------------------------------ */
/* Tiny user-agent parser (device / browser / OS) for the admin panel  */
/* ------------------------------------------------------------------ */
export function parseUserAgent(ua = '') {
  const s = String(ua);
  let os = 'Unknown OS';
  if (/Android\s([\d.]+)/i.test(s)) os = `Android ${RegExp.$1}`;
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Windows NT 10/i.test(s)) os = 'Windows 10/11';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/CrOS/i.test(s)) os = 'ChromeOS';
  else if (/Linux/i.test(s)) os = 'Linux';

  let browser = 'Unknown browser';
  if (/EdgA?\/|Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/Firefox|FxiOS/i.test(s)) browser = 'Firefox';
  else if (/Chrome|CriOS/i.test(s)) browser = 'Chrome';
  else if (/Safari/i.test(s)) browser = 'Safari';
  else if (/okhttp|Capacitor/i.test(s)) browser = 'TGStore App';

  let device = 'Desktop';
  if (/iPad|Tablet/i.test(s)) device = 'Tablet';
  else if (/Mobi|Android|iPhone|iPod/i.test(s)) device = 'Mobile';
  // Capture the Android model, e.g. "SM-G991B" or "Pixel 7"
  const model = /;\s*([^;()]+?)\s+Build\//i.exec(s)?.[1] || /Android[^;]*;\s*([^;)]+)\)/i.exec(s)?.[1];
  if (model && !/^(U|wv|K)$/i.test(model.trim())) device = `Mobile (${model.trim()})`;
  return { device, browser, os };
}

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (fwd || req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

/**
 * Create a device session + login-history row and return a signed token.
 * The token carries the session id so a single device can be revoked.
 */
export function issueSession(req, userId, method) {
  const id = crypto.randomUUID();
  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  const { device, browser, os } = parseUserAgent(ua);
  createSessionRow({
    id,
    userId,
    method,
    ip: clientIp(req),
    userAgent: ua,
    device,
    browser,
    os,
  });
  return jwt.sign({ uid: userId, sid: id }, SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const isHttps = (req) =>
  req?.secure || String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0] === 'https';

export function setAuthCookie(res, token, req) {
  const secure = req && isHttps(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}${secure}`
  );
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function verify(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

const lastTouch = new Map(); // sid -> ms, so we don't write on every request

/** Attaches req.userId / req.sessionId when a valid, non-revoked session is present. */
export function attachUser(req, _res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // Explicit Authorization header wins over a (possibly stale) cookie so a
  // device can never be silently signed in as a different account.
  const candidates = [bearer, readCookie(req, COOKIE_NAME)].filter(Boolean);
  for (const token of candidates) {
    const payload = verify(token);
    if (!payload?.uid) continue;

    // Tokens without `sid` were issued before sessions existed; accept them
    // once, as long as the user exists and is not banned.
    if (payload.sid) {
      const sess = getSession(payload.sid);
      if (!sess || sess.revoked || sess.user_id !== payload.uid) continue;
      const now = Date.now();
      if (now - (lastTouch.get(sess.id) || 0) > 60_000) {
        lastTouch.set(sess.id, now);
        try {
          touchSession(sess.id);
        } catch {
          /* non-fatal */
        }
      }
      req.sessionId = sess.id;
    }
    const user = getUserById(payload.uid);
    if (!user || user.banned) continue;
    req.userId = user.id;
    break;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
