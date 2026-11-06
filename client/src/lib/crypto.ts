/**
 * TGStore - Zero-Knowledge Client-Side E2EE (crypto.ts)
 *
 * Everything here runs in the user's browser via the Web Crypto API
 * (crypto.subtle). The backend/Telegram only ever sees opaque ciphertext
 * and public salt - the AES key and passphrase never leave this module.
 *
 * ----------------------------------------------------------------------
 * WIRE FORMAT v1 (files)                        (server stays agnostic)
 *   [4B magic "TGS1"][16B salt][frame]*
 *   frame  = [12B IV][4B ctLen BE][ciphertext (ctLen bytes)]
 *   ciphertext includes the 16-byte AES-GCM auth tag.
 *   additionalData = 4-byte BE frame index (binds each frame's position,
 *                   so chunk reordering / truncation is detected).
 *
 * Server-side note: the Express backend re-chunks whatever bytes it
 * receives into 19 MiB Telegram parts and reassembles them in order on
 * download, so our own 16 MiB framing round-trips unchanged.
 *
 * ----------------------------------------------------------------------
 * ARMORED STRINGS (names, sizes, mimes, arbitrary text)
 *   "TGS1:" + base64url( 12B IV || ciphertext-with-tag )
 *   IV is a fresh random 12 bytes per value.
 * ----------------------------------------------------------------------
 * PERF: 16 MiB plaintext chunks keep encrypt/decrypt streaming
 * (constant memory) for multi-GB files via TransformStream.
 */

/* - Format constants -------------------------------------------------- */

/** 4-byte magic prefix so future format bumps are detected & rejected. */
export const MAGIC = new Uint8Array([0x54, 0x47, 0x53, 0x31]); // "TGS1"
/** Bytes of the random per-vault salt. Public - never secret. */
export const SALT_SIZE = 16;
/** NIST-recommended GCM nonce size. */
export const IV_SIZE = 12;
/** Big-endian ciphertext-length field inside each frame. */
export const LEN_SIZE = 4;
/** AES-GCM authentication tag length. */
export const TAG_SIZE = 16;
/** Salt + magic header length (bytes). */
export const HEADER_SIZE = MAGIC.length + SALT_SIZE;
/**
 * PBKDF2-SHA256 iteration count.
 * Requirement floor is 100,000; we harden to 310,000 on modern hardware
 * (matches TelDrive - ~200-400 ms unlock on desktop, still instant UX).
 */
export const PBKDF2_ITERATIONS = 310_000;
/** Minimum accepted iterations - protects against stored-param downgrade. */
export const MIN_PBKDF2_ITERATIONS = 100_000;
/**
 * Plaintext bytes per encrypted frame. Keeps per-frame buffers small
 * while staying well under the server's 19 MiB Telegram parts.
 */
export const PLAIN_CHUNK_SIZE = 16 * 1024 * 1024;
/** Wire version number reported by metadata. */
export const WIRE_FORMAT_VERSION = 1;
/** Prefix for armored (base64url) string values. */
export const ARMOR_PREFIX = 'TGS1:';

/** All runtime byte buffers are ArrayBuffer-backed (TS 5.7+ generic). */
type Bytes = Uint8Array<ArrayBuffer>;

/* - Errors ------------------------------------------------------------ */

export type VaultErrorCode =
  | 'NOT_UNLOCKED'
  | 'WRONG_PASSPHRASE'
  | 'CORRUPTED_DATA'
  | 'UNSUPPORTED_FORMAT'
  | 'NOT_SUPPORTED';

/** Typed error for every crypto failure - lets callers branch cleanly. */
export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

/** Narrowing helper: `if (isVaultError(e)) e.code ...`. */
export function isVaultError(e: unknown): e is VaultError {
  return e instanceof VaultError;
}

/* - Web Crypto availability / buffer plumbing ------------------------- */

function assertWebCrypto(): void {
  if (!globalThis.crypto?.subtle || !crypto.getRandomValues) {
    throw new VaultError(
      'NOT_SUPPORTED',
      'Web Crypto API is unavailable in this browser (HTTPS required).'
    );
  }
}

/** TS-generic saver: normalize any ArrayBufferView to a plain Uint8Array. */
function ensureView(buf: Uint8Array | ArrayBuffer): Bytes {
  return buf instanceof Uint8Array ? (buf as Bytes) : new Uint8Array(buf);
}

/** Naive concat - used only for small borders, never whole files. */
function concat(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** 4-byte big-endian frame index used as GCM additionalData. */
function indexAad(index: number): Bytes {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, index, false); // BE
  return aad;
}

/* - Base64url (RFC 4648 sec.5) ---------------------------------------- */

