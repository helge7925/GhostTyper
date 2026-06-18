import axios from 'axios';
import { assertOutboundUrl } from '../network-guard.js';

const DEFAULT_TIMEOUT_MS = 20_000;

function authHeader(username, appPassword) {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`;
}

// Encode each path segment but keep the slashes between them.
function encodePath(relPath) {
  return String(relPath || '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function davRoot(baseUrl, username) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Nextcloud baseUrl is not configured.');
  return `${base}/remote.php/dav/files/${encodeURIComponent(username)}`;
}

// SSRF guard + redirect lockdown, mirroring the Vexa client (lib/api/vexa.js):
// validate the configured baseUrl and forbid redirects so a hostile URL cannot
// 30x to a private/metadata host.
async function davRequest({ baseUrl, username, appPassword }, method, relPath, { data, headers = {}, okStatuses } = {}) {
  if (!baseUrl || !username || !appPassword) {
    throw new Error('Nextcloud-Zugangsdaten unvollständig.');
  }
  await assertOutboundUrl(baseUrl);
  const url = `${davRoot(baseUrl, username)}/${encodePath(relPath)}`;
  const response = await axios.request({
    url,
    method,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRedirects: 0,
    headers: { Authorization: authHeader(username, appPassword), ...headers },
    data,
    // We decide success ourselves so WebDAV-specific codes (207, 405) are handled.
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const ok = okStatuses ? okStatuses.includes(response.status) : (response.status >= 200 && response.status < 300);
  if (!ok) {
    const err = new Error(`Nextcloud ${method} ${relPath || '/'} → HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response;
}

/** PROPFIND the user's WebDAV root to verify URL + credentials. */
export async function testConnection({ baseUrl, username, appPassword, targetFolder }) {
  await davRequest({ baseUrl, username, appPassword }, 'PROPFIND', targetFolder || '', {
    headers: { Depth: '0' },
    // 207 = exists; 404 = creds valid but folder missing (still a valid login).
    okStatuses: [207, 404],
  });
  return { ok: true };
}

/** Create a folder (and parents) if missing. MKCOL is idempotent enough here. */
export async function ensureFolder(creds, folderPath) {
  const segments = String(folderPath || '').split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    // 201 = created, 405 = already exists — both fine.
    // eslint-disable-next-line no-await-in-loop
    await davRequest(creds, 'MKCOL', current, { okStatuses: [201, 405, 301, 200] });
  }
}

/** PUT a file. Returns the relative remote path written. */
export async function uploadFile(creds, relPath, buffer, contentType = 'application/octet-stream') {
  await davRequest(creds, 'PUT', relPath, {
    data: buffer,
    headers: { 'Content-Type': contentType },
    okStatuses: [200, 201, 204],
  });
  return relPath;
}
