import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { attachUser } from './auth.js';
import { loadFileConfig } from './config.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import categoriesRoutes from './routes/categories.js';
import foldersRoutes from './routes/folders.js';
import driveRoutes from './routes/drive.js';
import filesRoutes from './routes/files.js';
import sharesRoutes, { publicRouter as publicShareRoutes } from './routes/shares.js';
import mtRoutes from './routes/mt.js';
import { healthCheck, getChunkSize } from './telegram.js';
import { isConfigured as mtConfigured } from './mtproto.js';

// config.json (optional self-host override) — apply before anything reads env
loadFileConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
// Capacitor Android uses capacitor://localhost; iOS uses ionic://localhost
// Also allow the Vite dev server and any explicitly configured origin.
const ALLOWED_ORIGINS = new Set(
  [
    process.env.CLIENT_ORIGIN,
    process.env.RENDER_EXTERNAL_URL,
    process.env.PUBLIC_BASE_URL,
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'http://localhost:5173',
    'http://localhost:8787',
    'http://10.0.2.2:8787', // Android emulator loopback to host
  ].filter(Boolean)
);

app.use(
  cors({
    origin: (origin, cb) => {
      // No origin = curl / native fetch without CORS headers → allow
      if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      // If no specific CLIENT_ORIGIN is set, be permissive (dev mode)
      if (!process.env.CLIENT_ORIGIN) return cb(null, true);
      // Never reject the app's own origin (any phone / LAN IP / domain that
      // is actually serving the page) — that was breaking logins on other devices.
      cb(null, false);
    },
    credentials: true,
  })
);

// Same-origin requests carry an Origin header too; `cors` with a false result
// simply omits CORS headers (the browser still allows same-origin) instead of
// throwing a 500 like before.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

// Request log (no query strings — they can contain tokens / phone numbers)
app.use((req, _res, next) => {
  if (process.env.LOG_REQUESTS === 'true') console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', async (_req, res) => {
  const configured =
    Boolean(process.env.BOT_TOKEN) && Boolean(process.env.STORAGE_CHANNEL_ID);
  if (!configured) {
    return res.json({
      ok: false,
      configured,
      chunkSize: getChunkSize(),
      message: 'Set BOT_TOKEN and STORAGE_CHANNEL_ID in server/.env',
    });
  }
  try {
    const info = await healthCheck();
    res.json({ ok: info.ok, configured, chunkSize: getChunkSize(), ...info });
  } catch (err) {
    res.json({ ok: false, configured, error: err.message });
  }
});

// API JSON must never be cached by browsers / proxies / service workers (it is
// per-user). Streaming routes (files raw/download/thumb) set their own headers.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/folders', foldersRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/shares', sharesRoutes);
// The public share page (/s/:token) calls /api/public/:token — this mount was missing (404).
app.use('/api/public', publicShareRoutes);
app.use('/api/mt', mtRoutes);

// Unknown /api routes must answer JSON, not the SPA's index.html
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built frontend in production
const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  // Hashed assets are content-addressed -> cache forever.
  // index.html must NEVER be cached so fresh deploys are picked up immediately.
  app.use(
    express.static(distDir, {
      maxAge: '365d',
      immutable: true,
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'), {
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const port = Number(process.env.PORT || 8787);

// A stray async error should never take the whole server down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason?.stack || reason);
});

app.listen(port, () => {
  console.log(`\n  TGStore server running  ->  http://localhost:${port}`);
  console.log(`  Chunk size: ${(getChunkSize() / 1024 / 1024).toFixed(0)} MB (Bot API limits)`);
  console.log(
    `  Telegram storage: ${process.env.BOT_TOKEN ? 'bot token set' : 'BOT_TOKEN MISSING'} | ${
      process.env.STORAGE_CHANNEL_ID ? 'channel set' : 'STORAGE_CHANNEL_ID MISSING'
    }`
  );
  console.log(
    `  Dev login: ${process.env.DEV_LOGIN === 'true' ? 'enabled (http://localhost:8787/api/auth/dev)' : 'disabled'}`
  );
  console.log(`  Admin panel: ${process.env.ADMIN_KEY ? '/admin (ADMIN_KEY set)' : 'DISABLED — set ADMIN_KEY'}`);
  if (process.env.NODE_ENV === 'production' && !process.env.DATA_DIR) {
    console.warn(
      '\n  ⚠ DATA_DIR is not set. If your host has an ephemeral disk (Render free plan, etc.) the SQLite DB is\n' +
      '    wiped on every restart/redeploy: users get NEW ids and all categories/files vanish.\n' +
      '    Mount a persistent disk and set DATA_DIR to it (e.g. /data).\n'
    );
  }
  if (process.env.NODE_ENV === 'production' && process.env.DEV_LOGIN === 'true') {
    console.warn('  ⚠ DEV_LOGIN=true in production — anyone can sign in as the shared Dev account. Set DEV_LOGIN=false.\n');
  }
});
