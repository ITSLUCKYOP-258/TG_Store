import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminStats,
  adminUsers,
  adminUser,
  adminLogins,
  adminBan,
  adminLogoutAll,
  adminDisconnectTelegram,
  adminRevokeSession,
} from '../api.js';
import { formatBytes, formatDateTime, timeAgo } from '../lib/format.js';

const SESSION_KEY = 'tgstore_admin_key';
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.is_dev ? 'Dev User' : '—');
const phoneOf = (p) => (p ? (String(p).startsWith('+') ? p : `+${p}`) : '—');

const METHOD_LABEL = {
  'telegram-phone': '📱 Phone + OTP',
  'telegram-widget': '🔗 Telegram widget',
  dev: '🧪 Dev login',
};

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    blue: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  };
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

function Card({ label, value, icon, sub }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold text-slate-800 dark:text-white">
        <span className="mr-1 text-lg">{icon}</span>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p> : null}
    </div>
  );
}

const th = 'px-4 py-3 whitespace-nowrap';
const td = 'px-4 py-3 whitespace-nowrap';

/**
 * Hidden admin dashboard — reachable ONLY by typing /admin in the URL.
 * Access = the server's ADMIN_KEY (sent as x-admin-key on every call).
 * The key is kept in sessionStorage only (cleared when the browser closes).
 */
