import { useState, useEffect } from 'react';
import { api } from '../api.js';
import CreateMenu from './CreateMenu.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import DevicesModal from './DevicesModal.jsx';

/** Format bytes into a human-readable string */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export default function Sidebar({
  user,
  categories = [],
  categoryId,
  navigate,
  onNewCategory,
  onNewFolder,
  onLogout,
  onDeleteCategory,
  mobileOpen,
  onCloseMenu,
}) {
  const [storage, setStorage] = useState(null);
  const [showDevices, setShowDevices] = useState(false);

  useEffect(() => {
    api.storageStats()
      .then(setStorage)
      .catch(() => {});
  }, []);

  // Shared sidebar body — rendered inside both desktop rail and mobile drawer
  const body = (
    <div className="flex h-full flex-col bg-white dark:bg-[#17212b]">
      <div className="flex items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <img
            src="/logo-icon.png"
            alt="TGStore"
            className="h-8 w-auto max-w-[44px] flex-shrink-0 object-contain drop-shadow-sm"
          />
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
              TG<span className="text-sky-500 dark:text-sky-400">Store</span>
            </h1>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">Telegram-powered storage</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ThemeToggle />
          <CreateMenu onNewCategory={onNewCategory} onNewFolder={onNewFolder} />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <button
          onClick={() => navigate('/app')}
          className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold transition ${!categoryId ? 'bg-indigo-50 text-indigo-700 dark:bg-sky-500/15 dark:text-sky-300' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white'}`}
        >
          📨 Saved Messages
        </button>

        <div className="mt-4">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Categories</span>
            <button
              onClick={onNewCategory}
              className="rounded-lg px-2 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-sky-400 dark:hover:bg-white/5 dark:hover:text-sky-300"
            >
              + New
            </button>
          </div>

          {(categories || []).map((cat) => (
            <div
              key={cat.id}
              onClick={() => navigate(`/app/category/${cat.id}`)}
              className={`group flex min-h-11 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm transition ${Number(categoryId) === Number(cat.id) ? 'bg-indigo-50 text-indigo-700 font-bold dark:bg-sky-500/15 dark:text-sky-300' : 'text-slate-700 font-medium hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white'}`}
            >
              <span className="truncate">📁 {cat.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteCategory?.(cat.id, cat.name); }}
                title={`Delete category "${cat.name}" (files inside are also purged from Telegram)`}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </nav>


      {/* ── Storage usage bar ── */}
      {storage !== null && (
        <div className="px-4 pb-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 dark:bg-[#0e1621] dark:border-white/5 px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-indigo-500 dark:text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <ellipse cx="12" cy="6" rx="8" ry="3" />
                  <path d="M4 6v6c0 1.657 3.582 3 8 3s8-1.343 8-3V6" />
                  <path d="M4 12v6c0 1.657 3.582 3 8 3s8-1.343 8-3v-6" />
                </svg>
                Storage Used
              </span>
              <span className="text-xs font-bold text-indigo-600 dark:text-sky-400">{formatBytes(storage.used)}</span>
            </div>
            {/* Simple gradient bar — no limit, just shows usage visually */}
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div className="absolute inset-y-0 left-0 w-full rounded-full bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600"
                style={{ opacity: storage.used > 0 ? 1 : 0.3 }}
              />
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {storage.files} {storage.files === 1 ? 'file' : 'files'} · Unlimited ∞
            </p>
          </div>
        </div>
      )}

      {/* User row — extra bottom padding for home-indicator on iOS */}
      <div className="border-t border-slate-200 dark:border-white/5 p-4 pb-safe">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-white/10 dark:text-slate-100">
            {user?.name?.[0] || 'U'}
          </div>
          <button
            type="button"
            onClick={() => setShowDevices(true)}
            title="My account & devices"
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{user?.name}</p>
            <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
              {user?.username ? `@${user.username}` : user?.phone || 'Logged in'}
              {user?.tgId ? ` · ID ${user.tgId}` : ''}
            </p>
          </button>
          <button
            onClick={onLogout}
            title="Log out"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:shadow-none dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar rail (hidden on mobile) ── */}
      <div className="hidden w-64 flex-shrink-0 border-r border-slate-200 dark:border-white/5 md:flex md:flex-col">
        {body}
      </div>

      {/* ── Mobile drawer backdrop ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
          onClick={onCloseMenu}
        />
      )}

      {/* ── Mobile drawer panel ── */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-200 dark:border-white/5 shadow-2xl transition-transform duration-300 ease-in-out md:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Navigation menu"
      >
        {body}
      </div>

      {showDevices && (
        <DevicesModal
          user={user}
          onClose={() => setShowDevices(false)}
          onLoggedOut={() => { setShowDevices(false); onLogout?.(); }}
        />
      )}
    </>
  );
}


