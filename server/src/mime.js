/**
 * Resolve a browser-usable Content-Type from the stored MIME + filename.
 * Some uploads arrive with a generic `application/octet-stream` MIME (the
 * browser didn't report a type). Without a video/* or audio/* Content-Type
 * the browser won't use its media player, so no volume/sound controls show.
 * Falls back to the file extension for well-known media types.
 */
const EXT_MIME = {
  // video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  // images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

export function resolveMime(name, mime) {
  if (mime && mime !== 'application/octet-stream') return mime;
  const ext = String(name || '').split('.').pop().toLowerCase();
  return EXT_MIME[ext] || mime || 'application/octet-stream';
}
