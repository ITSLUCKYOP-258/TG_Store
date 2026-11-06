import { useEffect, useRef, useState } from 'react';
import { rawUrl } from '../api.js';
import { useVault } from '../hooks/useVault';
import { decryptFile } from '../lib/crypto';
import { resolveMime } from '../lib/vault.js';

export default function SecureThumb({ item, fallback, className = 'h-full w-full object-cover' }) {
  const vault = useVault();
  const [url, setUrl] = useState(item?._localUrl || null);
  const holder = useRef(null);
  const started = useRef(false);
  const createdUrl = useRef(null);

  useEffect(() => {
    if (item?._localUrl) {
      setUrl(item._localUrl);
      return undefined;
    }

    const el = holder.current;
    if (!el || !item?.id) return undefined;

    const start = () => {
      const key = vault.getKey();
      if (!key) return; // Wait until vault key is available
      if (started.current) return;
      started.current = true;

      fetch(rawUrl(item.id), { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('raw fetch failed'))))
        .then((cipher) => decryptFile(cipher, key))
        .then((plain) => {
          const mime = resolveMime(item.name, item.mime);
          const u = URL.createObjectURL(new Blob([plain], { type: mime }));
          createdUrl.current = u;
          setUrl(u);
        })
        .catch(() => {
          // Keep fallback
        });
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          start();
          io.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    io.observe(el);

    if (vault.status === 'unlocked' && !started.current) {
      start();
    }

    return () => {
      io.disconnect();
      if (createdUrl.current) URL.revokeObjectURL(createdUrl.current);
    };
  }, [item?.id, item?.name, item?.mime, item?._localUrl, vault.status]);

  return (
    <div ref={holder} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {url ? (
        <img src={url} alt={item?.name || ''} className={className} />
      ) : (
        fallback || <span className="text-2xl">🖼️</span>
      )}
    </div>
  );
}
