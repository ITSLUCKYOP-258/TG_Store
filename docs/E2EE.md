# TGStore E2EE — Integration Guide

Zero-Knowledge Client-Side End-to-End Encryption. All crypto runs in the
browser (Web Crypto API / `crypto.subtle`). The backend and Telegram only ever
handle opaque ciphertext + public salt.

## Modules

| File                                      | Purpose                                            |
| ----------------------------------------- | -------------------------------------------------- |
| `client/src/lib/crypto.ts`    | key derivation, streaming encrypt/decrypt, metadata|
| `client/src/hooks/useVault.ts` | vault lock/unlock state + in-memory key holder     |

## Wire format v1 (files)

```
[4B magic "TGS1"][16B salt][frame]*
frame = [12B IV][4B ctLen BE][AES-256-GCM ciphertext+tag]
```

Armored strings (name/mime/size):  `"TGS1:" + base64url(IV || ciphertext+tag)`

## 1. Mount the provider (once, in App.jsx)

```jsx
import { VaultProvider, useVault } from './hooks/useVault.ts';

function VaultGate({ children }) {
  const vault = useVault();
  if (!vault.hasStoredVault()) {
    // First run: let the user choose a master passphrase.
    return <VaultSetup vault={vault} />;
  }
  if (vault.status !== 'unlocked') {
    return <VaultUnlock vault={vault} />;
  }
  return children;
}

export default function App() {
  return (
    <VaultProvider>
      <VaultGate>
        <Routes>
          {/* existing routes unchanged */}
        </Routes>
      </VaultGate>
    </VaultProvider>
  );
}
```

VaultUnlock example:

```jsx
function VaultUnlock({ vault }) {
  const [p, setP] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); vault.unlock(p); }}>
      <h1>Unlock vault</h1>
## 3. Download / preview (replace window.open + `<a href>`)

Current direct-navigation downloads break under E2EE (server bytes are
ciphertext). Use fetch + decrypt + object URL instead:

```js
async function vaultDownload(id, vault) {
  const key = vault.getKey();
  if (!key) throw new Error('Vault locked');
  const res = await fetch(`/api/files/${id}/download`);
  if (!res.ok) throw new Error('Download failed');
  return decryptToObjectURL(await res.blob(), key, 'application/octet-stream');
}

// usage (e.g. Drive.jsx / Categories.jsx context menu)
const handle = await vaultDownload(item.id, vault);
window.open(handle.url);               // decrypted temp URL
setTimeout(handle.revoke, 5 * 60_000); // optional cleanup
```

Preview components (MediaPreview / PreviewModal) should map each file id to a
decrypted object URL instead of using `rawUrl(id)` directly.

## 4. What needs server changes (Phase 2 — separate task)

- `files` table: add `meta TEXT` column to hold armored `{name,mime,size}`.
- `POST /files/upload`: accept armored `name` field, persist into `meta`,
  keep `size` = ciphertext length (still needed for Telegram limits).
- list endpoints (`drive.js`): return `meta`; filename for UI = `meta.name`
  decrypted client-side.
- `stream.js`: unchanged — bytes are opaque; Range headers keep working
  against ciphertext offsets (no mid-stream decryption in v1).

## Security notes

- Wrong passphrase => `VaultError(WRONG_PASSPHRASE)` from the first frame or
  from the stored self-check. No server round-trip leaks.
- Per-frame random IV + GCM tag + frame-index AAD detect tampering, chunk
  reordering and truncation.
- Key lives only in session memory (non-exportable CryptoKey); salt +
  iterations are public and persist in localStorage; passphrase is never
  stored.
- PBKDF2-SHA256 at 310k iterations (>= 100k requirement).

## Known limitations (v1)

- **Share links** (`/s/:token`) cannot decrypt (anonymous viewer has no
  vault). Needs a per-share keying scheme in Phase 2.
- **Video seeking / HTTP Range** decryption is full-file only; byte-offset
  decryption needs a chunk index inside encrypted metadata (deferred).
- `files.size` column leaks ciphertext length (unavoidable for limits).
      <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
      {vault.error && <p role="alert">{vault.error}</p>}
      <button disabled={vault.status === 'unlocking'}>Unlock</button>
    </form>
  );
}
```

## 2. Upload (wire into api.js uploadFile)

Encrypt the file stream and its metadata before anything leaves the browser:

```js
import { encryptFile, encryptMetadata } from '../lib/crypto.ts';
import { useVault } from '../hooks/useVault.ts';

// inside the upload action handler
const key = vault.getKey();          // CryptoKey | null
if (!key) throw new Error('Vault locked');

const { encrypted, salt } = await encryptFile(file, key);
const metaArmor = await encryptMetadata(
  { name: file.name, mime: file.type || 'application/octet-stream', size: file.size },
  key
);

// ciphertext Blob + armored metadata in the SAME multipart body fields.
await uploadFile(encrypted, folderId, onProgress, signal, categoryId, metaArmor);
```

Uploaded body now contains: `file` (ciphertext bytes), `name` (armored).
The server stores `name`/`mime`/`size` opaquely (Phase 2 persists them in a
dedicated `meta` column).