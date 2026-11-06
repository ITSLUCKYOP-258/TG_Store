/**
 * Client-side helpers that bridge the raw API + file listings.
 * No encryption: files are stored and served as plaintext.
 */
import { rawUrl } from '../api.js';

const EXT_MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
};

export function resolveMime(name, mime) {
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = String(name || '').split('.').pop().toLowerCase();
  return EXT_MIME[ext] || mime || 'application/octet-stream';
}

/** Always false - no encryption anymore. */
export const isArmored = () => false;

/**
 * Pass-through for file listings - no decryption needed.
 * Flags every file as `encrypted: false`.
 */
export async function withDecryptedMeta(files, key) {
  if (!Array.isArray(files)) return [];
  return files.map((f) => ({ ...f, encrypted: false }));
}

/**
 * Decrypt a stored file to a temporary object URL (for <img>/<video>/<a>…).
 * Returns an ObjectUrlHandle; call revoke() when the element is released.
 */
export async function decryptToObjectUrl(file, key) {
  if (!file?.id) return null;
  const name = file.name || 'file';
  const mime = resolveMime(file.name, file.mime || 'application/octet-stream');
  const url = rawUrl(file.id);
  return { url, name, mime, revoke: () => {} };
}

/** Decrypt + download a stored file with the real filename. */
export async function downloadDecrypted(file, key) {
  if (file?._localUrl) {
    const a = document.createElement('a');
    a.href = file._localUrl;
    a.download = file.name || 'download';
    a.click();
    return true;
  }
  const a = document.createElement('a');
  a.href = rawUrl(file.id);
  a.download = file.name || 'download';
  a.click();
  return true;
}


