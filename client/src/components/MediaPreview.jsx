import { useState, useEffect } from 'react';
import { rawUrl } from '../api.js';
import { useVault } from '../hooks/useVault';
import { decryptToObjectUrl, downloadDecrypted, isArmored, resolveMime } from '../lib/vault.js';

function previewExt(name) {
  return String(name || '').split('.').pop().toLowerCase();
}

/** Classify what kind of preview to show */
function previewKind(item) {
  const mime = item.mime || '';
  const ext = previewExt(item.name);

  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';

  const textExts = [
    'txt','md','markdown','csv','log','ini','cfg','conf','env','toml','yaml','yml',
    'xml','html','htm','css','json','js','mjs','cjs','ts','tsx','jsx',
    'py','rb','php','java','c','cpp','h','hpp','cs','go','rs',
    'sh','bash','zsh','sql','graphql','vue','svelte','dart','swift','kt','r','lua',
  ];
  if (mime.startsWith('text/') || textExts.includes(ext)) return 'text';

  if (['mp4','m4v','webm','mov','mkv','avi'].includes(ext)) return 'video';
  if (['mp3','wav','ogg','oga','m4a','flac','aac','opus'].includes(ext)) return 'audio';
  if (['jpg','jpeg','png','gif','webp','bmp','svg','heic','heif'].includes(ext)) return 'image';
  return 'other';
}

function previewSrc(item) {
  if (item.url) return item.url;
  if (item.id != null) return rawUrl(item.id);
  return '';
}

function fileIcon(item) {
  const ext = previewExt(item.name);
  if (ext === 'pdf') return '📕';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['xls','xlsx'].includes(ext)) return '📊';
  if (['ppt','pptx'].includes(ext)) return '📊';
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return '🗜️';
  if (['exe','dmg','apk','msi'].includes(ext)) return '⚙️';
  if (['ttf','otf','woff','woff2'].includes(ext)) return '🔤';
  return '📄';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}


