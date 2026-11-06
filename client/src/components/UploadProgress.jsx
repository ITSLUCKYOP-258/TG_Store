export default function UploadProgress({ uploads }) {
  if (!uploads || uploads.length === 0) return null;
  return (
    // Full-width on mobile; fixed 20rem card on md+
    <div className="fixed bottom-4 left-4 right-4 z-50 space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl mb-safe dark:border-white/10 dark:bg-[#17212b] md:left-auto md:right-4 md:w-80">
      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Uploading…</p>
      {uploads.map((u) => (
        <div key={u.id}>
          <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="truncate">{u.name}</span>
            <span>{u.error ? 'Failed' : `${u.progress}%`}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className={`h-full rounded-full transition-all ${u.error ? 'bg-red-500' : 'bg-indigo-600 dark:bg-sky-400'}`}
              style={{ width: `${u.error ? 100 : u.progress}%` }}
            />
          </div>
          {u.error && <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{u.error}</p>}
        </div>
      ))}
    </div>
  );
}