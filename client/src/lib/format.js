export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const ICONS = {
  image: { icon: '🖼️', color: 'bg-emerald-100 text-emerald-700' },
  video: { icon: '🎬', color: 'bg-rose-100 text-rose-700' },
  audio: { icon: '🎵', color: 'bg-purple-100 text-purple-700' },
  pdf: { icon: '📕', color: 'bg-red-100 text-red-700' },
  doc: { icon: '📄', color: 'bg-blue-100 text-blue-700' },
  sheet: { icon: '📊', color: 'bg-green-100 text-green-700' },
  archive: { icon: '🗜️', color: 'bg-amber-100 text-amber-700' },
  code: { icon: '⌨️', color: 'bg-slate-200 text-slate-700' },
  text: { icon: '📝', color: 'bg-sky-100 text-sky-700' },
  file: { icon: '📦', color: 'bg-slate-100 text-slate-600' },
};

export function fileKind(file) {
  if (!file) return 'file';
  const mime = file.mime || '';
  const ext = (file.name?.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'archive';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'json', 'html', 'css', 'go', 'rs', 'java', 'c', 'cpp', 'sh'].includes(ext))
    return 'code';
  if (mime.startsWith('text/') || ['txt', 'md', 'log'].includes(ext)) return 'text';
  return 'file';
}

export function fileIcon(file) {
  return ICONS[fileKind(file)];
}

/** "05 Nov 2026, 11:57" in the viewer's timezone (server timestamps are UTC). */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "5 min ago", "2 h ago", "3 d ago" */
export function timeAgo(iso) {
  if (!iso) return 'never';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(iso);
}
