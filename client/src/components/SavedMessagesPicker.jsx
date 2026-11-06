import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function SavedMessagesPicker({ onSelect, onClose }) {
  const [media, setMedia] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  // Fixed: was incorrectly using useState (which ignores the dependency array);
  // useEffect correctly re-fetches when `filter` changes.
  useEffect(() => {
    setLoading(true);
    api.savedMessages(filter).then(({ media }) => {
      setMedia(media || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [filter]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    // On mobile: slide up as a bottom sheet; on md+: centered modal
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center">
      <div className="flex w-full max-w-4xl flex-col bg-white dark:bg-[#17212b] shadow-2xl max-h-[90dvh] rounded-t-2xl md:max-h-[80vh] md:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/5 p-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Select from Saved Messages</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200 transition"
          >
            ✕
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 border-b border-slate-200 dark:border-white/5 p-4">
          {['all', 'photos', 'videos'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`min-h-9 rounded-full px-3.5 py-1 text-sm font-semibold transition ${
                filter === f
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 dark:bg-[#3390ec] dark:shadow-none'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Media grid */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 dark:border-white/10 dark:border-t-sky-400" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5">
              {media.map((m) => (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${
                    selected.has(m.id) ? 'border-indigo-500 ring-2 ring-indigo-200 dark:border-sky-400 dark:ring-sky-400/30' : 'border-transparent'
                  }`}
                >
                  {m.thumbnail ? (
                    <img src={m.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-100 dark:bg-white/5 text-2xl">
                      {m.mime?.startsWith('video') ? '🎬' : '🖼'}
                    </div>
                  )}
                  {selected.has(m.id) && (
                    <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 dark:bg-sky-500 text-xs text-white">✓</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 dark:border-white/5 p-4 pb-safe">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{selected.size} selected</p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="min-h-11 rounded-lg border border-slate-300 bg-white dark:bg-transparent dark:border-white/10 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition hover:bg-slate-50 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={() => onSelect(media.filter((m) => selected.has(m.id)))}
              disabled={selected.size === 0}
              className="min-h-11 rounded-lg bg-indigo-600 dark:bg-[#3390ec] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 dark:hover:bg-[#4aa3f0] disabled:opacity-50"
            >
              Upload Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}