function toBase64Url(bytes: Bytes): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Bytes {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* - Key derivation & random helpers ----------------------------------- */

/** Generate a fresh random salt (public; stored next to the vault). */
export function generateSalt(): Bytes {
  assertWebCrypto();
  return crypto.getRandomValues(new Uint8Array(SALT_SIZE));
}

/**
 * Derive the 256-bit AES-GCM key from a user passphrase.
 *
 * PBKDF2-SHA256 produces 32 raw bytes which are imported as an
 * NON-EXPORTABLE CryptoKey. The key is opaque, lives only in session
 * memory, and can never be serialized or sent to the backend.
 *
 * @throws VaultError if iterations < MIN_PBKDF2_ITERATIONS or WebCrypto
 *         is unavailable.
 */
export async function deriveKey(
  passphrase: string,
  salt: Bytes | ArrayBuffer,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  assertWebCrypto();
  if (iterations < MIN_PBKDF2_ITERATIONS) {
    throw new VaultError(
      'UNSUPPORTED_FORMAT',
      `PBKDF2 iterations ${iterations} are below the ${MIN_PBKDF2_ITERATIONS} minimum.`
    );
  }
  if (!passphrase) {
    throw new VaultError('WRONG_PASSPHRASE', 'A vault passphrase is required.');
  }

  try {
    const saltBytes = ensureView(salt);
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'] as KeyUsage[]
    );
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes as unknown as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'] as KeyUsage[]
    );
  } catch (e) {
    throw new VaultError('NOT_SUPPORTED', `Key derivation failed: ${(e as Error).message}`);
  }
}

/* - File header helpers ------------------------------------------------ */

/** Build the byte [magic + salt] header. Never reuse a salt across vaults. */
export function buildHeader(salt: Bytes | ArrayBuffer): Bytes {
  const s = ensureView(salt);
  if (s.length !== SALT_SIZE) {
    throw new VaultError('CORRUPTED_DATA', `Salt must be ${SALT_SIZE} bytes.`);
  }
  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC, 0);
  header.set(s, MAGIC.length);
  return header;
}

/**
 * Validate & extract the salt from a byte header.
 * Rejects unknown magic or malformed headers (forward-compat).
 */
export function parseHeader(bytes: Bytes | ArrayBuffer): Bytes {
  const buf = ensureView(bytes);
  if (buf.length < HEADER_SIZE) {
    throw new VaultError(
      'CORRUPTED_DATA',
      `Encrypted payload too short (${buf.length} < ${HEADER_SIZE} header bytes).`
    );
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[i] !== MAGIC[i]) {
      throw new VaultError(
        'UNSUPPORTED_FORMAT',
        'Unrecognized TGStore encrypted payload magic.'
      );
    }
  }
  return buf.slice(MAGIC.length, HEADER_SIZE);
}

/* - Frame primitives --------------------------------------------------- */

/**
 * Encrypt one plaintext frame -> [12B IV][4B len][ciphertext+tag].
 * A fresh random IV is attached per frame (requirement #2).
 */
async function encryptFrame(
  key: CryptoKey,
  index: number,
  plaintext: Bytes,
  maxPlain: number
): Promise<Bytes> {
  if (plaintext.length > maxPlain) {
    throw new VaultError(
      'CORRUPTED_DATA',
      `Frame ${index} exceeds the ${maxPlain}-byte plaintext limit.`
    );
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const aad = indexAad(index);
  const raw = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      additionalData: aad as unknown as BufferSource,
      tagLength: 128,
    },
    key,
    plaintext
  );
  const ct = new Uint8Array(raw);
  const frame = new Uint8Array(IV_SIZE + LEN_SIZE + ct.length);
  frame.set(iv, 0);
  new DataView(frame.buffer).setUint32(IV_SIZE, ct.length, false); // BE
  frame.set(ct, IV_SIZE + LEN_SIZE);
  return frame;
}

/**
 * Decrypt one [IV][len][ciphertext] frame, verifying GCM tag + frame index.
 * @throws VaultError(CORRUPTED_DATA | WRONG_PASSPHRASE) on any failure.
 */
async function decryptFrame(
  key: CryptoKey,
  index: number,
  iv: Bytes,
  ciphertext: Bytes
): Promise<Bytes> {
  const aad = indexAad(index);
  try {
    const raw = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: 128,
      },
      key,
      ciphertext
    );
    return new Uint8Array(raw);
  } catch {
    // GCM tag mismatch is the only failure mode here.
    throw new VaultError(
      index === 0 ? 'WRONG_PASSPHRASE' : 'CORRUPTED_DATA',
      index === 0
        ? 'Wrong vault passphrase, or the file header is not from this vault.'
        : `Frame ${index} failed authentication - data was corrupted or tampered.`
    );
  }
}
/* - Streaming file encryption (TransformStream) -------------------------- */