/** Text / code viewer with line numbers + copy */
function TextViewer({ src, name }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setContent(null); setError(null);
    fetch(src, { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.text(); })
      .then(setContent)
      .catch((e) => setError(e.message));
  }, [src]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (error) return (
    <div className="flex flex-col items-center justify-center py-16 text-white/70">
      <div className="text-4xl mb-3">⚠️</div>
      <p className="text-sm">Could not load: {error}</p>
    </div>
  );
  if (content === null) return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
    </div>
  );

  const lines = content.split('\n');
  return (
    <div className="flex flex-col" style={{ maxHeight: '68dvh' }}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-white/10 rounded-t-xl">
        <span className="text-xs font-mono text-slate-400">
          {name} · {lines.length} lines · {(content.length / 1024).toFixed(1)} KB
        </span>
        <button
          onClick={handleCopy}
          className="text-xs px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition"
        >{copied ? '✓ Copied' : '⎘ Copy'}</button>
      </div>
      <div className="overflow-auto flex-1 bg-slate-900 rounded-b-xl">
        <table className="w-full text-xs font-mono leading-5 border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-white/5">
                <td className="select-none text-right text-slate-600 pl-3 pr-2 py-0 w-10 sticky left-0 bg-slate-900 border-r border-white/5">{i + 1}</td>
                <td className="px-4 py-0 text-slate-200 whitespace-pre">{line || ' '}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** PDF viewer — native browser rendering via iframe */
function PdfViewer({ src }) {
  return (
    <div className="w-full rounded-xl overflow-hidden bg-slate-800" style={{ height: '70dvh' }}>
      <iframe
        src={`${src}#toolbar=1&navpanes=0`}
        title="PDF Preview"
        className="w-full h-full border-0"
        allow="fullscreen"
      />
    </div>
  );
}

/** High-quality progressive image viewer: displays compressed preview immediately,
 * streams full-quality original bytes in background, transitions seamlessly once loaded. */
function ImagePreview({ item, fullSrc }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(false);
  // Never load thumbSrc if file is encrypted (ciphertext is not an image)
  const thumbSrc = !item?.encrypted ? (item.thumbnail || (item.id != null ? `/api/files/${item.id}/thumb` : null)) : null;

  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [fullSrc]);

  return (
    <div
      className={`relative flex items-center justify-center bg-black overflow-auto select-none ${
        zoom ? 'cursor-zoom-out' : 'cursor-zoom-in'
      }`}
      style={{ maxHeight: '72dvh', minHeight: '260px' }}
      onClick={() => setZoom((z) => !z)}
      title={zoom ? 'Click to fit screen' : 'Click for full original resolution'}
    >
      {/* Compressed thumbnail placeholder while full quality loads */}
      {thumbSrc && !loaded && !error && (
        <img
          src={thumbSrc}
          alt={item.name}
          className="w-full object-contain transition-all duration-300 pointer-events-none"
          style={{ maxHeight: '72dvh' }}
        />
      )}

      {/* Loading badge */}
      {!loaded && !error && (
        <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/90 backdrop-blur-md shadow-lg pointer-events-none">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-sky-400" />
          <span>{item?.encrypted ? 'Decrypting quality...' : 'Loading full quality...'}</span>
        </div>
      )}

      {/* Full quality image */}
      {fullSrc && (
        <img
          src={fullSrc}
          alt={item.name}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={`transition-opacity duration-300 ${
            zoom
              ? 'max-h-none w-auto max-w-none'
              : 'w-full object-contain'
          } ${loaded ? 'opacity-100 relative' : thumbSrc ? 'opacity-0 absolute inset-0 m-auto' : 'opacity-100'}`}
          style={zoom ? {} : { maxHeight: '72dvh' }}
        />
      )}

      {/* Full quality loaded indicator */}
      {loaded && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-emerald-400 backdrop-blur-md pointer-events-none">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Full Quality</span>
        </div>
      )}

      {/* Fallback if full quality fails */}
      {error && (
        <div className="p-8 text-center text-white/60">
          <div className="text-3xl mb-2">⚠️</div>
          <p className="text-sm">Could not load full quality image</p>
          {thumbSrc && <p className="text-xs text-white/40 mt-1">Showing compressed preview</p>}
        </div>
      )}
    </div>
  );
}

