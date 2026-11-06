import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatBytes, formatDate } from '../lib/format.js';

export default function SharedLinks({ onChanged }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);

  const load = () => {
    api
      .get('/api/shares')
      .then((d) => setShares(d.shares))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const revoke = async (id) => {
    await api.del(`/api/shares/${id}`);
    load();
    onChanged?.();
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  if (!shares.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="text-5xl">🔗</div>
        <p className="font-medium text-slate-600">No shared links yet</p>
        <p className="text-sm text-slate-400">
          Right-click any file → “Share link” to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-2xl bg-white p-2 shadow-sm">
      {shares.map((s) => {
        const link = `${window.location.origin}/s/${s.token}`;
        return (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 transition hover:bg-slate-50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{s.name}</p>
              <p className="truncate text-xs text-slate-400">
                {formatBytes(s.size)} · created {formatDate(s.created_at)} ·{' '}
                <a href={link} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">
                  {link}
                </a>
              </p>
            </div>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopiedId(s.id);
                setTimeout(() => setCopiedId(null), 1500);
              }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              {copiedId === s.id ? 'Copied!' : 'Copy link'}
            </button>
            <button
              onClick={() => revoke(s.id)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Revoke
            </button>
          </div>
        );
      })}
    </div>
  );
}
