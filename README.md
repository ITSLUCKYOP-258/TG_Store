# TGStore — Unlimited Cloud Drive Powered by TGSTORE

A full-stack web app that gives you a Google-Drive-style interface on top of **Telegram's infrastructure** as unlimited storage. Two storage modes:

1. **Bot storage** — uploads are chunked into a private Telegram channel via the Bot API (unlimited drive).
2. **My Telegram (MTProto)** — sign in with your **phone number**, receive the OTP **inside your Telegram app** (plus optional 2FA password), and browse/download **all files and media that already exist in your own Telegram** — every chat, channel and Saved Messages.

> Built with React + Vite (frontend) and Node.js + Express + SQLite (backend).

## Features

- 🔐 **Three sign-in methods**: phone number + Telegram OTP (MTProto), Telegram Login Widget, or dev login
- 📨 **My Telegram browser** — list all your chats/channels, filter media (photos / videos / documents / music), preview inline and stream-download with Range support
- 📁 **Folders** — create, rename, move (tree picker), breadcrumbs
- 📤 **Uploads** — drag & drop or picker, per-file progress, chunked into 19 MB parts (Bot API safe)
- 📥 **Streaming downloads** — with full HTTP **Range** support (video seeking works)
- 👁 **Previews** — images, video, audio, PDF, text/code
- ⭐ **Starred**, 🗑 **Trash** (restore / delete forever / empty), 🔍 **Search**
- 🔗 **Public share links** with revoke, public view/download page (`/s/:token`)
- 📊 Storage usage dashboard (unlimited quota)

## Project layout

```
tgstore/
├── client/          React + Vite + Tailwind SPA
│   └── src/
│       ├── pages/   Login, Drive, ShareView
│       └── components/ Sidebar, ItemList, Modals, SharedLinks
└── server/          Express API + SQLite + Telegram Bot API
    └── src/
        ├── telegram.js   Bot API client (upload chunks, stream, verify login)
        ├── stream.js     Range-aware streaming from Telegram chunks
        ├── db.js         SQLite schema & queries
        └── routes/       auth, drive, files, shares
```

## How storage works

1. When you upload a file, the server saves it to a temp file, then splits it into **19 MB chunks**.
2. Each chunk is uploaded to your **private Telegram storage channel** as a document (`sendDocument`), and the returned `file_id` + message id are saved in SQLite.
3. On download, the server fetches each chunk via `getFile` + the file endpoint and streams it to the browser (assembling ranges across chunks), so the client never talks to Telegram directly.

## Setup

### 1. Create the Telegram bot & storage channel

1. Message **@BotFather** → `/newbot` → copy the **bot token**.
2. Create a **private channel** (or supergroup) in Telegram — this is where files are stored.
3. Add your bot as an **administrator** of that channel (needs "Post messages").
4. Get the channel id: forward any message from the channel to **@userinfobot** (it looks like `-1001234567890`).

### 2b. Enable phone-number login (MTProto — "My Telegram")
1. Go to **https://my.telegram.org** → log in with your phone → **API development tools**
2. Create an app → copy the **api_id** and **api_hash**
3. Put them in `server/.env`:

```env
MT_API_ID=1234567
MT_API_HASH=0123456789abcdef0123456789abcdef
```

Restart the server — a **"Log in with your Telegram account"** card now appears on the login page (and in **My Telegram** inside the app): enter your number → Telegram sends you a code **in the app** → enter the code → (optional 2FA password) → done. You can then browse every chat's media and download or preview it.

> ⚠️ Security: a connected MTProto session gives this server full access to your Telegram account (like any Telegram Web client). Use **Disconnect Telegram account** in the My Telegram panel to revoke it.

### 2. Configure the server (Bot storage)

```bash
cd server
cp .env.example .env   # then edit .env
```

```env
BOT_TOKEN=123456:ABC-...
STORAGE_CHANNEL_ID=-1001234567890
JWT_SECRET=some-long-random-string
DEV_LOGIN=true          # one-click local login
BOT_USERNAME=YourBot    # bot username (enables the Telegram Login Widget)
PUBLIC_BASE_URL=        # e.g. https://yourdomain.com (needed for the widget)
PORT=8787
```

> Note: the Telegram Login Widget only works on a public **HTTPS** domain. Locally, use the **Dev Login** button.

### 3. Install & run

```bash
# from the repo root
npm run setup          # installs server & client deps

npm run dev:server     # API on http://localhost:8787
npm run dev:client     # UI  on http://localhost:5173 (proxies /api)
```

Open **http://localhost:5173** → sign in (Dev Login locally) → upload files.

### Production build

```bash
npm run build          # builds client/dist
npm start              # serves API + built frontend on :8787
```

## Health check

`GET /api/health` verifies the bot token and that the bot can post to the storage channel.

## API overview (all under `/api`)

| Method | Path | Description |
|---|---|---|
| POST | `/auth/telegram` | Verify Telegram Login Widget payload, set session |
| POST | `/auth/dev` | Dev login (when `DEV_LOGIN=true`) |
| GET | `/drive?view=&folder=&q=` | List folders/files (drive, starred, trash, search) |
| POST/PATCH/DELETE | `/folders...` | Folder CRUD (+ recursive permanent delete) |
| POST | `/files/upload` | Multipart upload → chunk → store in Telegram |
| PATCH/DELETE | `/files/:id` | Rename / star / trash / move / delete forever |
| GET | `/files/:id/download` \| `/raw` | Streamed download / inline preview (Range-aware) |
| POST | `/trash/empty` | Permanently empty trash |
| GET/POST/DELETE | `/shares...` | Manage public links |
| GET | `/public/:token` (+ `/download`, `/raw`) | Public share endpoints |
| GET | `/storage`, `/health` | Stats & Telegram connectivity check |

## Notes & limits

- Bot API caps: uploads ≤ 50 MB (we chunk at 19 MB), `getFile` downloads ≤ 20 MB (all chunks comply), so file size is effectively unlimited — only bandwidth/patience.
- Deleting a file forever also deletes its Telegram messages in the storage channel (best effort).
- `tgstore.db` (SQLite, WAL) is created automatically in `server/`.

## Accounts, devices & the admin panel

- An account is identified by its **Telegram ID**. Logging in with the same Telegram account from another phone/browser opens the *same* account (same files, same ID) — it is only added to the list of **devices** (Sidebar → your name → *My account & devices*, where you can sign devices out).
- **/admin** (needs `ADMIN_KEY`) shows every user with Telegram ID, name, @username, phone, devices online, files, storage, last login, last device/IP; a live **Login activity** feed (who logged in/out, when, device, browser, OS, IP, method); and per-user detail with *Block*, *Log out all devices*, *Disconnect Telegram* and per-device sign-out. CSV export included.
- **Persistent storage is required in production.** Set `DATA_DIR` to a persistent disk. On hosts with an ephemeral disk (e.g. Render free) the SQLite DB is wiped on every restart, so users get brand-new ids and lose all categories/files.
- Keep `DEV_LOGIN=false` in production: dev login is one shared account, separate from every Telegram account.
