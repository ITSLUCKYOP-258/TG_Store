import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDateTime, timeAgo } from '../lib/format.js';

const METHOD = { 'telegram-phone': 'Phone + OTP', 'telegram-widget': 'Telegram widget', dev: 'Dev login' };

/** Lists every device signed in to THIS account (same account, many devices). */
export default function DevicesModal({ user, onClose, onLoggedOut }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    api.sessions().then((d) => setSessions(d.sessions)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const revoke = async (s) => {
    try {
      await api.revokeSession(s.id);
      if (s.current) return onLoggedOut?.();
      load();
    } catch (e) { setError(e.message); }
  };
  const others = async () => {
    try { await api.logoutOthers(); load(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#17212b]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">My account &amp; devices</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {user?.name}{user?.username ? ` · @${user.username}` : ''}
            </p>
            <p className="font-mono text-xs text-slate-400">
              {user?.phone ? `${user.phone} · ` : ''}Telegram ID {user?.tgId || '—'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">✕</button>
        </div>

        <p className="mt-3 rounded-lg bg-sky-50 p-3 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
          Logging in from another phone or browser opens the <b>same account</b> — it is just listed here as another device.
        </p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {!sessions && !error && <div className="mx-auto my-8 h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />}

        <div className="mt-4 space-y-2">
          {sessions?.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">
                  {s.device} · {s.browser}
                  {s.current ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">THIS DEVICE</span> : null}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {s.os} · {s.ip || 'unknown IP'} · {METHOD[s.method] || s.method}
                </p>
                <p className="text-xs text-slate-400" title={formatDateTime(s.createdAt)}>
                  Signed in {formatDateTime(s.createdAt)} · active {timeAgo(s.lastSeen)}
                </p>
              </div>
              <button
                onClick={() => revoke(s)}
                className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
              >
                {s.current ? 'Log out' : 'Remove'}
              </button>
            </div>
          ))}
        </div>

        {sessions && sessions.length > 1 && (
          <button onClick={others} className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-indigo-600 dark:hover:bg-indigo-500">
            Log out all other devices
          </button>
        )}
      </div>
    </div>
  );
}
