import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getFilePath, invalidateFilePath, fileDownloadUrl } from './telegram.js';
import { getMessage, downloadBytes } from './mtproto.js';
import { resolveMime } from './mime.js';
import * as db from './db.js';

/** True when the client disconnected before we finished — not a real error. */
const isPrematureClose = (err) =>
  err?.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
  /premature close/i.test(err?.message || '') ||
  err?.code === 'ECONNRESET';

/**
 * A chunk stored via the USER's MTProto session has a numeric media id in
 * tg_file_id; legacy Bot-API chunks carry a base64 file_id string instead.
 */
const isMTPath = (c) => /^\d+$/.test(String(c?.tg_file_id || ''));

/** Yield [length] bytes from an MTProto-stored chunk, fetching ONLY the
 * requested byte window from Telegram (critical for video: the browser
 * makes small Range requests for metadata/moov + audio tracks — downloading
 * the whole file per request stalls playback and drops audio). */
async function* mtChunkBytes(userId, c, file, { skip, length }) {
  const accessHash = file?.category_id
    ? db.getCategory(file.category_id, userId)?.access_hash || null
    : null;
  const got = await getMessage(userId, c.chat_id, c.message_id, accessHash);
  if (!got) {
    throw new Error(
      `Stored message ${c.message_id} not found in channel ${c.chat_id} — ` +
      'it may have been deleted from your Telegram channel.'
    );
  }
  const start = Math.max(0, Number(skip || 0));
  const end = length === Infinity ? Infinity : start + Math.max(0, Number(length || 0)) - 1;
  for await (const buf of downloadBytes(got.client, got.loc.location, { start, end })) {
    yield buf;
  }
}

/** Yield the file's bytes across all Telegram chunks, optionally a byte range. */
export async function* telegramFileBytes(userId, chunks, file, { start = 0, end = Infinity } = {}) {
  let offset = 0; // absolute offset where the current chunk begins
  for (const c of chunks) {
    const chunkEnd = offset + Number(c.size) - 1;
    const from = Math.max(start, offset);
    const to = Math.min(end, chunkEnd);
    if (from <= to && end >= offset && start <= chunkEnd) {
      const skip = from - offset;
      const length = to - from + 1;
      if (isMTPath(c)) {
        // ---- new path: user's own Telegram channel, streamed via their session
        for await (const buf of mtChunkBytes(userId, c, file, { skip, length })) yield buf;
      } else {
        // ---- legacy path: Bot API chunks stored in the shared storage channel
        // A freshly-uploaded file can briefly 404 on Telegram's CDN with the
        // premature file_path — on failure, drop the cached path, resolve a
        // fresh one via getFile and retry once before giving up.
        const fetchChunk = () => getFilePath(c.tg_file_id).then((fp) => fetch(fileDownloadUrl(fp)));
        let upstream = await fetchChunk();
        if (!upstream.ok) {
          invalidateFilePath(c.tg_file_id);
          upstream = await fetchChunk();
        }
        if (!upstream.ok) throw new Error(`Telegram file fetch failed: ${upstream.status}`);
        const nodeStream = Readable.fromWeb(upstream.body);
        let rskip = skip;
        let remaining = length;
        for await (const buf of nodeStream) {
          if (remaining <= 0) break;
          let b = buf;
          if (rskip > 0) {
            if (rskip >= buf.length) {
              rskip -= buf.length;
              continue;
            }
            b = buf.subarray(rskip);
            rskip = 0;
          }
          if (b.length > remaining) b = b.subarray(0, remaining);
          remaining -= b.length;
          yield b;
        }
      }
    }
    offset = chunkEnd + 1;
    if (offset > end) break;
  }
}

/**
 * Stream a file (given as DB chunk rows + metadata) to the HTTP response,
 * with full HTTP Range support (needed for video seeking).
 */
export function serveFileStream(chunks, file, req, res, { asAttachment, userId }) {
  const size = Number(file.size || 0);
  const baseHeaders = {
    'Content-Type': resolveMime(file.name, file.mime),
    'Accept-Ranges': 'bytes',
    // Range requests return 200 (full) vs 206 (partial) for the same URL,
    // so caches MUST key on the Range header to avoid serving a stale
    // full-file response that breaks audio/video track discovery.
    'Vary': 'Range',
    'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': 'private, max-age=3600',
  };
  const source = () => telegramFileBytes(userId, chunks, file, {});

  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start == null) {
      start = Math.max(0, size - (end ?? 0));
      end = size - 1;
    } else if (end == null || end >= size) {
      end = size - 1;
    }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return pipeline(
      Readable.from(telegramFileBytes(userId, chunks, file, { start, end })),
      res
    ).catch((err) => {
      if (!res.writableEnded && !isPrematureClose(err)) console.error('stream error:', err.message);
      res.end();
    });
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return pipeline(Readable.from(source()), res).catch((err) => {
    if (!res.writableEnded && !isPrematureClose(err)) console.error('stream error:', err.message);
    res.end();
  });
}
