import { useCallback, useRef } from 'react';
import { api, uploadFile, clearToken } from '../api.js';

// This file uses JSX patterns - named .jsx for PWA import analysis
export function useDashboardHandlers({
  categories, categoryId, folderId, navigate, setUser, setCategories, setCurrentCategory, setCurrentFolder, setFolders, setFiles, setSavedMedia, setLoading, setToast, setUploads, setShowSavedPicker
}) {
  // Stable ref so useCallback deps don't trigger re-creation on every render
  const setToastRef = useRef(setToast);
  setToastRef.current = setToast;
  const showToast = useCallback((msg, isError = false) => {
    setToastRef.current({ msg, isError });
    setTimeout(() => setToastRef.current(null), 3500);
  }, []);

  // ── Data loading ───────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    try {
      const { categories: cats } = await api.listCategories();
      setCategories(cats || []);
    } catch (e) {
      showToast(e.message, true);
    }
  }, []);

  const loadSavedMessages = useCallback(async (filter = 'all') => {
    try {
      setLoading(true);
      const { media } = await api.savedMessages(filter);
      setSavedMedia(media || []);
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategoryContents = useCallback(async (silent = false) => {
    if (!categoryId) return;
    try {
      if (!silent) setLoading(true);
      const cats = await api.listCategories();
      setCategories(cats?.categories || []);
      setCurrentCategory(cats?.categories?.find(c => String(c.id) === String(categoryId)) || null);
      const { folders, currentFolder } = await api.listFolders(categoryId, folderId || null);
      setFolders(folders || []);
      setCurrentFolder(currentFolder || null);
      const { files } = await api.listFiles(categoryId, folderId || null);
      setFiles(files || []);
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setLoading(false);
    }
  }, [categoryId, folderId]);

  // ── Auth ────────────────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* best-effort */
    }
    clearToken();
    setUser(null);
    navigate('/login');
  }, [navigate, setUser]);

  // ── Category CRUD ──────────────────────────────────────────────────────
  const handleCreateCategory = useCallback(async (name) => {
    try {
      const { category } = await api.createCategory(name);
      setCategories(prev => [...prev, category]);
      showToast(`Category "${category.name}" created`);
      navigate(`/app/category/${category.id}`);
    } catch (e) {
      showToast(e.message, true);
    }
  }, [navigate]);

  const handleDeleteCategory = useCallback(async (catId, catName) => {
    if (!catId) return;
    if (!confirm(`Delete category "${catName || catId}" and all its files?\nThis cannot be undone.`)) return;
    try {
      await api.deleteCategory(catId);
      setCategories(prev => prev.filter(c => c.id !== catId));
      showToast(`Category "${catName || catId}" deleted`);
      if (String(categoryId) === String(catId)) navigate('/app');
    } catch (e) {
      showToast(e.message, true);
    }
  }, [categoryId, navigate]);

  // ── Folder CRUD ────────────────────────────────────────────────────────
  const handleCreateFolder = useCallback(async (name, targetCatId) => {
    try {
      const { folder } = await api.createFolder(name, targetCatId, folderId || null);
      setFolders(prev => [...prev, folder]);
      return { ok: true, folder };
    } catch (e) {
      showToast(e.message, true);
      return { ok: false, error: e.message };
    }
  }, [folderId]);

  const handleDeleteFolder = useCallback(async (fId, folderName) => {
    if (!fId) return;
    if (!confirm(`Delete folder "${folderName || fId}" and all files inside?\nThis cannot be undone.`)) return;
    try {
      await api.deleteFolder(fId);
      setFolders(prev => prev.filter(f => f.id !== fId));
      showToast(`Folder "${folderName || fId}" deleted`);
      if (String(folderId) === String(fId)) navigate(`/app/category/${categoryId}`);
    } catch (e) {
      showToast(e.message, true);
    }
  }, [categoryId, folderId, navigate]);

  // ── File uploads (from computer) ──────────────────────────────────────
  const handleUploadFromComputer = useCallback(async (fileList) => {
    let targetCatId = categoryId;
    if (!targetCatId && categories?.length > 0) {
      targetCatId = categories[0].id;
    }
    if (!targetCatId) {
      showToast('Please create or select a category first', true);
      return;
    }
    const filesArray = Array.from(fileList);
    if (!filesArray.length) return;

    // Navigate to category if on saved messages
    if (!categoryId) {
      navigate(`/app/category/${targetCatId}`);
    }

    // 1. Immediately create optimistic placeholder items for ALL files
    const optimisticItems = filesArray.map((file, idx) => {
      const tempId = `temp-${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`;
      let localUrl = null;
      if (
        file.type?.startsWith('image/') ||
        file.type?.startsWith('video/') ||
        /\.(jpe?g|png|webp|gif|svg|bmp|mp4|mov|webm)$/i.test(file.name)
      ) {
        try {
          localUrl = URL.createObjectURL(file);
        } catch {}
      }

      return {
        id: tempId,
        _tempId: tempId,
        _uploading: true,
        _progress: 0,
        _localUrl: localUrl,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        type: 'file',
        category_id: targetCatId,
        folder_id: folderId || null,
        created_at: new Date().toISOString(),
        _fileObj: file,
      };
    });

    // Instantly show all files in the folder grid
    setFiles((prev) => [...optimisticItems, ...prev]);
    // Also track in bottom upload progress indicator
    setUploads((prev) => [
      ...prev,
      ...optimisticItems.map((item) => ({ id: item._tempId, name: item.name, progress: 0 })),
    ]);

    // 2. Upload in background with a concurrency pool of 2 simultaneous uploads
    // As EACH file finishes uploading:
    // - Replace its placeholder with the real uploaded file in the folder immediately
    // - The finished file becomes active in the folder
    // - The other files continue uploading in the background and remain visible in the folder
    const CONCURRENCY = 2;
    const pool = [];
    for (const item of optimisticItems) {
      const uploadPromise = (async () => {
        try {
          const res = await uploadFile(
            item._fileObj,
            folderId || null,
            (pct) => {
              // Update live progress in both folder grid tile and bottom progress toast
              setFiles((prev) =>
                prev.map((f) => (f.id === item._tempId ? { ...f, _progress: pct } : f))
              );
              setUploads((prev) =>
                prev.map((u) => (u.id === item._tempId ? { ...u, progress: pct } : u))
              );
            },
            null,
            targetCatId
          );

          const realFile = res?.file || res;

          // As soon as this file finishes: show it in the folder as completed immediately!
          setFiles((prev) =>
            prev.map((f) => {
              if (f.id === item._tempId || f._tempId === item._tempId) {
                return {
                  ...realFile,
                  type: 'file',
                  // Retain local preview URL for instant crisp display without thumbnail lag
                  _localUrl: f._localUrl,
                  thumbnail: realFile?.thumbnail || `/api/files/${realFile?.id}/thumb`,
                  _uploading: false,
                };
              }
              return f;
            })
          );
          setUploads((prev) => prev.filter((u) => u.id !== item._tempId));
          showToast(`"${item.name}" uploaded`);
        } catch (e) {
          // On failure: remove failed placeholder and show error toast
          setFiles((prev) => prev.filter((f) => f.id !== item._tempId));
          setUploads((prev) => prev.filter((u) => u.id !== item._tempId));
          showToast(`Upload failed for "${item.name}": ${e.message}`, true);
        }
      })();

      pool.push(uploadPromise);
      if (pool.length >= CONCURRENCY) {
        await Promise.race(pool);
        // Remove completed promises from the active pool
        for (let i = pool.length - 1; i >= 0; i--) {
          const isSettled = await Promise.race([
            pool[i].then(() => true).catch(() => true),
            Promise.resolve(false),
          ]);
          if (isSettled) pool.splice(i, 1);
        }
      }
    }

    // Wait for remaining uploads in pool
    await Promise.allSettled(pool);

    // Final background refresh to ensure all DB timestamps and counts are 100% in sync
    try {
      const { files: freshFiles } = await api.listFiles(targetCatId, folderId || null);
      if (freshFiles) {
        setFiles((prev) => {
          const localMap = new Map();
          for (const f of prev) {
            if (f._localUrl) localMap.set(f.name, f._localUrl);
          }
          return freshFiles.map((ff) => ({
            ...ff,
            _localUrl: localMap.get(ff.name) || ff._localUrl,
          }));
        });
      }
    } catch {
      /* best-effort refresh */
    }
  }, [categoryId, folderId, categories, navigate, showToast, setFiles, setUploads]);

  // ── File upload from Saved Messages ────────────────────────────────────
  const handleUploadFromSaved = useCallback(async (selectedMedia) => {
    let targetCatId = categoryId;
    if (!targetCatId && categories?.length > 0) {
      targetCatId = categories[0].id;
    }
    if (!targetCatId) {
      showToast('Please create or select a category first', true);
      return;
    }
    const mediaList = Array.isArray(selectedMedia) ? selectedMedia : Array.from(selectedMedia || []);
    if (!mediaList.length) return;
    setShowSavedPicker(false);

    if (!categoryId) {
      navigate(`/app/category/${targetCatId}`);
    }

    // Show optimistic items in folder
    const optimisticItems = mediaList.map((m, idx) => {
      const tempId = `saved-temp-${Date.now()}-${idx}-${m.id}`;
      return {
        id: tempId,
        _tempId: tempId,
        _uploading: true,
        _progress: 0,
        thumbnail: m.thumbnail,
        name: m.name || 'Saved Media',
        mime: m.mime || 'image/jpeg',
        size: m.size || 0,
        type: 'file',
        category_id: targetCatId,
        folder_id: folderId || null,
        created_at: new Date().toISOString(),
        _orig: m,
      };
    });

    setFiles((prev) => [...optimisticItems, ...prev]);
    setUploads((prev) => [
      ...prev,
      ...optimisticItems.map((item) => ({ id: item._tempId, name: item.name, progress: 0 })),
    ]);

    for (const item of optimisticItems) {
      const m = item._orig;
      try {
        setFiles((prev) =>
          prev.map((f) => (f.id === item._tempId ? { ...f, _progress: 30 } : f))
        );
        setUploads((prev) =>
          prev.map((u) => (u.id === item._tempId ? { ...u, progress: 30 } : u))
        );

        const res = await api.uploadFromSaved(
          m.id,
          targetCatId,
          folderId || null,
          m.name || 'Saved Media',
          m.mime,
          m.size
        );

        setFiles((prev) =>
          prev.map((f) => (f.id === item._tempId ? { ...f, _progress: 90 } : f))
        );
        setUploads((prev) =>
          prev.map((u) => (u.id === item._tempId ? { ...u, progress: 90 } : u))
        );

        const realFile = res?.file || res;
        // As each file finishes, show it as completed immediately in the folder
        setFiles((prev) =>
          prev.map((f) => {
            if (f.id === item._tempId || f._tempId === item._tempId) {
              return {
                ...realFile,
                type: 'file',
                thumbnail: realFile?.thumbnail || m.thumbnail,
                _uploading: false,
              };
            }
            return f;
          })
        );
        setUploads((prev) => prev.filter((u) => u.id !== item._tempId));
        showToast(`"${m.name || 'Saved Media'}" copied`);
      } catch (e) {
        setFiles((prev) => prev.filter((f) => f.id !== item._tempId));
        setUploads((prev) => prev.filter((u) => u.id !== item._tempId));
        showToast(`Copy failed: ${e.message}`, true);
      }
    }

    try {
      const { files: freshFiles } = await api.listFiles(targetCatId, folderId || null);
      if (freshFiles) {
        setFiles((prev) => {
          const localMap = new Map();
          for (const f of prev) {
            if (f._localUrl) localMap.set(f.name, f._localUrl);
            if (f.thumbnail && !f._uploading) localMap.set(f.name + ':thumb', f.thumbnail);
          }
          return freshFiles.map((ff) => ({
            ...ff,
            _localUrl: localMap.get(ff.name) || ff._localUrl,
            thumbnail: ff.thumbnail || localMap.get(ff.name + ':thumb') || ff.thumbnail,
          }));
        });
      }
    } catch {
      /* best-effort refresh */
    }
  }, [categoryId, folderId, categories, navigate, showToast, setFiles, setShowSavedPicker, setUploads]);

  // ── File delete ────────────────────────────────────────────────────────
  const handleDeleteFile = useCallback(async (fileId) => {
    if (!confirm('Permanently delete this file? (it will be purged from Telegram too)')) return;
    try {
      await api.deleteFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      showToast('File deleted');
    } catch (e) {
      showToast(e.message, true);
    }
  }, []);

  return {
    loadCategories,
    loadSavedMessages,
    loadCategoryContents,
    handleLogout,
    handleCreateCategory,
    handleDeleteCategory,
    handleCreateFolder,
    handleDeleteFolder,
    handleUploadFromComputer,
    handleUploadFromSaved,
    handleDeleteFile,
  };
}