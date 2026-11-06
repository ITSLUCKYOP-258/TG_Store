/**
 * Top bar displaying mobile menu button, avatar, and context title.
 * The create menu is housed in the left sidebar.
 * System-theme aware via base + `dark:` classes.
 */
export default function TopBar({ title, user, onOpenMenu }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 dark:border-white/5 dark:bg-[#17212b] sm:px-4">
      {/* Left: mobile menu + avatar + version badge + title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 md:hidden"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-600 dark:bg-white/10 dark:text-slate-100"
          title={user?.name || 'Account'}
        >
          {user?.name?.[0]?.toUpperCase() || 'U'}
        </div>
        <span className="hidden rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-white/5 dark:text-slate-400 sm:inline">
          v2.0
        </span>
        {title ? (
          <span className="ml-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
            {title}
          </span>
        ) : null}
      </div>

      {/* Right: brand label keeps the bar balanced */}
      <div className="flex min-w-[4.5rem] items-center justify-end gap-1.5">
        <img src="/logo-icon.png" alt="TGStore" className="hidden h-5 w-auto object-contain sm:inline" />
        <span className="hidden text-xs font-semibold text-slate-700 dark:text-slate-200 sm:inline">
          TG<span className="text-sky-500 dark:text-sky-400">Store</span>
        </span>
      </div>
    </header>
  );
}
