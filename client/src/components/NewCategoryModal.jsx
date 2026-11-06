import { useEffect } from 'react';

/**
 * Centered small modal for creating a new category:
 * appears in the center of the screen without shifting to the right-side drawer.
 * Follows system theme (light / dark).
 */
export default function NewCategoryModal({
  name,
  setName,
  onCreate,
  onClose,
  error = null,
  submitting = false,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const submit = () => { if (!submitting && name.trim()) onCreate(); };
  const filled = name.trim().length > 0;

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
            New Category
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

        {/* Error */}
        {error && (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            ❌ {error}
          </div>
        )}

        {/* Input */}
        <div className="mt-1">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Enter category name
          </label>
          <input
            type="text"
            value={name}
            disabled={submitting}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter category name"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 dark:border-white/10 dark:bg-[#0e1621] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
          />
          <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            A Telegram channel is created automatically for this category.
          </p>
        </div>

        {/* Actions */}
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
            disabled={submitting || !filled}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 dark:bg-[#3390ec] dark:hover:bg-[#4aa3f0]"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}