export default function MediaPreview({ item, onClose }) {
  const vault = useVault();
  // Decrypted object URL for E2EE files (null until resolved)
  const [decUrl, setDecUrl] = useState(item?._localUrl ? { url: item._localUrl, name: item.name, mime: item.mime } : null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState(null);

  const isEncrypted = Boolean(item?.encrypted || isArmored(item?.name));

  useEffect(() => {
    if (item?._localUrl) {
      setDecUrl({ url: item._localUrl, name: item.name, mime: item.mime });
      setDecrypting(false);
      return undefined;
    }

    setDecUrl(null);
    setDecryptError(null);

    if (!isEncrypted || !item?.id) {
      setDecrypting(false);
      return undefined;
    }

    const key = vault.getKey();
    if (!key) {
      if (vault.status === 'unlocking') {
        setDecrypting(true);
        return undefined;
      }
      setDecryptError('Vault is locked. Unlock vault to preview this encrypted file.');
      setDecrypting(false);
      return undefined;
    }

    let active = true;
    setDecrypting(true);
    decryptToObjectUrl(item, key)
      .then((h) => {
        if (!active) { h?.revoke?.(); return; }
        if (!h) {
          setDecryptError('Failed to decrypt file content.');
        } else {
          setDecUrl(h);
        }
      })
      .catch((err) => {
        if (active) setDecryptError(err?.message || 'Decryption failed');
      })
      .finally(() => {
        if (active) setDecrypting(false);
      });

    return () => {
      active = false;
      if (decUrl?.revoke && !item?._localUrl) decUrl.revoke();
    };
  }, [item?.id, item?.name, item?.encrypted, item?._localUrl, isEncrypted, vault.status]);

  if (!item) return null;

  const activeItem = {
    ...item,
    name: decUrl?.name || item.name,
    mime: decUrl?.mime || item.mime,
    encrypted: isEncrypted,
  };
  const kind = previewKind(activeItem);
  const src = isEncrypted ? decUrl?.url : (decUrl?.url || previewSrc(item));

  const handleDownloadClick = async () => {
    if (isEncrypted) {
      if (decUrl?.url) {
        const a = document.createElement('a');
        a.href = decUrl.url;
        a.download = activeItem.name || item.name || 'download';
        a.click();
      } else {
        const key = vault.getKey();
        if (!key) {
          alert('Vault is locked. Unlock vault to download this encrypted file.');
          return;
        }
        await downloadDecrypted(item, key);
      }
    } else {
      const a = document.createElement('a');
      a.href = item.downloadUrl || `/api/files/${item.id}/download`;
      a.download = item.name || 'download';
      a.click();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 sm:items-center" onClick={onClose}>
      <div
        className="relative w-full max-w-4xl mx-2 sm:mx-4 flex flex-col"
        style={{ maxHeight: '95dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-11 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white z-10"
          aria-label="Close preview"
        >✕</button>

        <div className="rounded-2xl overflow-hidden bg-slate-900 shadow-2xl">
          {isEncrypted && decrypting && !decUrl ? (
            <div className="flex flex-col items-center justify-center py-24 text-white">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-sky-400 mb-4" />
              <p className="text-base font-semibold">Decrypting file…</p>
              <p className="text-xs text-slate-400 mt-1">Decrypting with your vault key</p>
            </div>
          ) : isEncrypted && decryptError && !decUrl ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center text-white">
              <div className="text-5xl mb-3">🔒</div>
              <p className="text-lg font-semibold">{activeItem.name}</p>
              <p className="mt-2 text-sm text-red-400 max-w-md">{decryptError}</p>
              <p className="mt-3 text-xs text-slate-400">Unlock your vault or check your passphrase to preview.</p>
            </div>
          ) : (
            <>
              {kind === 'video' && src && (
                <video key={src} controls preload="metadata" playsInline
                  className="w-full object-contain bg-black" style={{ maxHeight: '70dvh' }}>
                  <source src={src} type={resolveMime(activeItem.name, activeItem.mime)} />
                </video>
              )}
              {kind === 'audio' && src && (
                <div className="flex flex-col items-center justify-center px-8 py-12">
                  <div className="mb-4 text-6xl">🎵</div>
                  <p className="mb-5 px-4 text-center text-base font-medium text-white">{activeItem.name}</p>
                  <audio key={src} controls preload="metadata" className="w-full max-w-md">
                    <source src={src} type={resolveMime(activeItem.name, activeItem.mime)} />
                  </audio>
                </div>
              )}
              {kind === 'image' && (
                <ImagePreview item={activeItem} fullSrc={src} />
              )}
              {kind === 'pdf' && src && <PdfViewer src={src} />}
              {kind === 'text' && src && <TextViewer src={src} name={activeItem.name} />}
              {kind === 'other' && (
                <div className="flex flex-col items-center justify-center py-16 text-white">
                  <div className="mb-4 text-7xl">{fileIcon(activeItem)}</div>
                  <p className="text-lg font-medium">{activeItem.name}</p>
                  {activeItem.mime && <p className="mt-1 text-sm text-white/50">{activeItem.mime}</p>}
                  {activeItem.size && <p className="mt-1 text-xs text-white/40">{formatBytes(activeItem.size)}</p>}
                  <p className="mt-4 text-sm text-white/40">No preview available — download to open</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 pb-safe">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white flex items-center gap-1.5">
              <span>{activeItem.name}</span>
              {isEncrypted && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">🔒 E2EE</span>}
            </p>
            {activeItem.size && <p className="text-xs text-white/60">{formatBytes(activeItem.size)}</p>}
            {(kind === 'video' || kind === 'audio') && (
              <p className="mt-0.5 text-xs text-white/50">🔊 Use the player's volume slider</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleDownloadClick}
            className="min-h-11 flex-shrink-0 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/20 transition cursor-pointer"
          >
            ⬇ Download
          </button>
        </div>
      </div>
    </div>
  );
}
