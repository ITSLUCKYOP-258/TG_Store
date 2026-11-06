import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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

export default function Categories() {
  const { user } = useAuth();
  const vault = useVault();
  const navigate = useNavigate();
  const location = useLocation();

  const path = location.pathname;
  const segments = path.replace('/app/categories', '').split('/').filter(Boolean);
  const categoryId = segments[0] ? Number(segments[0]) : null;
  const folderId = segments[2] ? Number(segments[2]) : null;

  const [categories, setCategories] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [data, setData] = useState({ folders: [], files: [], breadcrumbs: [] });
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState(() => localStorage.getItem('tgstore-layout') || 'list');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [uploads, setUploads] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  const showToast = (msg, isError) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  const loadCategories = useCallback(() => {
    api.get('/api/categories').then((d) => setCategories(d.categories)).catch((e) => showToast(e.message, true));
  }, []);

  const loadCategoryContents = useCallback((silent = false) => {
    if (categoryId == null) {
      setData({ folders: [], files: [], breadcrumbs: [] });
      setCurrentCategory(null);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    api
      .get(`/api/drive?categoryId=${categoryId}${folderId != null ? `&folder=${folderId}` : ''}`)
      .then(async (d) => {
        const decryptedFiles = await withDecryptedMeta(d.files || [], vault.getKey());
        setData({ folders: d.folders || [], files: decryptedFiles, breadcrumbs: d.breadcrumbs || [] });
      })
      .catch((e) => showToast(e.message, true))
      .finally(() => { if (!silent) setLoading(false); });
  }, [categoryId, folderId, vault.status]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadCategoryContents(); }, [loadCategoryContents]);
  useEffect(() => localStorage.setItem('tgstore-layout', layout), [layout]);

  /* ---------------- actions ---------------- */
  const startUpload = async (fileList) => {
    if (categoryId == null) {
      showToast('Please select a category first', true);
      return;
    }
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
            categoryId,
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

          showToast(`Uploaded ${item.name}`);
        } catch (e) {
          setUploads((u) => u.map((x) => (x.id === item.id ? { ...x, error: e.message } : x)));
        }
      }
    };
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, items.length); i++) workers.push(worker());
    await Promise.all(workers);
    loadCategoryContents(true);
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      const d = await api.post('/api/categories', { name });
      setNewCategoryName('');
      setShowNewCategory(false);
      showToast(`Category "${name}" created`);
      loadCategories();
      navigate(`/app/categories/${d.category.id}`);
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const createFolder = async (name) => {
    try {
      await api.post('/api/folders', { name, categoryId, parentId: folderId });
      showToast(`Folder "${name}" created`);
      loadCategoryContents();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const renameItem = async (item, newName, isFolder) => {
    try {
      await api.patch(isFolder ? `/api/folders/${item.id}` : `/api/files/${item.id}`, { name: newName });
      showToast('Renamed');
      loadCategoryContents();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const moveItem = async (item, targetId, isFolder) => {
    try {
      const body = isFolder ? { parentId: targetId } : { folderId: targetId };
      await api.patch(isFolder ? `/api/folders/${item.id}` : `/api/files/${item.id}`, body);
      showToast('Moved');
      loadCategoryContents();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const deleteItem = async (item, isFolder) => {
    try {
      await api.del(isFolder ? `/api/folders/${item.id}` : `/api/files/${item.id}`);
      showToast(isFolder ? 'Folder deleted' : 'File deleted permanently');
      loadCategoryContents();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const starToggle = async (item) => {
    try {
      await api.patch(`/api/files/${item.id}`, { starred: !item.starred });
      loadCategoryContents();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const trashFile = async (item) => {
    try {
      await api.patch(`/api/files/${item.id}`, { trashed: 1 });
      showToast('Moved to trash');
      loadCategoryContents();
    } catch (e) {
      showToast(e.message, true);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) startUpload(e.dataTransfer.files);
  };

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const openCategory = (cat) => { navigate(`/app/categories/${cat.id}`); };
  const onOpenFolder = (f) => { navigate(`/app/categories/${categoryId}/folder/${f.id}`); };
  const goBack = () => {
    if (folderId != null) navigate(`/app/categories/${categoryId}`);
    else navigate('/app/categories');
  };

  /* ---------------- category list view ---------------- */
  if (categoryId == null) {
    return (
      <div className="flex h-full bg-slate-100">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} stats={{ used: 0, files: 0 }} />
        <main className="flex flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
            <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 hover:bg-slate-100 lg:hidden">☰</button>
            <h1 className="text-lg font-bold text-slate-800">Categories</h1>
            <button
              onClick={() => setShowNewCategory(true)}
              className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              + New Category
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 lg:p-6">
            {categories.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <div className="text-5xl">📂</div>
                <p className="font-medium text-slate-600">No categories yet</p>
                <p className="text-sm text-slate-400">Create a category to organize your files</p>
                <button onClick={() => setShowNewCategory(true)} className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                  + Create your first category
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {categories.map((cat) => (
                  <button key={cat.id} onClick={() => openCategory(cat)} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-2xl">📂</div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{cat.name}</p>
                      <p className="text-xs text-slate-400">Category</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {showNewCategory && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                <h2 className="text-lg font-bold text-slate-800">Create New Category</h2>
                <p className="mt-1 text-sm text-slate-500">A new private Telegram channel will be created for this category.</p>
                <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createCategory()} placeholder="Category name (e.g., Work, Personal)" className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" autoFocus />
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => { setShowNewCategory(false); setNewCategoryName(''); }} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button onClick={createCategory} disabled={!newCategoryName.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Create</button>
                </div>
              </div>
            </div>
          )}
          {toast && (
            <div className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-xl ${toast.isError ? 'bg-red-600' : 'bg-slate-900'}`}>
              {toast.msg}
            </div>
          )}
        </main>
      </div>
    );
  }

  /* ---------------- category contents view ---------------- */
  const menuActions = (item, isFolder) => {
    if (isFolder) {
      return [
        { label: 'Open', icon: '📂', onClick: () => onOpenFolder(item) },
        { label: 'Rename', icon: '✏️', onClick: () => setModal({ type: 'rename', item, isFolder: true }) },
        { label: 'Move', icon: '📦', onClick: () => setModal({ type: 'move', item, isFolder: true }) },
        { label: 'Delete', icon: '🗑️', danger: true, onClick: () => deleteItem(item, true) },
      ];
    }
    return [
      { label: 'Preview', icon: '👁️', onClick: () => setModal({ type: 'preview', file: item }) },
      { label: 'Download', icon: '⬇️', onClick: () => window.open(`/api/files/${item.id}/download`, '_blank') },
      { label: 'Rename', icon: '✏️', onClick: () => setModal({ type: 'rename', item, isFolder: false }) },
      { label: 'Move', icon: '📦', onClick: () => setModal({ type: 'move', item, isFolder: false }) },
      { label: 'Share', icon: '🔗', onClick: () => setModal({ type: 'share', file: item }) },
      { label: 'Trash', icon: '🗑️', danger: true, onClick: () => trashFile(item) },
    ];
  };

  return (
    <div className="flex h-full bg-slate-100">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} stats={{ used: 0, files: 0 }} />
      <main className="flex flex-1 flex-col" onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}>
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 hover:bg-slate-100 lg:hidden">☰</button>
          <button onClick={goBack} className="rounded-lg p-2 hover:bg-slate-100" title="Back">←</button>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <button onClick={() => navigate('/app/categories')} className="hover:text-indigo-600">Categories</button>
            <span>/</span>
            <span className="font-medium text-slate-800">{currentCategory?.name}</span>
          </div>
          <button onClick={() => setModal({ type: 'newFolder' })} className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ New Folder</button>
          <button onClick={() => fileInput.current?.click()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Upload</button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => e.target.files?.length && startUpload(e.target.files)} />
        </div>

        <div className="flex-1 overflow-auto p-4 lg:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            </div>
          ) : (
            <ItemList folders={data.folders} files={data.files} view="drive" layout={layout} onOpenFolder={onOpenFolder} onPreviewFile={(f) => setModal({ type: 'preview', file: f })} onItemMenu={(item, isFolder, x, y) => setMenu({ item, isFolder, x, y })} onStarToggle={starToggle} />
          )}
        </div>

        {dragOver && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-indigo-500/10">
            <div className="rounded-2xl bg-white px-8 py-6 text-lg font-semibold text-indigo-700 shadow-2xl">⬆ Drop files to upload</div>
          </div>
        )}

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
                  <div className={`h-full rounded-full transition-all ${u.error ? 'bg-red-500' : 'bg-indigo-600'}`} style={{ width: `${u.error ? 100 : u.progress}%` }} />
                </div>
                {u.error && <p className="mt-1 text-[11px] text-red-500">{u.error}</p>}
              </div>
            ))}
          </div>
        )}

        {toast && (
          <div className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-xl ${toast.isError ? 'bg-red-600' : 'bg-slate-900'}`}>
            {toast.msg}
          </div>
        )}

        {menu && <ContextMenu x={menu.x} y={menu.y} actions={menuActions(menu.item, menu.isFolder)} onClose={() => setMenu(null)} />}
        {modal?.type === 'newFolder' && <NewFolderModal parentId={folderId} categoryId={categoryId} onClose={() => setModal(null)} onCreated={() => { showToast('Folder created'); loadCategoryContents(); }} />}
        {modal?.type === 'rename' && <RenameModal item={modal.item} isFolder={modal.isFolder} onClose={() => setModal(null)} onRenamed={() => { showToast('Renamed'); loadCategoryContents(); }} />}
        {modal?.type === 'move' && <MoveModal item={modal.item} isFolder={modal.isFolder} onClose={() => setModal(null)} onMoved={() => { showToast('Moved'); loadCategoryContents(); }} />}
        {modal?.type === 'share' && <ShareModal file={modal.file} onClose={() => setModal(null)} />}
        {modal?.type === 'preview' && <PreviewModal file={modal.file} onClose={() => setModal(null)} />}
      </main>
    </div>
  );
}