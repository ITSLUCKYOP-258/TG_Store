import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, uploadFile } from '../api.js';
import { useVault } from '../hooks/useVault';
import { downloadDecrypted } from '../lib/vault.js';
import { useAuth } from '../App.jsx';
import Sidebar from '../components/Sidebar.jsx';
import MediaPreview from '../components/MediaPreview.jsx';
import SavedMessagesPicker from '../components/SavedMessagesPicker.jsx';
import NewCategoryModal from '../components/NewCategoryModal.jsx';
import NewFolderModal from '../components/NewFolderModal.jsx';
import UploadProgress from '../components/UploadProgress.jsx';
import Toast from '../components/Toast.jsx';
import SavedMessagesView from '../components/SavedMessagesView.jsx';
import CategoryView from '../components/CategoryView.jsx';
import FolderView from '../components/FolderView.jsx';
import { useDashboardHandlers } from '../hooks/useDashboardHandlers.jsx';

export default function Dashboard() {
  const { user, setUser } = useAuth();
  const vault = useVault();
  const navigate = useNavigate();
  const location = useLocation();
  // NOTE: Dashboard is mounted on the wildcard route "/app/*", so useParams()
  // returns NO named params. Derive categoryId/folderId from the pathname:
  //   /app                      → saved messages
  //   /app/category/:id         → category view
  //   /app/category/:id/folder/:fid → folder view
  const pathMatch = /^\/app\/category\/(\d+)(?:\/folder\/(\d+))?/.exec(location.pathname);
  const categoryId = pathMatch ? Number(pathMatch[1]) : null;
  const folderId = pathMatch?.[2] ? Number(pathMatch[2]) : null;
  const view = !categoryId ? 'saved' : !folderId ? 'category' : 'folder';

  const [categories, setCategories] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [savedMedia, setSavedMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [folderModal, setFolderModal] = useState({ open: false, submitting: false, error: null, success: null });
  const [showSavedPicker, setShowSavedPicker] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [previewItem, setPreviewItem] = useState(null);
  const [toast, setToast] = useState(null);
  const [savedFilter, setSavedFilter] = useState('all');
  // Mobile sidebar drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Close drawer whenever the user navigates to a different route
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  const handlers = useDashboardHandlers({
    categories, categoryId, folderId, navigate, setUser, setCategories, setCurrentCategory, setCurrentFolder, setFolders, setFiles, setSavedMedia, setLoading, setToast, setUploads, setShowSavedPicker
  });

  // Manual sync: re-fetch saved messages from Telegram
  const refreshSaved = useCallback(() => handlers.loadSavedMessages(savedFilter), [handlers.loadSavedMessages, savedFilter]);

  // Track previous view to auto-refetch saved messages when entering the Saved Messages view
  const prevViewRef = useRef(view);
  useEffect(() => {
    if (prevViewRef.current !== view && view === 'saved') {
      handlers.loadSavedMessages(savedFilter);
    }
    prevViewRef.current = view;
  }, [view, savedFilter, handlers.loadSavedMessages]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if ((view === 'category' || view === 'folder') && e.dataTransfer?.files?.length) {
      handlers.handleUploadFromComputer(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (view === 'category' || view === 'folder') setDragOver(true);
  };

  const handleDragLeave = (e) => {
    if (e.currentTarget === e.target) setDragOver(false);
  };

  // E2EE-aware download: encrypted files are fetched + decrypted in the
  // browser; legacy plaintext files keep the direct streaming link.
  const handleDownload = async (f) => {
    const key = vault.getKey();
    if (f?.encrypted) {
      if (!key) {
        setToast({ msg: 'Vault locked — unlock it to download this file', isError: true });
        setTimeout(() => setToast(null), 3500);
        return;
      }
      try {
        if (await downloadDecrypted(f, key)) return;
      } catch (err) {
        setToast({ msg: `Decryption failed: ${err.message}`, isError: true });
        setTimeout(() => setToast(null), 3500);
        return;
      }
    }
    window.open(`/api/files/${f.id}/download`, '_blank');
  };

  useEffect(() => { handlers.loadCategories(); }, [handlers.loadCategories]);
  useEffect(() => {
    if (categoryId) handlers.loadCategoryContents();
    else handlers.loadSavedMessages(savedFilter);
  }, [categoryId, folderId, handlers.loadCategoryContents, handlers.loadSavedMessages, savedFilter]);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    await handlers.handleCreateCategory(newCategoryName);
    setNewCategoryName('');
    setShowNewCategory(false);
  };

  const handleCreateFolder = async (chosenCat) => {
    if (!newFolderName.trim()) return;
    setFolderModal((m) => ({ ...m, submitting: true, error: null, success: null }));
    const targetCatId = chosenCat?.id ?? categoryId ?? categories[0]?.id;
    const result = await handlers.handleCreateFolder(newFolderName, targetCatId);
    if (result?.ok) {
      const f = result.folder;
      setFolderModal((m) => ({
        ...m,
        submitting: false,
        success: `Folder '${f.name}' created — marker ${f.channelMessageId ? `message #${f.channelMessageId} posted` : 'posted'} in your channel`,
      }));
      setNewFolderName('');
      setTimeout(() => setFolderModal((m) => ({ ...m, open: false })), 1600);
    } else {
      setFolderModal((m) => ({ ...m, submitting: false, error: result?.error || 'Could not create folder' }));
    }
  };

  const openNewFolder = () => setFolderModal({ open: true, submitting: false, error: null, success: null });

  return (
    <div className="flex h-dvh bg-slate-50 text-slate-900 antialiased dark:bg-[#0e1621] dark:text-slate-100">
      <Sidebar
        user={user}
        categories={categories}
        categoryId={categoryId}
        navigate={navigate}
        onNewCategory={() => setShowNewCategory(true)}
        onNewFolder={openNewFolder}
        onLogout={handlers.handleLogout}
        onDeleteCategory={handlers.handleDeleteCategory}
        mobileOpen={drawerOpen}
        onCloseMenu={() => setDrawerOpen(false)}
      />
      <main
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-indigo-900/60 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-white/80 bg-white/10 px-8 py-6 text-center text-white shadow-2xl">
              <div className="mb-2 text-4xl">📤</div>
              <p className="text-lg font-bold">Drop files here to upload</p>
              <p className="text-xs text-white/80">Multiple files will upload in parallel to Telegram</p>
            </div>
          </div>
        )}
        {view === 'saved' && (
          <SavedMessagesView
            loading={loading} savedMedia={savedMedia} savedFilter={savedFilter}
            setSavedFilter={setSavedFilter} onPreview={setPreviewItem}
            onOpenMenu={() => setDrawerOpen(true)}
            onRefresh={refreshSaved}
          />
        )}
        {view === 'category' && (
          <CategoryView
            loading={loading} category={currentCategory} folders={folders} files={files}
            navigate={navigate} onNewFolder={openNewFolder} categoryId={categoryId}
            onUploadFromComputer={handlers.handleUploadFromComputer}
            onUploadFromSaved={() => setShowSavedPicker(true)}
            onPreview={setPreviewItem}
            onDownload={handleDownload}
            onDelete={handlers.handleDeleteFile}
            onDeleteCategory={handlers.handleDeleteCategory}
            onOpenMenu={() => setDrawerOpen(true)}
          />
        )}
        {view === 'folder' && (
          <FolderView
            loading={loading} folderId={folderId} folder={currentFolder} folders={folders} files={files}
            onUploadFromComputer={handlers.handleUploadFromComputer}
            onUploadFromSaved={() => setShowSavedPicker(true)}
            onPreview={setPreviewItem}
            onDownload={handleDownload}
            onDelete={handlers.handleDeleteFile}
            onDeleteFolder={handlers.handleDeleteFolder}
            categoryId={categoryId} navigate={navigate}
            onOpenMenu={() => setDrawerOpen(true)}
          />
        )}
      </main>
      {showNewCategory && <NewCategoryModal name={newCategoryName} setName={setNewCategoryName} onCreate={() => handleCreateCategory()} onClose={() => setShowNewCategory(false)} />}
      {folderModal.open && (
        <NewFolderModal
          name={newFolderName}
          setName={setNewFolderName}
          onCreate={handleCreateFolder}
          onClose={() => setFolderModal({ open: false, submitting: false, error: null, success: null })}
          error={folderModal.error}
          submitting={folderModal.submitting}
          success={folderModal.success}
          categories={categories}
          categoryId={categoryId ?? categories[0]?.id}
        />
      )}
      {showSavedPicker && <SavedMessagesPicker onSelect={handlers.handleUploadFromSaved} onClose={() => setShowSavedPicker(false)} />}
      {previewItem && <MediaPreview item={previewItem} onClose={() => setPreviewItem(null)} />}
      <UploadProgress uploads={uploads} />
      <Toast toast={toast} />
    </div>
  );
}