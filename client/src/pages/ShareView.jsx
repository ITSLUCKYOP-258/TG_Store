import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatBytes, fileIcon } from '../lib/format.js';

/** Public page for a shared link: /s/:token (no login required). */
export default function ShareView() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/api/public/${token}`)
      .then(setMeta)
      .catch((e) => setError(e.message));
  }, [token]);

  const ic = meta ? fileIcon({ name: meta.name, mime: meta.mime }) : null;

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/logo-icon.png" alt="TGStore" className="h-9 w-auto object-contain" />
          <span className="text-base font-bold tracking-tight text-slate-900">
            TG<span className="text-sky-500">Store</span>
          </span>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</div>
        )}

        {meta && (
          <>
            <div
              className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl text-4xl ${ic.color}`}
            >
              {ic.icon}
            </div>
            <h1 className="break-all text-center text-lg font-bold text-slate-900">{meta.name}</h1>
            <p className="mt-1 text-center text-sm text-slate-400">
              {formatBytes(meta.size)} · shared via Telegram storage
            </p>
            {(meta.mime || '').startsWith('image/') && (
              <img
                src={meta.rawUrl}
                alt={meta.name}
                className="mt-5 max-h-72 w-full rounded-xl object-contain"
              />
            )}
            {(meta.mime || '').startsWith('video/') && (
              <video src={meta.rawUrl} controls className="mt-5 w-full rounded-xl" />
            )}
            {(meta.mime || '').startsWith('audio/') && (
              <audio src={meta.rawUrl} controls className="mt-5 w-full" />
            )}
            <a
              href={meta.downloadUrl}
              className="mt-6 block rounded-xl bg-indigo-600 py-3 text-center text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              ⬇ Download
            </a>
          </>
        )}
      </div>
    </div>
  );
}
