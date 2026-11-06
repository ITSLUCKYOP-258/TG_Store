/**
 * Quick-access folder list (Telegram-X style, see screenshot 1):
 * Titled section header with optional ⋯ menu, then rows of circular folder
 * icons + name + subtitle + action. System-theme aware (light & dark).
 *
 * Props:
 *   title      — section label ("Quick access", "Folders", …)
 *   items      — [{ id, name, subtitle, onOpen, onDelete }]
 *   onOpenMenu — optional (item) => void for section menu
 */
export default function QuickAccess({ title, items = [], onOpenMenu }) {
  if (!items.length) return null;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between px-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </h2>
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label={`${title} menu`}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
        )}
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-white/5 dark:border-white/5 dark:bg-[#17212b] dark:shadow-none">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
            <button
              type="button"
              onClick={() => item.onOpen?.()}
              className="flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3 text-left"
            >
              {/* Circular Telegram-X folder icon */}
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-sky-500/15 dark:text-sky-400">
                <svg
                  className="h-6 w-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </span>
              {/* Name + subtitle */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {item.name}
                </span>
                {item.subtitle && (
                  <span className="block truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                    {item.subtitle}
                  </span>
                )}
              </span>
            </button>

            {item.onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  item.onDelete();
                }}
                title={`Delete ${item.name}`}
                className="mr-3 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

