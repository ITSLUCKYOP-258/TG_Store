import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, uploadFile } from '../api.js';
import { useAuth } from '../App.jsx';
import { useVault } from '../hooks/useVault';
import { withDecryptedMeta, encryptFile, encryptMetadata } from '../lib/vault.js';
import Sidebar from '../components/Sidebar.jsx';

import ItemList, { ContextMenu } from '../components/ItemList.jsx';
import {
  NewFolderModal,
  RenameModal,
  MoveModal,
  ShareModal,
  PreviewModal,
} from '../components/Modals.jsx';
import SharedLinks from '../components/SharedLinks.jsx';

export default function Drive() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // current view from URL: /app, /app/folder/:id, /app/starred, /app/trash, /app/search?q=, /app/shared
  const path = location.pathname;
  const view = path.startsWith('/app/starred')
    ? 'starred'
    : path.startsWith('/app/trash')
      ? 'trash'
      : path.startsWith('/app/search')
        ? 'search'
        : path.startsWith('/app/shared')
          ? 'shared'
          : 'drive';
  const folderId =
    view === 'drive' && path.startsWith('/app/folder/') ? Number(path.split('/')[3]) : null;
  const q = view === 'search' ? searchParams.get('q') || '' : '';

  const [data, setData] = useState({ folders: [], files: [], breadcrumbs: [] });
  const [stats, setStats] = useState({ used: 0, files: 0 });
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState(() => localStorage.getItem('tgstore-layout') || 'list');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // modals & menus
  const [menu, setMenu] = useState(null); // { item, isFolder, x, y }
  const [modal, setModal] = useState(null); // {type, ...}
  const [toast, setToast] = useState(null);

  // uploads
  const [uploads, setUploads] = useState([]); // {id, name, progress, error}
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const vault = useVault();

  const refreshStats = useCallback(() => {
    api.get('/api/storage').then(setStats).catch(() => {});
  }, []);

  const load = useCallback((silent = false) => {
    if (view === 'shared') return;
    if (!silent) setLoading(true);
    const url = `/api/drive?view=${view}${
      view === 'search' ? `&q=${encodeURIComponent(q)}` : ''
    }${view === 'drive' ? `&folder=${folderId ?? ''}` : ''}`;
    api
      .get(url)
      .then(async (res) => {
        const decryptedFiles = await withDecryptedMeta(res?.files || [], vault.getKey());
        setData({ ...(res || {}), files: decryptedFiles });
      })
      .catch((e) => setToast({ msg: e.message, isError: true }))
      .finally(() => { if (!silent) setLoading(false); });
    refreshStats();
  }, [view, folderId, q, refreshStats, vault.status]);

  useEffect(load, [load]);
  useEffect(() => localStorage.setItem('tgstore-layout', layout), [layout]);

  const showToast = (msg, isError) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  /* ---------------- actions ---------------- */
  const startUpload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const items = files.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      name: file.name,
      progress: 0,
    }));
    setUploads((prev) => [...prev, ...items.map(({ id, name, progress }) => ({ id, name, progress }))]);

    const CONCURRENCY = 3;
    let nextIdx = 0;
    const worker = async () => {
      while (nextIdx < items.length) {
        const item = items[nextIdx++];
        try {
          const key = vault.getKey();
          let uploadPayload = item.file;
          let metaArmor = null;

          if (key) {
            const { encrypted } = await encryptFile(item.file, key);
            metaArmor = await encryptMetadata(
              { name: item.file.name, mime: item.file.type || 'application/octet-stream', size: item.file.size },
              key
            );
            uploadPayload = encrypted;
          }

          const res = await uploadFile(
            uploadPayload,
            folderId,
            (p) => setUploads((u) => u.map((x) => (x.id === item.id ? { ...x, progress: p } : x))),
            undefined,
            undefined,
            metaArmor
          );
          setUploads((u) => u.filter((x) => x.id !== item.id));

          if (res?.file) {
            const [decrypted] = await withDecryptedMeta([res.file], key);
            try {
              decrypted._localUrl = URL.createObjectURL(item.file);
            } catch {}
            setData((prev) => ({
              ...prev,
              files: [decrypted, ...(prev?.files || []).filter((f) => f.id !== decrypted.id)],
            }));
          }

          showToast(`Uploaded "${item.name}"`);
        } catch (e) {
          setUploads((u) => u.map((x) => (x.id === item.id ? { ...x, error: e.message } : x)));
          showToast(`Upload failed: ${e.message}`, true);
        }
      }
    };
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, items.length); i++) workers.push(worker());
    await Promise.all(workers);
    load(true);
  };

  const starToggle = async (item) => {
    const isFolder = item.type === 'folder';
    const body = { starred: !item.starred };
    if (isFolder) await api.patch(`/api/folders/${item.id}`, body);
    else await api.patch(`/api/files/${item.id}`, body);
    load();
  };

  const trashItem = async (item, isFolder) => {
    if (isFolder) await api.patch(`/api/folders/${item.id}`, { trashed: true });
    else await api.patch(`/api/files/${item.id}`, { trashed: true });
    showToast(`Moved "${item.name}" to trash`);
    load();
  };

  const restoreItem = async (item, isFolder) => {
    if (isFolder) await api.patch(`/api/folders/${item.id}`, { trashed: false });
    else await api.patch(`/api/files/${item.id}`, { trashed: false });
    showToast(`Restored "${item.name}"`);
    load();
  };

  const deleteForever = async (item, isFolder) => {
    if (!window.confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) return;
    if (isFolder) await api.del(`/api/folders/${item.id}`);
    else await api.del(`/api/files/${item.id}`);
    showToast(`Deleted "${item.name}" forever`);
    load();
    refreshStats();
  };

  const emptyTrash = async () => {
    if (!window.confirm('Permanently delete everything in Trash?')) return;
    await api.post('/api/trash/empty');
    showToast('Trash emptied');
    load();
    refreshStats();
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    navigate('/login');
  };

  const menuActions = (item, isFolder) => {
    if (view === 'trash') {
      return [
        { label: 'Restore', icon: '♻️', onClick: () => restoreItem(item, isFolder) },
        { label: 'Delete forever', icon: '🗑', danger: true, onClick: () => deleteForever(item, isFolder) },
      ];
    }
    const actions = [];
    if (!isFolder) {
      actions.push(
        { label: 'Preview', icon: '👁', onClick: () => setModal({ type: 'preview', file: item }) },
        {
          label: 'Download',
          icon: '⬇',
          onClick: () => window.open(`/api/files/${item.id}/download`, '_blank'),
        },
        { label: 'Share link', icon: '🔗', onClick: () => setModal({ type: 'share', file: item }) }
      );
    }
    actions.push(
      { label: 'Rename', icon: '✏️', onClick: () => setModal({ type: 'rename', item, isFolder }) },
      { label: 'Move to…', icon: '📂', onClick: () => setModal({ type: 'move', item, isFolder }) },
      {
        label: item.starred ? 'Remove star' : 'Add star',
        icon: '⭐',
        onClick: () => starToggle(item),
      },
      { label: 'Move to trash', icon: '🗑', danger: true, onClick: () => trashItem(item, isFolder) }
    );
    return actions;
  };

  const crumbs = data.breadcrumbs || [];
  const title =
    view === 'starred'
      ? 'Starred'
      : view === 'trash'
        ? 'Trash'
        : view === 'shared'
          ? 'Shared links'
          : view === 'telegram'
            ? 'My Telegram'
            : view === 'search'
              ? `Search results for "${q}"`
              : crumbs[crumbs.length - 1]?.name || 'My Drive';

  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        e.preventDefault();
        if (view === 'drive') setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (view === 'drive' && e.dataTransfer.files.length) startUpload(e.dataTransfer.files);
      }}
    >
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} stats={stats} />

      <main className="flex min-w-0 flex-1 flex-col p-4 lg:pl-6">
        {/* topbar */}
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-xl bg-white p-2.5 shadow-sm lg:hidden"
          >
            ☰
          </button>
          <form
            className="flex flex-1 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              const term = new FormData(e.currentTarget).get('q');
              if (term) navigate(`/app/search?q=${encodeURIComponent(term)}`);
            }}
          >
            <div className="flex w-full items-center gap-2 rounded-xl bg-white px-4 py-2.5 shadow-sm">
              <span className="text-slate-400">🔍</span>
              <input
                name="q"
                defaultValue={q}
                key={q}
                placeholder="Search your drive…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          </form>
          <button
            onClick={logout}
            title="Log out"
            className="rounded-xl bg-white p-2.5 text-sm shadow-sm hover:bg-slate-50"
          >
            🚪
          </button>
        </div>

        {/* action row */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {view === 'drive' && (
            <>
              <button
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                ⬆ Upload
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files.length) startUpload(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => setModal({ type: 'newFolder' })}
                className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                📁 New folder
              </button>
            </>
          )}
          {view === 'trash' && (
            <button
              onClick={emptyTrash}
              className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
            >
              Empty trash
            </button>
          )}
          <h1 className="mr-auto text-xl font-bold text-slate-900">{title}</h1>
          <div className="flex overflow-hidden rounded-xl bg-white shadow-sm">
            {['list', 'grid'].map((l) => (
              <button
                key={l}
                onClick={() => setLayout(l)}
                className={`px-3 py-2.5 text-sm transition ${
                  layout === l ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                }`}
                title={`${l} view`}
              >
                {l === 'list' ? '☰' : '▦'}
              </button>
            ))}
          </div>
        </div>

        {/* breadcrumbs */}
        {view === 'drive' && (
          <div className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-500">
            {crumbs.map((c, i) => (
              <span key={c.id ?? 'root'} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-300">/</span>}
                <button
                  onClick={() => navigate(c.id ? `/app/folder/${c.id}` : '/app')}
                  className={`rounded px-1.5 py-0.5 hover:bg-white ${
                    i === crumbs.length - 1 ? 'font-semibold text-slate-800' : ''
                  }`}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* content */}
        {view === 'shared' ? (
          <SharedLinks onChanged={refreshStats} />
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          </div>
        ) : (
          <ItemList
            folders={data.folders}
            files={data.files}
            view={view}
            layout={layout}
            onOpenFolder={(f) => navigate(`/app/folder/${f.id}`)}
            onPreviewFile={(f) => setModal({ type: 'preview', file: f })}
            onItemMenu={(item, isFolder, x, y) => setMenu({ item, isFolder, x, y })}
            onStarToggle={starToggle}
          />
        )}

        {dragOver && (
          <div className="dropzone-active pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-indigo-500/10">
            <div className="rounded-2xl bg-white px-8 py-6 text-lg font-semibold text-indigo-700 shadow-2xl">
              ⬆ Drop files to upload
            </div>
          </div>
        )}

        {/* upload progress panel */}
        {uploads.length > 0 && (
          <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-2xl bg-white p-4 shadow-2xl">
            <p className="text-sm font-semibold text-slate-700">Uploading…</p>
            {uploads.map((u) => (
              <div key={u.id}>
                <div className="flex justify-between text-xs text-slate-500">
                  <span className="truncate">{u.name}</span>
                  <span>{u.error ? 'Failed' : `${u.progress}%`}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all ${u.error ? 'bg-red-500' : 'bg-indigo-600'}`}
                    style={{ width: `${u.error ? 100 : u.progress}%` }}
                  />
                </div>
                {u.error && <p className="mt-1 text-[11px] text-red-500">{u.error}</p>}
              </div>
            ))}
          </div>
        )}

        {/* toast */}
        {toast && (
          <div
            className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-xl ${
              toast.isError ? 'bg-red-600' : 'bg-slate-900'
            }`}
          >
            {toast.msg}
          </div>
        )}


        {/* context menu & modals */}
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            actions={menuActions(menu.item, menu.isFolder)}
            onClose={() => setMenu(null)}
          />
        )}
        {modal?.type === 'newFolder' && (
          <NewFolderModal
            parentId={folderId}
            onClose={() => setModal(null)}
            onCreated={() => {
              showToast('Folder created');
              load();
            }}
          />
        )}
        {modal?.type === 'rename' && (
          <RenameModal
            item={modal.item}
            isFolder={modal.isFolder}
            onClose={() => setModal(null)}
            onRenamed={() => {
              showToast('Renamed');
              load();
            }}
          />
        )}
        {modal?.type === 'move' && (
          <MoveModal
            item={modal.item}
            isFolder={modal.isFolder}
            onClose={() => setModal(null)}
            onMoved={() => {
              showToast('Moved');
              load();
            }}
          />
        )}
        {modal?.type === 'share' && <ShareModal file={modal.file} onClose={() => setModal(null)} />}
        {modal?.type === 'preview' && (
          <PreviewModal file={modal.file} onClose={() => setModal(null)} />
        )}
      </main>
    </div>
  );
}