export interface EncryptFileOptions {
  /** Plaintext bytes per frame (default PLAIN_CHUNK_SIZE). */
  chunkSize?: number;
}

/**
 * Returns a TransformStream that encrypts an incoming plaintext byte
 * stream into an outgoing ciphertext stream of frames (no header - use
 * encryptFile() when you need the salted, self-contained payload).
 *
 * Memory use is bounded by chunkSize - safe for multi-gigabyte inputs.
 */
export function createEncryptStream(
  key: CryptoKey,
  opts: EncryptFileOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  const chunkSize = opts.chunkSize ?? PLAIN_CHUNK_SIZE;
  if (chunkSize < 1024) {
    throw new VaultError('CORRUPTED_DATA', `chunkSize ${chunkSize} bytes is too small.`);
  }
  let index = 0;
  let buffer = new Uint8Array(0);

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      const view = ensureView(chunk);
      let combined = buffer.length > 0 ? concat(buffer, view) : view;
      while (combined.length >= chunkSize) {
        const plain = combined.slice(0, chunkSize);
        combined = combined.slice(chunkSize);
        controller.enqueue(await encryptFrame(key, index++, plain, chunkSize));
      }
      buffer = combined;
    },
    async flush(controller) {
      if (buffer.length > 0) {
        controller.enqueue(await encryptFrame(key, index++, buffer, chunkSize));
        buffer = new Uint8Array(0);
      }
    },
  });
}

/**
 * Encrypt a Blob/File end-to-end (WIRE FORMAT v1).
 * Generates a fresh salt (or reuses the provided one) and returns both
 * the ciphertext Blob and the salt so callers can store it.
 */
export async function encryptFile(
  file: Blob,
  key: CryptoKey,
  opts: EncryptFileOptions & { salt?: Uint8Array | ArrayBuffer } = {}
): Promise<{ encrypted: Blob; salt: Bytes }> {
  assertWebCrypto();
  const salt = opts.salt ? ensureView(opts.salt) : generateSalt();
  const header = buildHeader(salt);
  const parts: Bytes[] = [header];

  const collector = new WritableStream<Uint8Array>({
    write(chunk) {
      parts.push(ensureView(chunk));
    },
  });

  await file.stream().pipeThrough(createEncryptStream(key, opts)).pipeTo(collector);

  return {
    encrypted: new Blob(parts, { type: 'application/octet-stream' }),
    salt,
  };
}

/* - Streaming decryption ------------------------------------------------ */

/**
 * Read exactly `size` bytes at absolute `offset` within a Blob.
 * @returns null on a clean EOF (offset === blob.size); throws
 *          CORRUPTED_DATA on truncated payloads.
 */
async function readExact(blob: Blob, offset: number, size: number): Promise<Bytes | null> {
  if (offset === blob.size) return null; // clean EOF
  if (offset > blob.size) {
    throw new VaultError('CORRUPTED_DATA', 'Encrypted payload overruns its own length.');
  }
  const end = Math.min(offset + size, blob.size);
  const raw = await blob.slice(offset, end).arrayBuffer();
  if (raw.byteLength < size) {
    throw new VaultError('CORRUPTED_DATA', 'Encrypted payload is truncated mid-frame.');
  }
  return new Uint8Array(raw);
}

/**
 * Decrypt a WIRE FORMAT v1 Blob back to plaintext.
 * Streams frame by frame - memory stays bounded regardless of file size.
 *
 * @throws VaultError(WRONG_PASSPHRASE) when the key does not match frame 0;
 *         VaultError(CORRUPTED_DATA) for tamper / truncation.
 */
export async function decryptFile(blob: Blob, key: CryptoKey): Promise<Blob> {
  assertWebCrypto();
  const header = await readExact(blob, 0, HEADER_SIZE);
  if (header === null) {
    throw new VaultError('CORRUPTED_DATA', 'Encrypted payload is empty.');
  }
  parseHeader(header); // throws on unknown magic / short header

  const plains: Bytes[] = [];
  let offset = HEADER_SIZE;
  let index = 0;

  for (;;) {
    const head = await readExact(blob, offset, IV_SIZE + LEN_SIZE);
    if (head === null) break; // clean EOF after last complete frame

    const iv = head.slice(0, IV_SIZE);
    const ctLen = new DataView(head.buffer, IV_SIZE, LEN_SIZE).getUint32(0, false);
    if (ctLen > PLAIN_CHUNK_SIZE + TAG_SIZE) {
      throw new VaultError(
        'CORRUPTED_DATA',
        `Frame ${index} declares an impossible length ${ctLen}.`
      );
    }

    offset += IV_SIZE + LEN_SIZE;
    const ct = await readExact(blob, offset, ctLen);
    if (ct === null) {
      throw new VaultError('CORRUPTED_DATA', `Frame ${index} is truncated (missing ciphertext).`);
    }
    offset += ctLen;

    plains.push(await decryptFrame(key, index, iv, ct)); // index is AAD-bound
    index += 1;
  }

  return new Blob(plains);
}

