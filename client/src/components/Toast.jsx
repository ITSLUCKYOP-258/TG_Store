export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    // Full-width on mobile (left-4 right-4), centred pill on sm+
    <div
      className={`fixed bottom-4 left-4 right-4 z-50 rounded-xl px-5 py-3 text-center text-sm font-medium text-white shadow-xl mb-safe sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2 sm:text-left ${toast.isError ? 'bg-red-600' : 'bg-slate-900'}`}
    >
      {toast.msg}
    </div>
  );
}