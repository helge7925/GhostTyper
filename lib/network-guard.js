import net from 'net';
import dns from 'node:dns/promises';

const PRIVATE_NETWORKS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

const allowlistCache = new Map();

function toIpTypeLabel(ipType) {
  return ipType === 6 ? 'ipv6' : 'ipv4';
}

function parsePrefix(prefixRaw) {
  const parsed = Number.parseInt(prefixRaw, 10);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeIpCandidate(value) {
  if (Array.isArray(value)) {
    return normalizeIpCandidate(value[0]);
  }
  if (typeof value !== 'string') return '';

  let candidate = value.trim();
  if (!candidate) return '';

  const commaIndex = candidate.indexOf(',');
  if (commaIndex >= 0) {
    candidate = candidate.slice(0, commaIndex).trim();
  }

  if (candidate.startsWith('[') && candidate.includes(']')) {
    candidate = candidate.slice(1, candidate.indexOf(']'));
  } else if (candidate.includes('.') && candidate.includes(':')) {
    const [host] = candidate.split(':');
    candidate = host;
  }

  if (candidate.includes('%')) {
    candidate = candidate.split('%')[0];
  }

  if (candidate.startsWith('::ffff:')) {
    const mapped = candidate.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) {
      candidate = mapped;
    }
  }

  return net.isIP(candidate) ? candidate : '';
}

function addAllowlistEntry(blockList, entryRaw) {
  const entry = entryRaw.trim();
  if (!entry || entry === '*') return;

  if (!entry.includes('/')) {
    const ipType = net.isIP(entry);
    if (!ipType) return;
    blockList.addAddress(entry, toIpTypeLabel(ipType));
    return;
  }

  const [networkRaw, prefixRaw] = entry.split('/');
  const network = normalizeIpCandidate(networkRaw);
  if (!network) return;

  const ipType = net.isIP(network);
  const maxPrefix = ipType === 6 ? 128 : 32;
  const prefix = parsePrefix(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return;

  blockList.addSubnet(network, prefix, toIpTypeLabel(ipType));
}

function createBlockList(entries) {
  const blockList = new net.BlockList();
  for (const entry of entries) {
    addAllowlistEntry(blockList, entry);
  }
  return blockList;
}

const privateNetworkBlockList = createBlockList(PRIVATE_NETWORKS);

function parseAllowlist(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function shouldTrustForwardedHeaders(req, trustProxy) {
  if (!trustProxy) return false;
  const remoteIp = normalizeIpCandidate(req?.socket?.remoteAddress || '');
  if (!remoteIp) return false;
  const ipType = net.isIP(remoteIp);
  if (!ipType) return false;
  return privateNetworkBlockList.check(remoteIp, toIpTypeLabel(ipType));
}

export function extractClientIp(req, options = {}) {
  const {
    trustProxy = process.env.RATE_LIMIT_TRUST_PROXY === 'true',
  } = options;

  if (!req) return '';

  if (shouldTrustForwardedHeaders(req, trustProxy)) {
    const xRealIp = normalizeIpCandidate(req.headers?.['x-real-ip']);
    if (xRealIp) return xRealIp;

    const xForwardedFor = normalizeIpCandidate(req.headers?.['x-forwarded-for']);
    if (xForwardedFor) return xForwardedFor;
  }

  return normalizeIpCandidate(req.socket?.remoteAddress || '');
}

export function isPrivateOrLoopbackIp(ip) {
  const normalizedIp = normalizeIpCandidate(ip);
  if (!normalizedIp) return false;

  const ipType = net.isIP(normalizedIp);
  if (!ipType) return false;

  return privateNetworkBlockList.check(normalizedIp, toIpTypeLabel(ipType));
}

function getAllowlistBlockList(entries) {
  const cacheKey = entries.join(',');
  if (allowlistCache.has(cacheKey)) {
    return allowlistCache.get(cacheKey);
  }

  const blockList = createBlockList(entries);
  allowlistCache.set(cacheKey, blockList);
  return blockList;
}

export function isIpAllowedByList(ip, entries = []) {
  const normalizedIp = normalizeIpCandidate(ip);
  if (!normalizedIp) return false;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (entries.includes('*')) return true;

  const ipType = net.isIP(normalizedIp);
  if (!ipType) return false;

  const blockList = getAllowlistBlockList(entries);
  return blockList.check(normalizedIp, toIpTypeLabel(ipType));
}

// ---------------------------------------------------------------------------
// M10: central outbound URL guard.
//
// Cloud metadata hosts and IMDS endpoints are blocked unconditionally. The
// hostname is resolved via DNS, and every returned address is checked against
// the same private-network block list used for ingress, so DNS-rebinding to
// an internal IP after a string allowlist check is prevented. An optional
// positive allowlist (OUTBOUND_ALLOWED_HOSTS, comma-separated, exact-match)
// can be enabled to lock down egress in production.
// ---------------------------------------------------------------------------

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.com',
  'instance-data.ec2.internal',
  '169.254.169.254',
  'fd00:ec2::254',
]);

function parseHostList(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function outboundError(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

export async function assertOutboundUrl(url, options = {}) {
  const {
    allowLoopback = process.env.NODE_ENV !== 'production'
      && process.env.OUTBOUND_BLOCK_LOOPBACK !== 'true',
  } = options;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw outboundError('OUTBOUND_INVALID_URL', `Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw outboundError('OUTBOUND_PROTOCOL_BLOCKED', `Protocol not allowed: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw outboundError('OUTBOUND_INVALID_URL', 'Empty hostname');
  }
  if (METADATA_HOSTS.has(hostname)) {
    throw outboundError('OUTBOUND_HOST_BLOCKED', `Cloud metadata host blocked: ${hostname}`);
  }

  const allowedHosts = parseHostList(process.env.OUTBOUND_ALLOWED_HOSTS);
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    throw outboundError('OUTBOUND_HOST_NOT_ALLOWLISTED', `Host not in OUTBOUND_ALLOWED_HOSTS: ${hostname}`);
  }

  let addresses;
  const literal = net.isIP(hostname);
  if (literal) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch (error) {
      throw outboundError('OUTBOUND_DNS_FAIL', `DNS lookup failed for ${hostname}`, { cause: error });
    }
  }

  for (const a of addresses) {
    if (isPrivateOrLoopbackIp(a.address)) {
      if (!allowLoopback) {
        throw outboundError('OUTBOUND_PRIVATE_IP', `Private IP blocked: ${a.address}`, { hostname, address: a.address });
      }
    }
  }
}

export async function safeFetch(url, init = {}, options = {}) {
  await assertOutboundUrl(url, options);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal || controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw outboundError('HTTP_TIMEOUT', `HTTP_TIMEOUT:${timeoutMs}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function isMaintenanceRequestAllowed(req, options = {}) {
  const {
    allowlistEnv = 'MAINTENANCE_IP_ALLOWLIST',
    allowInNonProduction = true,
    trustProxy = process.env.RATE_LIMIT_TRUST_PROXY === 'true',
  } = options;

  if (allowInNonProduction && process.env.NODE_ENV !== 'production') {
    return true;
  }

  const clientIp = extractClientIp(req, { trustProxy });
  if (!clientIp) return false;

  if (isPrivateOrLoopbackIp(clientIp)) {
    return true;
  }

  const configuredAllowlist = parseAllowlist(process.env[allowlistEnv]);
  if (configuredAllowlist.length === 0) {
    return false;
  }

  return isIpAllowedByList(clientIp, configuredAllowlist);
}