/** Result of decryptToObjectURL - call revoke() when done. */
export interface ObjectUrlHandle {
  url: string;
  revoke: () => void;
}

/**
 * Decrypt a Blob and hand back an object URL + cleanup.
 * Use for previews / downloads obtained via fetch().
 */
export async function decryptToObjectURL(
  blob: Blob,
  key: CryptoKey,
  mime: string = 'application/octet-stream'
): Promise<ObjectUrlHandle> {
  const plain = await decryptFile(blob, key);
  const typed = new Blob([plain], { type: mime });
  const url = URL.createObjectURL(typed);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/* - Armored strings (metadata: name, size, mime, ...) ------------------ */

/**
 * Encrypt an arbitrary UTF-8 string. Output is armor:
 *   "TGS1:" + base64url(IV || ciphertext-with-tag)
 */
export async function encryptString(value: string, key: CryptoKey): Promise<string> {
  assertWebCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const raw = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
    key,
    new TextEncoder().encode(value)
  );
  return ARMOR_PREFIX + toBase64Url(concat(iv, new Uint8Array(raw)));
}

/** Decrypt an armored string produced by encryptString. */
export async function decryptString(armored: string, key: CryptoKey): Promise<string> {
  assertWebCrypto();
  if (typeof armored !== 'string' || !armored.startsWith(ARMOR_PREFIX)) {
    throw new VaultError('UNSUPPORTED_FORMAT', 'Value is not a TGStore armored string.');
  }
  try {
    const raw = fromBase64Url(armored.substring(ARMOR_PREFIX.length));
    if (raw.length < IV_SIZE + TAG_SIZE) {
      throw new VaultError('CORRUPTED_DATA', 'Armored value is too short.');
    }
    const iv = raw.slice(0, IV_SIZE);
    const ct = raw.slice(IV_SIZE);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
      key,
      ct
    );
    return new TextDecoder().decode(plain);
  } catch (e) {
    if (isVaultError(e)) throw e;
    throw new VaultError(
      'WRONG_PASSPHRASE',
      'Could not decrypt vault metadata - wrong passphrase or corrupted entry.'
    );
  }
}

/* - File metadata encryption ------------------------------------------- */

export interface FileMetadata {
  /** Format version - allows additive schema evolution in the future. */
  v: 1;
  name: string;
  mime: string;
  /**
   * TRUE plaintext size in bytes. The backend `files.size` column stores
   * the CIPHERTEXT length (it must, for Telegram limits), so the client
   * always renders `meta.size`.
   */
  size: number;
}

/**
 * Encrypt metadata (name, mime, size) into an armored string before it
 * leaves the browser. The backend persists it opaquely.
 */
export async function encryptMetadata(
  meta: Omit<FileMetadata, 'v'>,
  key: CryptoKey
): Promise<string> {
  const payload: FileMetadata = {
    v: WIRE_FORMAT_VERSION,
    name: meta.name ?? '',
    mime: meta.mime ?? 'application/octet-stream',
    size: Number(meta.size ?? 0),
  };
  if (payload.size < 0 || !Number.isFinite(payload.size)) {
    throw new VaultError('CORRUPTED_DATA', 'Metadata size must be a non-negative number.');
  }
  return encryptString(JSON.stringify(payload), key);
}

/** Decrypt metadata previously produced by encryptMetadata. */
export async function decryptMetadata(
  armored: string,
  key: CryptoKey
): Promise<FileMetadata> {
  const text = await decryptString(armored, key);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultError('CORRUPTED_DATA', 'Vault metadata is not valid JSON.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Object.prototype.hasOwnProperty.call(parsed, 'name') ||
    !Object.prototype.hasOwnProperty.call(parsed, 'mime') ||
    !Object.prototype.hasOwnProperty.call(parsed, 'size')
  ) {
    throw new VaultError('CORRUPTED_DATA', 'Vault metadata is missing required fields.');
  }
  const m = parsed as Record<string, unknown>;
  if (typeof m.name !== 'string' || typeof m.mime !== 'string' || typeof m.size !== 'number') {
    throw new VaultError('CORRUPTED_DATA', 'Vault metadata has invalid field types.');
  }
  const version = (m as { v?: unknown }).v ?? 1;
  if (version !== WIRE_FORMAT_VERSION) {
    throw new VaultError(
      'UNSUPPORTED_FORMAT',
      `Vault metadata version ${version} is not supported (expected ${WIRE_FORMAT_VERSION}).`
    );
  }
  return { v: WIRE_FORMAT_VERSION, name: m.name, mime: m.mime, size: m.size };
}





