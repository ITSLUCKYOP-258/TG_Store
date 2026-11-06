import MediaGrid from './MediaGrid.jsx';
import QuickAccess from './QuickAccess.jsx';

function fmtBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

export default function CategoryView({
  loading,
  category,
  folders,
  files,
  navigate,
  onNewFolder,
  categoryId,
  onUploadFromComputer,
  onUploadFromSaved,
  onPreview,
  onDownload,
  onDelete,
  onDeleteCategory,
  onOpenMenu,
}) {
  const channelReady = category?.channelActive;
  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3 dark:border-white/5 dark:bg-[#17212b] sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Title row */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenMenu}
              aria-label="Open menu"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 md:hidden"
            >
              ☰
            </button>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">📁 {category?.name || 'Category'}</h2>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Channel: {channelReady ? 'Active — folders become marker posts' : '⚠️ Not linked'}
              </p>
            </div>
          </div>
          {/* Action buttons — wrap on mobile */}
          <div className="flex flex-wrap items-center gap-2">
            {channelReady ? (
              <>
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
                <button
                  onClick={onNewFolder}
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:shadow-none dark:hover:bg-white/5"
                >
                  + New Folder
                </button>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-amber-50 px-2 py-1 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                  ⚠️ Channel not linked
                </span>
                <button
                  onClick={() => onDeleteCategory(category?.id, category?.name)}
                  className="min-h-11 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:shadow-none dark:hover:bg-red-500/10"
                  title="Delete this broken category so you can recreate it with your real Telegram session"
                >
                  Delete &amp; Recreate
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 dark:border-white/10 dark:border-t-sky-400" />
          </div>
        ) : (
          <div>
            {/* Telegram-X style QuickAccess folder navigation */}
            {folders.length > 0 ? (
              <QuickAccess
                title="Folders"
                items={folders.map((folder) => ({
                  id: folder.id,
                  name: folder.name,
                  subtitle: `${folder.itemCount || 0} ${folder.itemCount === 1 ? 'file' : 'files'}${
                    folder.totalSize > 0 ? ` · ${fmtBytes(folder.totalSize)}` : ''
                  }`,
                  onOpen: () => navigate(`/app/category/${categoryId}/folder/${folder.id}`),
                }))}
              />
            ) : (
              channelReady && (
                <div className="mb-6 py-8 text-center">
                  <div className="mb-2 text-4xl">📂</div>
                  <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">No folders yet</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                    Create a folder to organize, or upload files directly below
                  </p>
                </div>
              )
            )}

            {files.length > 0 && (
              <div className="mt-2">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Files
                </h3>
                <MediaGrid media={files} onPreview={onPreview} onDownload={onDownload} onDelete={onDelete} />
              </div>
            )}

            {folders.length === 0 && files.length === 0 && channelReady && (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
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
                <button
                  onClick={onNewFolder}
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-transparent dark:text-slate-200 dark:shadow-none dark:hover:bg-white/5"
                >
                  + New Folder
                </button>
              </div>
            )}
            {folders.length === 0 && files.length === 0 && !channelReady && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => onDeleteCategory(category?.id, category?.name)}
                  className="min-h-11 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  Delete &amp; Recreate category
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}