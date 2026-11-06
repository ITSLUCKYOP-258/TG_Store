// Debug: send a fresh document -> getFile -> download, all in one go
import 'dotenv/config';
import db from './src/db.js';

const token = process.env.BOT_TOKEN;
const chat = process.env.STORAGE_CHANNEL_ID;

// 1. fresh sendDocument
const form = new FormData();
form.append('chat_id', chat);
form.append('caption', 'TGSTORE|debug');
form.append('document', new Blob(['fresh debug upload ' + Date.now()], { type: 'text/plain' }), 'debug.txt');
const send = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
const sendJson = await send.json();
console.log('SEND:', send.status, sendJson.ok ? `message_id=${sendJson.result.message_id} file_id=${sendJson.result.document.file_id}` : JSON.stringify(sendJson));
if (!sendJson.ok) process.exit(1);

const fileId = sendJson.result.document.file_id;

// 2. getFile immediately
const g = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ file_id: fileId }),
});
const gj = await g.json();
console.log('GETFILE:', g.status, JSON.stringify(gj));

// 3. download
if (gj.ok) {
  const d = await fetch(`https://api.telegram.org/file/bot${token}/${gj.result.file_path}`);
  console.log('DOWNLOAD:', d.status, JSON.stringify((await d.text()).slice(0, 100)));
}

// 4. also try getFile on the OLD stored file_id again
const old = db.prepare('SELECT * FROM chunks ORDER BY id DESC LIMIT 1').get();
console.log('OLD CHUNK msg_id:', old.message_id);
const g2 = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ file_id: old.tg_file_id }),
});
console.log('OLD GETFILE:', g2.status, await g2.text());
