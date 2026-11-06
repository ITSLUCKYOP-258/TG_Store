import { Router } from 'express';
import crypto from 'node:crypto';
import {
  listUsers,
  getUserStats,
  getUserDetail,
  listLoginEvents,
  setUserBanned,
  revokeSession,
  revokeAllSessions,
} from '../db.js';
import { clientIp } from '../auth.js';
import { invalidateUserSession } from '../mtproto.js';

const router = Router();

/**
 * Admin endpoints — protected by the ADMIN_KEY environment variable.
 * Every request must send header:  x-admin-key: <ADMIN_KEY>
 * If ADMIN_KEY is not set, all admin endpoints are disabled (404).
 */
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const failures = new Map(); // ip -> [timestamps]
function requireAdminKey(req, res, next) {
  const key = process.env.ADMIN_KEY;
  // No key configured -> admin API is completely disabled
  if (!key) return res.status(404).json({ error: 'Not found' });

  const ip = clientIp(req);
  const now = Date.now();
  const recent = (failures.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 10) {
    return res.status(429).json({ error: 'Too many wrong admin keys — try again in 15 minutes.' });
  }
  if (!safeEqual(req.headers['x-admin-key'] || '', key)) {
    recent.push(now);
    failures.set(ip, recent);
    return res.status(401).json({ error: 'Invalid admin key' });
  }
  next();
}

router.use(requireAdminKey);

/** Quick summary: users, devices, logins, files, storage. */
router.get('/stats', (_req, res) => {
  res.json(getUserStats());
});

/** Every account that has ever logged in (no secrets). */
router.get('/users', (_req, res) => {
  res.json({ users: listUsers() });
});

/** One account: devices, login history, categories, latest files. */
router.get('/users/:id', (req, res) => {
  const detail = getUserDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: 'User not found' });
  res.json(detail);
});

/** Who logged in (and out), when, from which device / IP. */
router.get('/logins', (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  res.json({ logins: listLoginEvents(limit) });
});

/** Block an account: kills every session and disconnects its Telegram session. */
router.post('/users/:id/ban', async (req, res) => {
  const id = Number(req.params.id);
  if (!getUserDetail(id)) return res.status(404).json({ error: 'User not found' });
  setUserBanned(id, true);
  revokeAllSessions(id);
  res.json({ ok: true });
});

router.post('/users/:id/unban', (req, res) => {
  const id = Number(req.params.id);
  if (!getUserDetail(id)) return res.status(404).json({ error: 'User not found' });
  setUserBanned(id, false);
  res.json({ ok: true });
});

/** Sign a user out of every device. */
router.post('/users/:id/logout-all', (req, res) => {
  const n = revokeAllSessions(Number(req.params.id));
  res.json({ ok: true, revoked: n });
});

/** Disconnect the stored Telegram (MTProto) session of a user. */
router.post('/users/:id/disconnect-telegram', async (req, res) => {
  await invalidateUserSession(Number(req.params.id));
  res.json({ ok: true });
});

/** Sign out one device. */
router.delete('/sessions/:sid', (req, res) => {
  const ok = revokeSession(String(req.params.sid));
  if (!ok) return res.status(404).json({ error: 'Session not found or already revoked' });
  res.json({ ok: true });
});

export default router;
