import { fileIcon, formatBytes, formatDate } from '../lib/format.js';
import SecureThumb from './SecureThumb.jsx';
import { isArmored } from '../lib/vault.js';

/** Context menu shown on right-click / ⋯ button. */
export function ContextMenu({ x, y, actions, onClose }) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 min-w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-white/10 dark:bg-[#17212b]"
        style={{
          left: Math.min(x, window.innerWidth - 200),
          top: Math.min(y, window.innerHeight - 40 - actions.length * 36),
        }}
      >
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => {
              onClose();
              a.onClick();
            }}
            className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-white/5 ${
              a.danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
            }`}
          >
            <span className="w-4 text-center text-xs">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </>
  );
}

function Thumb({ item }) {
  if (item.type === 'folder') {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-xl">
        📁
      </div>
    );
  }
  const ic = fileIcon(item);
  const isEncrypted = Boolean(item.encrypted || isArmored(item.name));
  const isImage = (item.mime || '').startsWith('image/');
  const thumbUrl = item.thumbnail || (item.id != null ? `/api/files/${item.id}/thumb` : null);

  if (item._localUrl) {
    return (
      <div className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl ${ic.color}`}>
        <img src={item._localUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  if (isEncrypted && isImage && item.id) {
    return (
      <div className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl ${ic.color}`}>
        <SecureThumb item={item} fallback={<span className="text-lg">{ic.icon}</span>} />
      </div>
    );
  }

  return (
    <div
      className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl ${ic.color}`}
    >
      {isImage && thumbUrl ? (
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
      ) : (
        <span className="text-lg">{ic.icon}</span>
      )}
    </div>
  );
}

export default function ItemList({
  folders,
  files,
  view,
  layout,
  onOpenFolder,
  onPreviewFile,
  onItemMenu,
  onStarToggle,
}) {
  const empty = folders.length === 0 && files.length === 0;
  if (empty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="text-5xl">{view === 'trash' ? '🗑️' : view === 'starred' ? '⭐' : '📭'}</div>
        <p className="font-medium text-slate-600">
          {view === 'trash'
            ? 'Trash is empty'
            : view === 'starred'
              ? 'Nothing starred yet'
              : 'This folder is empty'}
        </p>
        <p className="text-sm text-slate-400">
          {view === 'drive' ? 'Drag & drop files here or use the Upload button' : ''}
        </p>
      </div>
    );
  }

  const menuBtn = (item, isFolder) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onItemMenu(item, isFolder, r.right, r.bottom + 4);
      }}
      className="rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100"
      title="More actions"
    >
      ⋯
    </button>
  );

  const starBtn = (item) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onStarToggle(item);
      }}
      className={`rounded-md p-1 text-sm transition hover:bg-slate-200 ${
        item.starred ? 'text-amber-400 opacity-100' : 'text-slate-400 opacity-0 group-hover:opacity-100'
      }`}
      title={item.starred ? 'Unstar' : 'Star'}
    >
      {item.starred ? '★' : '☆'}
    </button>
  );

  const rowProps = (item, isFolder) => ({
    onDoubleClick: () => (isFolder ? onOpenFolder(item) : onPreviewFile(item)),
    onContextMenu: (e) => {
      e.preventDefault();
      onItemMenu(item, isFolder, e.clientX, e.clientY);
    },
    className:
      'group relative cursor-pointer rounded-2xl border border-transparent bg-white transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md',
  });

  if (layout === 'grid') {
    return (
      <div className="grid flex-1 auto-rows-max grid-cols-2 gap-3 p-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {folders.map((f) => (
          <div key={`f${f.id}`} {...rowProps(f, true)} onDoubleClick={() => onOpenFolder(f)} className={rowProps(f, true).className + ' flex flex-col items-center gap-2 p-4 text-center'}>
            <div className="absolute right-2 top-2 flex gap-0.5">
              {starBtn(f)}
              {menuBtn(f, true)}
            </div>
            <Thumb item={f} />
            <p className="line-clamp-2 w-full break-all text-xs font-medium text-slate-700">{f.name}</p>
          </div>
        ))}
        {files.map((file) => (
          <div key={`file${file.id}`} {...rowProps(file, false)} onDoubleClick={() => onPreviewFile(file)} className={rowProps(file, false).className + ' flex flex-col items-center gap-2 p-4 text-center'}>
            <div className="absolute right-2 top-2 flex gap-0.5">
              {starBtn(file)}
              {menuBtn(file, false)}
            </div>
            <Thumb item={file} />
            <p className="line-clamp-2 w-full break-all text-xs font-medium text-slate-700">{file.name}</p>
            <p className="text-[11px] text-slate-400">{formatBytes(file.size)}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-2xl bg-white p-2 shadow-sm">
      <div className="grid grid-cols-[1fr_100px_120px_44px] items-center gap-3 border-b border-slate-100 px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span>Name</span>
        <span className="text-right">Size</span>
        <span className="text-right">Modified</span>
        <span />
      </div>
      {[...folders.map((f) => ({ item: f, isFolder: true })), ...files.map((f) => ({ item: f, isFolder: false }))].map(
        ({ item, isFolder }) => (
          <div
            key={`${isFolder ? 'f' : 'file'}${item.id}`}
            onDoubleClick={() => (isFolder ? onOpenFolder(item) : onPreviewFile(item))}
            onContextMenu={(e) => {
              e.preventDefault();
              onItemMenu(item, isFolder, e.clientX, e.clientY);
            }}
            className="group grid cursor-pointer grid-cols-[1fr_100px_120px_44px] items-center gap-3 rounded-xl px-4 py-2.5 transition hover:bg-slate-50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Thumb item={item} />
              <span className="truncate text-sm font-medium text-slate-700">{item.name}</span>
            </div>
            <span className="text-right text-xs text-slate-500">
              {isFolder ? '—' : formatBytes(item.size)}
            </span>
            <span className="text-right text-xs text-slate-400">{formatDate(item.createdAt)}</span>
            <div className="flex items-center justify-end gap-0.5">
              {starBtn(item)}
              {menuBtn(item, isFolder)}
            </div>
          </div>
        )
      )}
    </div>
  );
}

