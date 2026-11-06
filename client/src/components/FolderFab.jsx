import { useEffect, useRef, useState } from 'react';

/**
 * Floating circular action button (Telegram-X style) that expands a small
 * flyout offering two choices — "New folder" and "New category".
 * Renders bottom-right; closes on outside click or Escape.
 */
export default function FolderFab({ onNewFolder, onNewCategory, disabled = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (disabled) return null;

  return (
    <div ref={wrapRef} className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="mb-1 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1c2733]">
          <button
            type="button"
            onClick={() => { setOpen(false); onNewFolder?.(); }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <span className="text-lg">📁</span> New folder
          </button>
          <div className="mx-4 border-t border-slate-100 dark:border-white/5" />
          <button
            type="button"
            onClick={() => { setOpen(false); onNewCategory?.(); }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <span className="text-lg">🗂</span> New category
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label="Create new"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-2xl font-light text-white shadow-lg transition hover:bg-indigo-700 ${open ? 'rotate-45' : ''}`}
      >
        +
      </button>
    </div>
  );
}