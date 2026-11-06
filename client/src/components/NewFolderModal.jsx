import { useEffect, useState } from 'react';

/**
 * Centered dialog for creating a new folder:
 * appears in the center of the screen instead of shifting right.
 * Follows system theme (light / dark).
 */
export default function NewFolderModal({
  name,
  setName,
  onCreate,
  onClose,
  error = null,
  submitting = false,
  success = null,
  categories = [],
  categoryId = null,
  onCategoryChange,
}) {
  const [selected, setSelected] = useState(categoryId ?? categories[0]?.id ?? '');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const hasCategories = (categories || []).length > 0;
  const activeCat = (categories || []).find((c) => String(c.id) === String(selected));

  const submit = () => {
    if (submitting || !name.trim() || !hasCategories) return;
    const cat = (categories || []).find((c) => String(c.id) === String(selected));
    if (cat && onCategoryChange) onCategoryChange(cat);
    onCreate(cat);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#17212b] dark:border dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            New Folder
          </h2>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>
        {/* Body */}
        <div className="mt-1 space-y-3">
          {!hasCategories && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              ⚠️ Create a category first — folders live inside a category&apos;s Telegram channel.
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              ✅ {success}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              ❌ {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Category</label>
            <div className="relative mt-1">
              <select
                value={selected}
                disabled={!hasCategories || submitting}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelected(id);
                  const cat = (categories || []).find((c) => String(c.id) === String(id));
                  if (cat && onCategoryChange) onCategoryChange(cat);
                }}
                className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 dark:border-white/10 dark:bg-[#0e1621] dark:text-slate-100"
              >
                {(categories || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Folder name</label>
            <input
              type="text"
              value={name}
              disabled={submitting}
              onChange={(e) => setName(e.target.value)}
              placeholder="Folder name"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 dark:border-white/10 dark:bg-[#0e1621] dark:text-slate-100 dark:placeholder-slate-500"
            />
          </div>

          {activeCat && (
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              A marker post will be made in “{activeCat.name}”.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim() || !hasCategories}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 dark:bg-[#3390ec] dark:hover:bg-[#4aa3f0]"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}