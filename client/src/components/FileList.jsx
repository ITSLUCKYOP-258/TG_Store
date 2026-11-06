import { useState } from 'react';
import { fileIcon, formatBytes } from '../lib/format.js';
import { ContextMenu } from './ItemList.jsx';
import SecureThumb from './SecureThumb.jsx';
import { isArmored } from '../lib/vault.js';

/** File type icon tile. */
function Thumb({ item }) {
  const ic = fileIcon(item);
  const isEncrypted = Boolean(item.encrypted || isArmored(item.name));
  const isImage = (item.mime || '').startsWith('image/');
  const thumbUrl = item.thumbnail || (item.id != null ? `/api/files/${item.id}/thumb` : null);

  if (item._localUrl) {
    return (
      <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl ${ic.color}`}>
        <img src={item._localUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  if (isEncrypted && isImage && item.id) {
    return (
      <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl ${ic.color}`}>
        <SecureThumb item={item} fallback={<span className="text-lg">{ic.icon}</span>} />
      </div>
    );
  }

  if (isImage && thumbUrl) {
    return (
      <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl ${ic.color}`}>
        <img
          src={thumbUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            if (item.id && !e.currentTarget.dataset.fallback) {
              e.currentTarget.dataset.fallback = 'true';
              e.currentTarget.src = `/api/files/${item.id}/raw`;
            } else {
              e.currentTarget.style.display = 'none';
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-lg ${ic.color}`}>
      {ic.icon}
    </div>
  );
}

/**
 * Date-grouped list of file cards (Telegram-X content style): each date gets a
 * small header, and each file is a card with an icon tile, name, size and a ⋮
 * menu (Preview / Download / Delete). System-theme aware.
 */
export default function FileList({ files, onPreview, onDownload, onDelete }) {
  const [menu, setMenu] = useState(null); // { x, y, file }

  if (!files || files.length === 0) return null;

  // Group by calendar day, newest day first.
  const groups = new Map();
  for (const f of files) {
    const d = f.createdAt ? new Date(f.createdAt) : null;
    const key = d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }) : 'Unknown';
    const sort = d ? d.getTime() : 0;
    if (!groups.has(key)) groups.set(key, { sort, items: [] });
    groups.get(key).items.push(f);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].sort - a[1].sort);

  return (
    <div className="space-y-6">
      {ordered.map(([label, group]) => (
        <div key={label}>
          <div className="mb-2 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
          <div className="space-y-2">
            {group.items.map((f) => (
              <div
                key={f.id}
                onClick={() => onPreview?.(f)}
                onDoubleClick={() => onPreview?.(f)}
                className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-transparent bg-white p-2.5 transition hover:border-slate-200 hover:shadow-sm dark:border-white/5 dark:bg-[#17212b] dark:hover:border-white/10 dark:hover:bg-[#1d2b3a]"
              >
                <Thumb item={f} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{f.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {formatBytes(f.size)}{f.encrypted ? ' · 🔒 encrypted' : ''}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.left, y: r.bottom + 4, file: f });
                  }}
                  title="More actions"
                  className="rounded-md p-1.5 text-slate-400 opacity-0 transition hover:bg-slate-100 group-hover:opacity-100 dark:hover:bg-white/5"
                >
                  ⋯
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          actions={[
            { label: 'Preview', icon: '👁', onClick: () => onPreview?.(menu.file) },
            { label: 'Download', icon: '⬇', onClick: () => onDownload?.(menu.file) },
            { label: 'Delete', icon: '🗑', danger: true, onClick: () => onDelete?.(menu.file) },
          ]}
        />
      )}
    </div>
  );
}
