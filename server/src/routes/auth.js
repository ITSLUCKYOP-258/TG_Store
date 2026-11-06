import { Router } from 'express';
import {
  upsertTelegramUser,
  createDevUser,
  getUserById,
  listUserSessions,
  revokeSession,
  revokeAllSessions,
} from '../db.js';
import { verifyLoginWidget } from '../telegram.js';
import { issueSession, setAuthCookie, clearAuthCookie } from '../auth.js';

const router = Router();

/**
 * The account is identified by its TELEGRAM id (`tgId`). `id` is just the
 * internal database row. The same Telegram account therefore always shows the
 * same tgId / name / phone on every device.
 */
export const publicUser = (u) => ({
  id: u.id,
  tgId: u.tg_id || null,
  name:
    [u.first_name, u.last_name].filter(Boolean).join(' ') ||
    (u.is_dev ? 'Dev User' : 'Telegram User'),
  username: u.username || null,
  phone: u.mt_phone ? (String(u.mt_phone).startsWith('+') ? u.mt_phone : `+${u.mt_phone}`) : null,
  photoUrl: u.photo_url || null,
  isDev: !!u.is_dev,
  telegramConnected: !!u.mt_session,
});

/** Create the device session, set the cookie, and build the login response. */
export function finishLogin(req, res, user, method) {
  const token = issueSession(req, user.id, method);
  setAuthCookie(res, token, req);
  // Return token in body so Capacitor (native) apps can persist it in localStorage
  return { user: publicUser(getUserById(user.id)), token };
}

/** Telegram Login Widget callback. Accepts GET (widget redirect) or POST (fetch). */
router.get('/telegram', (req, res) => {
  if (!verifyLoginWidget(req.query)) {
    return res.status(401).json({ error: 'Telegram login verification failed' });
  }
  const user = upsertTelegramUser(req.query);
  if (user.banned) return res.status(403).json({ error: 'This account has been blocked.' });
  res.json(finishLogin(req, res, user, 'telegram-widget'));
});

router.post('/telegram', (req, res) => {
  if (!verifyLoginWidget(req.body || {})) {
    return res.status(401).json({ error: 'Telegram login verification failed' });
  }
  const user = upsertTelegramUser(req.body);
  if (user.banned) return res.status(403).json({ error: 'This account has been blocked.' });
  res.json(finishLogin(req, res, user, 'telegram-widget'));
});

/** Local development login (enabled with DEV_LOGIN=true in server/.env). */
router.post('/dev', (req, res) => {
  if (process.env.DEV_LOGIN !== 'true') {
    return res.status(403).json({ error: 'Dev login is disabled' });
  }
  const user = createDevUser(req.body?.name);
  res.json(finishLogin(req, res, user, 'dev'));
});

router.get('/me', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = getUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user: publicUser(user), sessionId: req.sessionId || null });
});

router.post('/logout', (req, res) => {
  if (req.sessionId) revokeSession(req.sessionId, req.userId);
  clearAuthCookie(res);
  res.json({ ok: true });
});

/* ---------- my devices ---------- */
const shapeSession = (s, currentId) => ({
  id: s.id,
  method: s.method,
  ip: s.ip,
  device: s.device,
  browser: s.browser,
  os: s.os,
  createdAt: s.created_at,
  lastSeen: s.last_seen,
  current: s.id === currentId,
});

router.get('/sessions', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ sessions: listUserSessions(req.userId).map((s) => shapeSession(s, req.sessionId)) });
});

router.delete('/sessions/:id', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const ok = revokeSession(String(req.params.id), req.userId);
  if (!ok) return res.status(404).json({ error: 'Session not found' });
  if (req.params.id === req.sessionId) clearAuthCookie(res);
  res.json({ ok: true });
});

/** Sign out of every OTHER device (keeps this one). */
router.post('/logout-others', (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
  const n = revokeAllSessions(req.userId, req.sessionId || null);
  res.json({ ok: true, revoked: n });
});

/** Frontend asks for config needed to render the login widget. */
router.get('/config', (_req, res) => {
  const botUsername = process.env.BOT_USERNAME || '';
  const publicUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  res.json({
    telegramLoginEnabled: Boolean(botUsername) && Boolean(publicUrl),
    botUsername,
    devLoginEnabled: process.env.DEV_LOGIN === 'true',
  });
});

export default router;