export default function Admin() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(SESSION_KEY) || '');
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem(SESSION_KEY));
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logins, setLogins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('users');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null); // { user, sessions, logins, categories, recentFiles }
  const [notice, setNotice] = useState('');
  const [auto, setAuto] = useState(true);

  const load = useCallback(async (key, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [s, u, l] = await Promise.all([adminStats(key), adminUsers(key), adminLogins(key, 300)]);
      setStats(s);
      setUsers(u.users || []);
      setLogins(l.logins || []);
      setAuthed(true);
      setAdminKey(key);
      sessionStorage.setItem(SESSION_KEY, key);
    } catch (e) {
      if (silent) return; // keep showing the last good data on a hiccup
      setAuthed(false);
      sessionStorage.removeItem(SESSION_KEY);
      setError(
        /404/.test(e.message) || /Not found/i.test(e.message)
          ? 'Admin API is disabled on this server (ADMIN_KEY not set).'
          : /429|Too many/i.test(e.message)
          ? 'Too many wrong keys — try again in 15 minutes.'
          : 'Invalid admin key.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const k = sessionStorage.getItem(SESSION_KEY);
    if (k) load(k);
  }, [load]);

  // Live refresh every 15 s so new logins show up without reloading
  useEffect(() => {
    if (!authed || !auto) return undefined;
    const t = setInterval(() => load(adminKey, true), 15000);
    return () => clearInterval(t);
  }, [authed, auto, adminKey, load]);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setAdminKey('');
    setInput('');
    setAuthed(false);
    setStats(null);
    setUsers([]);
    setLogins([]);
    setDetail(null);
  };

  const openUser = async (id) => {
    try {
      setDetail(await adminUser(adminKey, id));
    } catch (e) {
      flash(e.message);
    }
  };

  const act = async (fn, okMsg, reopenId) => {
    try {
      await fn();
      flash(okMsg);
      await load(adminKey, true);
      if (reopenId) setDetail(await adminUser(adminKey, reopenId));
    } catch (e) {
      flash(e.message);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [fullName(u), u.username, u.tg_id, u.mt_phone, String(u.id), u.last_ip, u.last_device]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [users, query]);

  const filteredLogins = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logins;
    return logins.filter((e) =>
      [e.first_name, e.last_name, e.username, e.tg_id, e.mt_phone, e.ip, e.device, e.browser, e.os, e.method]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [logins, query]);

  const exportCsv = () => {
    const rows = [
      ['DB id', 'Telegram ID', 'Name', 'Username', 'Phone', 'Files', 'Storage bytes', 'Devices', 'Logins', 'Last login (UTC)', 'Joined (UTC)', 'Last device', 'Last IP', 'Blocked'],
      ...users.map((u) => [u.id, u.tg_id || '', fullName(u), u.username || '', u.mt_phone || '', u.file_count, u.storage_bytes, u.active_sessions, u.login_count, u.last_login || '', u.created_at, u.last_device || '', u.last_ip || '', u.banned ? 'yes' : '']),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `tgstore-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  /* ── login screen ── */
  if (!authed) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 px-4 dark:bg-[#0e1621]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!loading && input) load(input.trim());
          }}
          className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-1 text-center text-5xl">🛡️</div>
          <h1 className="text-center text-xl font-bold text-slate-800 dark:text-white">Admin access</h1>
          <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
            Enter the server admin key to see who logged in, their devices and storage.
          </p>
          <input
            type="password"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Admin key"
            className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
          {error && <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !input}
            className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500"
          >
            {loading ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  const tabBtn = (id, label, count) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
        tab === id
          ? 'bg-slate-900 text-white dark:bg-indigo-600'
          : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {label} {count != null ? <span className="ml-1 opacity-70">{count}</span> : null}
    </button>
  );

  /* ── dashboard ── */
  return (
    <div className="min-h-full bg-slate-100 dark:bg-[#0e1621]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">🛡️ TGStore Admin</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Who logged in, from which device, and what they store.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Live
            </label>
            <button onClick={() => load(adminKey)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              ⟳ Refresh
            </button>
            <button onClick={exportCsv} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              ⬇ CSV
            </button>
            <button onClick={logout} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Sign out
            </button>
          </div>
        </div>

        {notice && <div className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">{notice}</div>}

        {loading && !stats ? (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
          </div>
        ) : stats ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Card label="Users" value={stats.total_users ?? 0} icon="👥" sub={`${stats.dev_users || 0} dev · ${stats.banned_users || 0} blocked`} />
              <Card label="Logged in now" value={stats.active_sessions ?? 0} icon="📲" sub="active devices" />
              <Card label="Logins 24h" value={stats.logins_24h ?? 0} icon="🔑" sub={`${stats.active_last_24h ?? 0} users`} />
              <Card label="Active 7d" value={stats.active_last_7d ?? 0} icon="🟢" />
              <Card label="Files" value={stats.total_files ?? 0} icon="🗂️" sub={`${stats.total_categories ?? 0} categories`} />
              <Card label="Storage" value={formatBytes(stats.total_bytes ?? 0)} icon="💾" sub={`${stats.telegram_connected ?? 0} Telegram linked`} />
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {tabBtn('users', '👥 Users', users.length)}
              {tabBtn('logins', '🔑 Login activity', logins.length)}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, @username, Telegram ID, phone, IP, device…"
                className="ml-auto w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white sm:w-96"
              />
            </div>

            {tab === 'users' ? (
              <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm dark:bg-slate-900">
                <table className="w-full min-w-[1000px] text-left text-sm text-slate-700 dark:text-slate-200">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                      <th className={th}>Telegram ID</th>
                      <th className={th}>Name</th>
                      <th className={th}>Username</th>
                      <th className={th}>Phone</th>
                      <th className={th}>Devices</th>
                      <th className={`${th} text-right`}>Files</th>
                      <th className={`${th} text-right`}>Storage</th>
                      <th className={th}>Last login</th>
                      <th className={th}>Last device / IP</th>
                      <th className={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr
                        key={u.id}
                        onClick={() => openUser(u.id)}
                        className="cursor-pointer border-b border-slate-50 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/60"
                      >
                        <td className={`${td} font-mono text-xs text-slate-500`}>
                          {u.tg_id || '—'}
                          <span className="ml-1 text-slate-300 dark:text-slate-600">#{u.id}</span>
                        </td>
                        <td className={`${td} font-medium text-slate-800 dark:text-white`}>
                          {fullName(u)} {u.is_dev ? <Badge tone="amber">DEV</Badge> : null}
                        </td>
                        <td className={td}>{u.username ? `@${u.username}` : '—'}</td>
                        <td className={td}>{phoneOf(u.mt_phone)}</td>
                        <td className={td}>
                          {u.active_sessions > 0 ? <Badge tone="green">{u.active_sessions} online</Badge> : <Badge>0</Badge>}
                        </td>
                        <td className={`${td} text-right`}>{u.file_count ?? 0}</td>
                        <td className={`${td} text-right font-medium`}>{formatBytes(u.storage_bytes ?? 0)}</td>
                        <td className={`${td} text-slate-500`} title={formatDateTime(u.last_login)}>{timeAgo(u.last_login)}</td>
                        <td className={`${td} text-xs text-slate-500`}>
                          {u.last_device || '—'}
                          {u.last_ip ? <span className="block text-slate-400">{u.last_ip}</span> : null}
                        </td>
                        <td className={td}>
                          {u.banned ? <Badge tone="red">Blocked</Badge> : u.telegram_connected ? <Badge tone="blue">TG linked</Badge> : <Badge>—</Badge>}
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">No users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm dark:bg-slate-900">
                <table className="w-full min-w-[1000px] text-left text-sm text-slate-700 dark:text-slate-200">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                      <th className={th}>When</th>
                      <th className={th}>Event</th>
                      <th className={th}>User</th>
                      <th className={th}>Telegram ID</th>
                      <th className={th}>Phone</th>
                      <th className={th}>Method</th>
                      <th className={th}>Device</th>
                      <th className={th}>Browser / OS</th>
                      <th className={th}>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogins.map((e) => (
                      <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800/60">
                        <td className={`${td} text-slate-500`} title={formatDateTime(e.created_at)}>{formatDateTime(e.created_at)}</td>
                        <td className={td}>{e.event === 'login' ? <Badge tone="green">Login</Badge> : <Badge>Logout</Badge>}</td>
                        <td className={`${td} font-medium text-slate-800 dark:text-white`}>
                          {fullName(e)} {e.username ? <span className="font-normal text-slate-400">@{e.username}</span> : null}
                        </td>
                        <td className={`${td} font-mono text-xs text-slate-500`}>{e.tg_id || '—'}</td>
                        <td className={td}>{phoneOf(e.mt_phone)}</td>
                        <td className={td}>{METHOD_LABEL[e.method] || e.method}</td>
                        <td className={td}>{e.device}</td>
                        <td className={td}>{e.browser} · {e.os}</td>
                        <td className={`${td} font-mono text-xs`}>{e.ip || '—'}</td>
                      </tr>
                    ))}
                    {filteredLogins.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No login activity yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* ── user detail drawer ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDetail(null)}>
          <div
            className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                  {fullName(detail.user)} {detail.user.is_dev ? <Badge tone="amber">DEV</Badge> : null}{' '}
                  {detail.user.banned ? <Badge tone="red">Blocked</Badge> : null}
                </h2>
                <p className="text-sm text-slate-500">
                  {detail.user.username ? `@${detail.user.username} · ` : ''}
                  {phoneOf(detail.user.mt_phone)}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-400">Telegram ID: {detail.user.tg_id || '—'} · DB #{detail.user.id}</p>
              </div>
              <button onClick={() => setDetail(null)} className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800"><b className="block text-base text-slate-800 dark:text-white">{detail.user.login_count}</b>logins</div>
              <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800"><b className="block text-base text-slate-800 dark:text-white">{detail.categories.length}</b>categories</div>
              <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800"><b className="block text-base text-slate-800 dark:text-white">{detail.sessions.filter((s) => !s.revoked).length}</b>devices online</div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Joined {formatDateTime(detail.user.created_at)} · last login {formatDateTime(detail.user.last_login)}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => act(() => adminBan(adminKey, detail.user.id, !detail.user.banned), detail.user.banned ? 'User unblocked' : 'User blocked', detail.user.id)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${detail.user.banned ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
              >
                {detail.user.banned ? 'Unblock user' : 'Block user'}
              </button>
              <button
                onClick={() => act(() => adminLogoutAll(adminKey, detail.user.id), 'Signed out of all devices', detail.user.id)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Log out all devices
              </button>
              {detail.user.telegram_connected ? (
                <button
                  onClick={() => confirm('Disconnect this user’s Telegram session?') && act(() => adminDisconnectTelegram(adminKey, detail.user.id), 'Telegram disconnected', detail.user.id)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Disconnect Telegram
                </button>
              ) : null}
            </div>

            <h3 className="mt-6 text-sm font-bold text-slate-700 dark:text-slate-200">📲 Devices</h3>
            <div className="mt-2 space-y-2">
              {detail.sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-800">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800 dark:text-white">
                      {s.device} · {s.browser} · {s.os}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {s.ip || 'unknown IP'} · {METHOD_LABEL[s.method] || s.method} · signed in {formatDateTime(s.created_at)} · seen {timeAgo(s.last_seen)}
                    </p>
                  </div>
                  {s.revoked ? (
                    <Badge>Signed out</Badge>
                  ) : (
                    <button
                      onClick={() => act(() => adminRevokeSession(adminKey, s.id), 'Device signed out', detail.user.id)}
                      className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                    >
                      Sign out
                    </button>
                  )}
                </div>
              ))}
              {detail.sessions.length === 0 && <p className="text-sm text-slate-400">No devices recorded yet.</p>}
            </div>

            <h3 className="mt-6 text-sm font-bold text-slate-700 dark:text-slate-200">📁 Categories</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.categories.map((c) => (
                <Badge key={c.id} tone="blue">{c.name} · {c.file_count}</Badge>
              ))}
              {detail.categories.length === 0 && <p className="text-sm text-slate-400">None.</p>}
            </div>

            <h3 className="mt-6 text-sm font-bold text-slate-700 dark:text-slate-200">🗂️ Latest files</h3>
            <div className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {detail.recentFiles.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-slate-700 dark:text-slate-200">{f.trashed ? '🗑 ' : ''}{f.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{formatBytes(f.size)} · {timeAgo(f.created_at)}</span>
                </div>
              ))}
              {detail.recentFiles.length === 0 && <p className="py-2 text-slate-400">No files.</p>}
            </div>

            <h3 className="mt-6 text-sm font-bold text-slate-700 dark:text-slate-200">🔑 Login history</h3>
            <div className="mt-2 divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {detail.logins.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 py-1.5 text-slate-600 dark:text-slate-300">
                  <span>{e.event === 'login' ? '🟢 Login' : '⚪ Logout'} · {e.device} · {e.browser} · {e.ip || '—'}</span>
                  <span className="shrink-0 text-slate-400">{formatDateTime(e.created_at)}</span>
                </div>
              ))}
              {detail.logins.length === 0 && <p className="py-2 text-slate-400">No history.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
