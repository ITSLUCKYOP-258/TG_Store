import SecureThumb from './SecureThumb.jsx';
import { isArmored } from '../lib/vault.js';

export default function MediaGrid({ media, onPreview, onDownload, onDelete, showSavedBadge }) {
  if (!media || media.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 text-5xl">📭</div>
        <p className="text-sm text-slate-500 dark:text-slate-400">No media found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {media.map((item, idx) => {
        const isEncrypted = Boolean(item.encrypted || isArmored(item.name));
        const isImage = gridKind(item) === 'image';
        const hasThumb = Boolean(item.thumbnail || item._localUrl || (isEncrypted && item.id && isImage));

        return (
          <div
            key={item.id || idx}
            className={`group relative aspect-square cursor-pointer overflow-hidden rounded-xl border transition hover:border-indigo-400 hover:shadow-md dark:border-white/5 dark:bg-[#17212b] dark:hover:border-sky-400/50 ${
              hasThumb ? 'border-slate-200 bg-slate-100' : 'border-slate-200 bg-white shadow-sm dark:shadow-none'
            }`}
            onClick={() => { if (!item._uploading) onPreview?.(item); }}
          >
            {item._localUrl ? (
              <img src={item._localUrl} alt={item.name} className="h-full w-full object-cover" />
            ) : isEncrypted && item.id && isImage ? (
              /* E2EE image: decrypt-on-scroll thumbnail — Telegram never sees it */
              <SecureThumb item={item} fallback={gridIcon(item)} />
            ) : (
              <>
                {/* Icon fallback (always rendered underneath) */}
                <div className={`flex h-full w-full items-center justify-center text-4xl ${!hasThumb ? 'pb-8' : ''}`}>
                  {gridIcon(item)}
                </div>

                {/* Real thumbnail on top — removes itself on load error to reveal the icon */}
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt={item.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={(e) => e.currentTarget.remove()}
                  />
                )}
              </>
            )}

            {/* Label strip: photo gradient for thumbnails, clean solid panel for non-media */}
            {hasThumb ? (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 pt-6">
                <p className="truncate text-xs font-semibold text-white drop-shadow-sm">{item.name || 'Untitled'}</p>
                {item.size && <p className="text-[10px] font-medium text-white/80 drop-shadow-sm">{formatBytes(item.size)}</p>}
              </div>
            ) : (
              <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 bg-slate-50/95 px-2.5 py-1.5 backdrop-blur-sm dark:border-white/5 dark:bg-[#111922]/95">
                <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{item.name || 'Untitled'}</p>
                {item.size && <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{formatBytes(item.size)}</p>}
              </div>
            )}

            {/* Actions: download & delete (hidden while uploading) */}
            {!item._uploading && (
              <div className="absolute right-2 top-2 flex gap-1 transition md:opacity-0 md:group-hover:opacity-100 z-10">
                {onDownload && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownload(item); }}
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition ${
                      hasThumb
                        ? 'bg-black/50 text-white hover:bg-black/75 backdrop-blur-sm'
                        : 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20'
                    }`}
                    aria-label="Download"
                  >
                    ⬇
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition ${
                      hasThumb
                        ? 'bg-black/50 text-red-400 hover:bg-black/75 backdrop-blur-sm'
                        : 'border border-slate-200 bg-white text-red-600 shadow-sm hover:bg-red-50 dark:border-white/10 dark:bg-white/10 dark:text-red-400 dark:hover:bg-red-500/20'
                    }`}
                    aria-label="Delete"
                  >
                    🗑
                  </button>
                )}
              </div>
            )}

            {/* Live Uploading Overlay */}
            {item._uploading && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 p-3 text-center text-white backdrop-blur-[2px]">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/20 text-sky-400 ring-2 ring-sky-400/40">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                </div>
                <span className="font-mono text-xs font-bold text-sky-300 drop-shadow">
                  {item._progress != null ? `${item._progress}%` : 'Uploading…'}
                </span>
                <span className="mt-0.5 text-[10px] text-slate-300 drop-shadow">
                  Uploading to Telegram
                </span>
                <div className="mt-2 h-1.5 w-3/4 overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-sky-300 transition-all duration-200"
                    style={{ width: `${Math.max(5, item._progress || 0)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Saved badge */}
            {showSavedBadge && (
              <div className="absolute left-2 top-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm dark:bg-[#3390ec]">
                Saved
              </div>
            )}

            {/* File type badge */}
            {(() => {
              const k = gridKind(item);
              const badgeClass = "absolute left-2 rounded px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm " + (hasThumb ? "bottom-2" : "bottom-10");
              if (k === 'video') return <div className={`${badgeClass} bg-black/75`}>▶ {item.duration || 'video'}</div>;
              if (k === 'audio') return <div className={`${badgeClass} bg-black/75`}>▶ audio</div>;
              if (k === 'pdf') return <div className={`${badgeClass} bg-red-600`}>PDF</div>;
              if (k === 'code') return <div className={`${badgeClass} bg-indigo-600 font-mono`}>{gridExt(item.name).toUpperCase()}</div>;
              if (k === 'text') return <div className={`${badgeClass} bg-slate-700`}>TXT</div>;
              if (k === 'archive') return <div className={`${badgeClass} bg-amber-600`}>ZIP</div>;
              if (k === 'doc') return <div className={`${badgeClass} bg-blue-600`}>DOC</div>;
              if (k === 'sheet') return <div className={`${badgeClass} bg-green-600`}>XLS</div>;
              return null;
            })()}
          </div>
        );
      })}
    </div>
  );
}

function gridExt(name) {
  return String(name || '').split('.').pop().toLowerCase();
}

/** Tile type by MIME first, extension fallback (some uploads are stored as application/octet-stream). */
function gridKind(item) {
  const mime = item.mime || '';
  const ext = gridExt(item.name);

  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['doc','docx'].includes(ext)) return 'doc';
  if (['xls','xlsx'].includes(ext)) return 'sheet';
  if (['ppt','pptx'].includes(ext)) return 'sheet';
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return 'archive';

  const codeExts = ['js','mjs','cjs','ts','tsx','jsx','py','rb','php','java','c','cpp','h','hpp','cs','go','rs','sh','bash','zsh','sql','graphql','vue','svelte','dart','swift','kt','r','lua','json','xml','html','htm','css','yaml','yml','toml'];
  if (codeExts.includes(ext)) return 'code';

  const textExts = ['txt','md','markdown','csv','log','ini','cfg','conf','env'];
  if (mime.startsWith('text/') || textExts.includes(ext)) return 'text';

  if (['mp4','m4v','webm','mov','mkv','avi'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','oga','m4a','flac','aac','opus'].includes(ext)) return 'audio';
  if (['jpg','jpeg','png','gif','webp','bmp','svg','heic','heif'].includes(ext)) return 'image';
  return 'other';
}

function gridIcon(item) {
  const k = gridKind(item);
  if (k === 'video') return '🎬';
  if (k === 'image') return '🖼';
  if (k === 'audio') return '🎵';
  if (k === 'pdf') return '📕';
  if (k === 'text') return '📄';
  if (k === 'code') return '💻';
  if (k === 'archive') return '🗜️';
  if (k === 'doc') return '📝';
  if (k === 'sheet') return '📊';
  return '📄';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}