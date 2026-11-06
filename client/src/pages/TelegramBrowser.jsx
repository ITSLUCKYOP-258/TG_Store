import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatBytes, formatDate } from '../lib/format.js';
import TelegramPhoneLogin from '../components/TelegramPhoneLogin.jsx';
import { useAuth } from '../App.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'photo', label: '🖼 Photos' },
  { key: 'video', label: '🎬 Videos' },
  { key: 'doc', label: '📄 Documents' },
  { key: 'music', label: '🎵 Music' },
];

const KIND_ICON = {
  image: '🖼️',
  video: '🎬',
  music: '🎵',
  pdf: '📕',
  text: '📝',
  doc: '📄',
};

function TextPreview({ url }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    fetch(url, { credentials: 'include' })
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Could not load preview'));
  }, [url]);
  return (
    <pre className="max-h-[65vh] w-full overflow-auto p-6 text-left text-xs leading-relaxed text-emerald-200">
      {text ?? 'Loading…'}
    </pre>
  );
}

function PreviewModal({ preview, onClose }) {
  if (!preview) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800">{preview.name}</p>
            <p className="text-xs text-slate-400">
              {preview.mime} · {formatBytes(preview.size)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={preview.downloadUrl}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              ⬇ Download
            </a>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              ✕
            </button>
          </div>
        </div>
        <div className="flex max-h-[65vh] min-h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-950/95">
          {['image', 'video', 'audio', 'pdf', 'text'].includes(preview.kind) ? (
            preview.kind === 'image' ? (
              <img src={preview.rawUrl} alt={preview.name} className="max-h-[65vh] object-contain" />
            ) : preview.kind === 'video' ? (
              <video src={preview.rawUrl} controls className="max-h-[65vh] w-full" />
            ) : preview.kind === 'audio' ? (
              <div className="w-full p-10">
                <div className="mb-6 text-center text-5xl">🎵</div>
                <audio src={preview.rawUrl} controls className="w-full" />
              </div>
            ) : preview.kind === 'pdf' ? (
              <iframe src={preview.rawUrl} title={preview.name} className="h-[65vh] w-full bg-white" />
            ) : (
              <TextPreview url={preview.rawUrl} />
            )
          ) : (
            <div className="p-16 text-center text-white">
              <div className="mb-3 text-5xl">📦</div>
              <p className="text-sm text-slate-300">No preview available — download instead.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TelegramBrowser() {
  const { setUser } = useAuth();
  const [connected, setConnected] = useState(null);
  const [dialogs, setDialogs] = useState([]);
  const [dialogQ, setDialogQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    api
      .get('/api/mt/status')
      .then((d) => setConnected(d.connected))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    if (!connected) return;
    setLoading(true);
    api
      .get('/api/mt/dialogs')
      .then((d) => setDialogs(d.dialogs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [connected]);

  useEffect(() => {
    if (!selected) return;
    setMediaLoading(true);
    setMedia([]);
    api
      .get(`/api/mt/media?chat=${selected.id}&filter=${filter}`)
      .then((d) => setMedia(d.media))
      .catch((e) => setError(e.message))
      .finally(() => setMediaLoading(false));
  }, [selected, filter]);

  const openPreview = (m) =>
    setPreview({
      name: m.name,
      mime: m.mime,
      size: m.size,
      kind: m.kind,
      rawUrl: `/api/mt/media/${selected.id}/${m.msgId}/raw`,
      downloadUrl: `/api/mt/media/${selected.id}/${m.msgId}/download`,
    });

  if (connected === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-1 items-start justify-center pt-10">
        <div className="w-full max-w-md">
          <div className="mb-4 rounded-2xl border border-transparent bg-sky-50 p-4 text-sm text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/40 dark:text-sky-300">
            Connect your Telegram account to browse all the chats, channels and files that are in
            your Telegram — right here.
          </div>
          <TelegramPhoneLogin
            onConnected={(u) => {
              setUser(u);
              setConnected(true);
            }}
          />
        </div>
      </div>
    );
  }

  const visibleDialogs = dialogs.filter((d) =>
    d.title.toLowerCase().includes(dialogQ.toLowerCase())
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* chat list */}
      <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-slate-100 p-3">
          <input
            value={dialogQ}
            onChange={(e) => setDialogQ(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none focus:bg-slate-200/60"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && <p className="p-4 text-sm text-slate-400">Loading chats…</p>}
          {visibleDialogs.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelected(d)}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                selected?.id === d.id ? 'bg-sky-50 ring-1 ring-sky-200' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-bold text-white">
                  {d.title[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700">{d.title}</p>
                  <p className="truncate text-xs text-slate-400">
                    {d.type === 'user' ? '👤' : d.type === 'channel' ? '📢' : '👥'}{' '}
                    {d.lastMessage || d.type}
                  </p>
                </div>
              </div>
            </button>
          ))}
          {!loading && !visibleDialogs.length && (
            <p className="p-4 text-sm text-slate-400">No chats found.</p>
          )}
        </div>
        <button
          onClick={async () => {
            await api.post('/api/mt/disconnect');
            setConnected(false);
            setSelected(null);
          }}
          className="border-t border-slate-100 px-4 py-2.5 text-left text-xs text-red-500 hover:bg-red-50"
        >
          Disconnect Telegram account
        </button>
      </div>

      {/* media panel */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
              <h2 className="mr-auto truncate font-bold text-slate-800">{selected.title}</h2>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    filter === f.key
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {mediaLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-7 w-7 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
                </div>
              ) : media.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  No {filter === 'all' ? '' : filter} media in this chat.
                </p>
              ) : (
                media.map((m) => (
                  <div
                    key={m.msgId}
                    onDoubleClick={() => openPreview(m)}
                    className="group flex cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 transition hover:bg-slate-50"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-lg">
                      {KIND_ICON[m.kind] || '📄'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">{m.name}</p>
                      <p className="text-xs text-slate-400">
                        {formatBytes(m.size)} · {formatDate(m.date)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openPreview(m);
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 opacity-0 transition hover:bg-slate-200 group-hover:opacity-100"
                    >
                      👁 Preview
                    </button>
                    <a
                      href={`/api/mt/media/${selected.id}/${m.msgId}/download`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      ⬇
                    </a>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <div className="text-5xl">📨</div>
            <p className="font-medium text-slate-600">Select a chat</p>
            <p className="text-sm text-slate-400">
              Pick any chat or channel on the left to browse its files & media.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-red-600 px-5 py-3 text-sm font-medium text-white shadow-xl">
          {error}
        </div>
      )}

      <PreviewModal preview={preview} onClose={() => setPreview(null)} />

    </div>
  );
}

