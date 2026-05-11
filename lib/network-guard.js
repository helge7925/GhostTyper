import net from 'net';
import dns from 'node:dns/promises';

const PRIVATE_NETWORKS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  // IPv4 link-local (RFC 3927). Includes the EC2/GCP metadata IP
  // 169.254.169.254, but covers anything in the range — e.g.
  // 169.254.169.123 — that an attacker could try to reach when
  // metadata services are accessed via alternate addresses on the
  // same link-local subnet.
  '169.254.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  // Note: IPv4-mapped IPv6 (::ffff:X) is handled by normalizing to the
  // dotted IPv4 form in normalizeIpCandidate, NOT by adding ::ffff:0:0/96
  // here. Node's BlockList treats that subnet as covering the full IPv4
  // address space, which would mark every public IP as private.
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
      // Dotted form: ::ffff:127.0.0.1 → 127.0.0.1
      candidate = mapped;
    } else {
      // Compact hex form: ::ffff:7f00:1 → 127.0.0.1. Without this
      // conversion the address survives as IPv6 and would bypass the
      // IPv4-only private-network entries — net.BlockList's IPv6 prefix
      // mechanism cannot distinguish the IPv4-mapped /96 from the full
      // IPv4 space (it marks every IPv4 address as a member of the /96).
      const hexMapped = ipv6MappedHexToIpv4(candidate);
      if (hexMapped) candidate = hexMapped;
    }
  }

  return net.isIP(candidate) ? candidate : '';
}

function ipv6MappedHexToIpv4(addr) {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
  if (!match) return null;
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  if (Number.isNaN(high) || Number.isNaN(low)) return null;
  if (high < 0 || high > 0xffff || low < 0 || low > 0xffff) return null;
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
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

// SSRF redirect-bypass guard: a public host that passes assertOutboundUrl can
// still 30x to 127.0.0.1 or 169.254.169.254. Native fetch's `redirect: 'follow'`
// would silently follow without re-validating the new target. We force
// `redirect: 'manual'` and walk the redirect chain ourselves so every hop
// goes through assertOutboundUrl. maxRedirects caps the chain at 3 by default
// to defend against redirect loops; pass options.maxRedirects = 0 to forbid
// redirects entirely.
const DEFAULT_MAX_REDIRECTS = 3;

export async function safeFetch(url, init = {}, options = {}) {
  const maxRedirects = Number.isInteger(options.maxRedirects) && options.maxRedirects >= 0
    ? options.maxRedirects
    : DEFAULT_MAX_REDIRECTS;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let currentUrl = url;
  let response;

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      await assertOutboundUrl(currentUrl, options);
      response = await fetch(currentUrl, {
        ...init,
        redirect: 'manual',
        signal: init.signal || controller.signal,
      });

      if (response.status < 300 || response.status >= 400 || response.status === 304) {
        return response;
      }

      const location = response.headers.get('location');
      if (!location) {
        // 3xx without Location header — return as-is, caller decides.
        return response;
      }

      if (hop === maxRedirects) {
        throw outboundError(
          'OUTBOUND_TOO_MANY_REDIRECTS',
          `Exceeded ${maxRedirects} redirect hops starting from ${url}`,
          { startUrl: url, lastUrl: currentUrl, location }
        );
      }

      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        throw outboundError(
          'OUTBOUND_INVALID_REDIRECT',
          `Invalid redirect target: ${location}`,
          { startUrl: url, lastUrl: currentUrl }
        );
      }
    }
    return response;
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
