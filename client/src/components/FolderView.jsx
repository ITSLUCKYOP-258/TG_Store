import MediaGrid from './MediaGrid.jsx';

export default function FolderView({
  loading,
  folderId,
  folder,
  folders,
  files,
  categoryId,
  navigate,
  onUploadFromComputer,
  onUploadFromSaved,
  onPreview,
  onDownload,
  onDelete,
  onDeleteFolder,
  onOpenMenu,
}) {
  const name = folder?.name || folders.find((f) => f.id === folderId)?.name || 'Folder';

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/5 dark:bg-[#17212b] sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Title + back link */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenMenu}
              aria-label="Open menu"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 md:hidden"
            >
              ☰
            </button>
            <div>
              <button
                onClick={() => navigate(`/app/category/${categoryId}`)}
                className="text-xs font-semibold text-indigo-600 transition hover:text-indigo-800 dark:text-sky-400 dark:hover:text-sky-300"
              >
                ← Back to category
              </button>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">📂 {name}</h2>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{files.length} items</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onDeleteFolder(folderId, name)}
              title="Delete this folder and everything inside (files purged from Telegram too)"
              className="min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:shadow-none dark:hover:bg-red-500/10"
            >
              🗑 Delete Folder
            </button>
            <button
              onClick={onUploadFromSaved}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:shadow-none dark:hover:bg-white/5"
            >
              📨 From Saved
            </button>
            <label className="min-h-11 cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 dark:bg-[#3390ec] dark:shadow-none dark:hover:bg-[#4aa3f0]">
              📤 Upload
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    onUploadFromComputer(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 dark:border-white/10 dark:border-t-sky-400" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 text-6xl">📭</div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">Folder is empty</h3>
            <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              Upload media from your computer or Saved Messages
            </p>
          </div>
        ) : (
          <MediaGrid media={files} onPreview={onPreview} onDownload={onDownload} onDelete={onDelete} />
        )}
      </div>
    </div>
  );
}