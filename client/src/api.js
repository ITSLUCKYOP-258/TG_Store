/**
 * Small JSON API wrapper.
 * - Browser / PWA: cookies are sent automatically (same-origin / proxied).
 * - Capacitor (Android / iOS native): cookies don't work cross-origin, so we
 *   store the JWT in localStorage and send it as an Authorization: Bearer header.
 */

// When building for Android set VITE_API_BASE_URL=https://yourserver.com
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '') + '/api';

// ── Token helpers (used by Capacitor native builds) ──────────────────────────
const TOKEN_KEY = 'tgstore_jwt';
export const saveToken = (t) => { if (t) localStorage.setItem(TOKEN_KEY, t); };
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
const getToken = () => localStorage.getItem(TOKEN_KEY);

// True when running inside a Capacitor Android/iOS shell
const isNative = () =>
  typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

// Accepts both '/categories' and '/api/categories' (legacy callers pass the full prefix).
function normalize(path) {
  if (!path) return '/';
  return path.startsWith('/api/') ? path.slice(4) : path;
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(BASE + normalize(path), {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  // Auth
  devLogin: () => request('/auth/dev', { method: 'POST', body: '{}' }),
  me: () => request('/auth/me'),
  // Always forget the local token, even when the server can't be reached —
  // otherwise "Log out" appeared to do nothing and the old account came back.
  logout: async () => {
    try {
      return await request('/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      clearToken();
    }
  },

  // My devices
  sessions: () => request('/auth/sessions'),
  revokeSession: (id) => request(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  logoutOthers: () => request('/auth/logout-others', { method: 'POST', body: '{}' }),

  // MTProto
  mtConfig: () => request('/mt/config'),
  sendCode: (phone) => request('/mt/send-code', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyCode: (flowId, code) => request('/mt/verify-code', { method: 'POST', body: JSON.stringify({ flowId, code }) }),
  verifyPassword: (flowId, password) => request('/mt/verify-password', { method: 'POST', body: JSON.stringify({ flowId, password }) }),
  mtStatus: () => request('/mt/status'),

  // Saved Messages
  savedMessages: (filter = 'all') => request(`/mt/saved-messages?filter=${filter}`),
  copySavedToChannel: (savedMessageId, channelId, caption) => request('/mt/saved-messages/copy', { method: 'POST', body: JSON.stringify({ savedMessageId, channelId, caption }) }),

  // Categories
  listCategories: () => request('/categories'),
  createCategory: (name) => request('/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),

  // Folders
  listFolders: (categoryId, parentId) => request(`/folders?categoryId=${categoryId}&parentId=${parentId || ''}`),
  createFolder: (name, categoryId, parentId) => request('/folders', { method: 'POST', body: JSON.stringify({ name, categoryId, parentId }) }),
  deleteFolder: (id) => request(`/folders/${id}`, { method: 'DELETE' }),

  // Storage stats
  storageStats: () => request('/drive/storage'),

  // Files
  listFiles: (categoryId, folderId) => request(`/drive?categoryId=${categoryId || ''}&folder=${folderId || ''}`),
  uploadFromSaved: (savedMessageId, categoryId, folderId, name, mime, size) => request('/files/upload-from-saved', { method: 'POST', body: JSON.stringify({ savedMessageId, categoryId, folderId, name, mime, size }) }),
  deleteFile: (id) => request(`/files/${id}`, { method: 'DELETE' }),
};

/**
 * Upload with progress via XHR (fetch has no upload progress).
 * Returns a promise resolving to { file }.
 */
export function uploadFile(file, folderId, onProgress, signal, categoryId) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + '/files/upload');
    xhr.responseType = 'json';
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    const form = new FormData();
    form.append('file', file, file.name || 'file');
    form.append('name', file.name || 'file');
    form.append('mime', file.type || 'application/octet-stream');
    if (categoryId != null) form.append('categoryId', String(categoryId));
    if (folderId != null) form.append('folderId', String(folderId));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else {
        const errorMsg =
          xhr.response?.error ||
          (typeof xhr.response === 'string' && xhr.response.length < 200 ? xhr.response : null) ||
          `Upload failed (${xhr.status} ${xhr.statusText || ''})`.trim();
        reject(new Error(errorMsg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    signal?.addEventListener('abort', () => {
      xhr.abort();
      reject(new Error('Upload cancelled'));
    });
    xhr.send(form);
  });
}

export const downloadUrl = (id) => `${BASE}/files/${id}/download`;
export const rawUrl = (id) => `${BASE}/files/${id}/raw`;

// ── Admin (hidden /admin page — endpoints require the x-admin-key header) ──
const adminReq = (adminKey, path, options = {}) =>
  request(`/admin${path}`, { ...options, headers: { 'x-admin-key': adminKey, ...(options.headers || {}) } });

export const adminStats = (adminKey) => adminReq(adminKey, '/stats');
export const adminUsers = (adminKey) => adminReq(adminKey, '/users');
export const adminUser = (adminKey, id) => adminReq(adminKey, `/users/${id}`);
export const adminLogins = (adminKey, limit = 300) => adminReq(adminKey, `/logins?limit=${limit}`);
export const adminBan = (adminKey, id, banned) =>
  adminReq(adminKey, `/users/${id}/${banned ? 'ban' : 'unban'}`, { method: 'POST', body: '{}' });
export const adminLogoutAll = (adminKey, id) =>
  adminReq(adminKey, `/users/${id}/logout-all`, { method: 'POST', body: '{}' });
export const adminDisconnectTelegram = (adminKey, id) =>
  adminReq(adminKey, `/users/${id}/disconnect-telegram`, { method: 'POST', body: '{}' });
export const adminRevokeSession = (adminKey, sid) =>
  adminReq(adminKey, `/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' });
