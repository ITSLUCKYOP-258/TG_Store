import { useEffect } from 'react';

/**
 * Shared fixed-position popover menu. Used for the "⋯" row menus in the
 * sidebar and file list, and anywhere a small anchored action menu is needed.
 * Closes on outside click / right-click / Escape.
 */
export default function PopMenu({ x, y, actions, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          top: Math.min(y, window.innerHeight - 40 - actions.length * 40),
        }}
      >
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => {
              onClose();
              a.onClick?.();
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
