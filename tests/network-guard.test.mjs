import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOutboundUrl,
  extractClientIp,
  isIpAllowedByList,
  isMaintenanceRequestAllowed,
  isPrivateOrLoopbackIp,
  safeFetch,
} from '../lib/network-guard.js';

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === null) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

test('extractClientIp ignores forwarded headers from non-private socket peer', () => {
  const ip = extractClientIp({
    headers: {
      'x-forwarded-for': '198.51.100.10',
    },
    socket: {
      remoteAddress: '203.0.113.22',
    },
  }, { trustProxy: true });

  assert.equal(ip, '203.0.113.22');
});

test('extractClientIp uses forwarded headers from trusted private peer', () => {
  const ip = extractClientIp({
    headers: {
      'x-forwarded-for': '198.51.100.10, 10.0.0.7',
    },
    socket: {
      remoteAddress: '10.0.0.7',
    },
  }, { trustProxy: true });

  assert.equal(ip, '198.51.100.10');
});

test('isPrivateOrLoopbackIp recognizes local ranges', () => {
  assert.equal(isPrivateOrLoopbackIp('127.0.0.1'), true);
  assert.equal(isPrivateOrLoopbackIp('10.10.1.20'), true);
  assert.equal(isPrivateOrLoopbackIp('203.0.113.2'), false);
});

test('isIpAllowedByList supports CIDR and wildcard entries', () => {
  assert.equal(isIpAllowedByList('203.0.113.25', ['203.0.113.0/24']), true);
  assert.equal(isIpAllowedByList('203.0.114.25', ['203.0.113.0/24']), false);
  assert.equal(isIpAllowedByList('203.0.114.25', ['*']), true);
});

test('isMaintenanceRequestAllowed blocks unknown public IPs when enforced', () => {
  withEnv('MAINTENANCE_IP_ALLOWLIST', '203.0.113.0/24', () => {
    const denied = isMaintenanceRequestAllowed({
      headers: {},
      socket: { remoteAddress: '203.0.114.10' },
    }, { allowInNonProduction: false, trustProxy: false });

    const allowed = isMaintenanceRequestAllowed({
      headers: {},
      socket: { remoteAddress: '203.0.113.10' },
    }, { allowInNonProduction: false, trustProxy: false });

    assert.equal(denied, false);
    assert.equal(allowed, true);
  });
});

test('isMaintenanceRequestAllowed permits loopback even without configured allowlist', () => {
  withEnv('MAINTENANCE_IP_ALLOWLIST', null, () => {
    const allowed = isMaintenanceRequestAllowed({
      headers: {},
      socket: { remoteAddress: '::1' },
    }, { allowInNonProduction: false, trustProxy: false });

    assert.equal(allowed, true);
  });
});

// ---------------------------------------------------------------------------
// M10 — assertOutboundUrl: SSRF / metadata-host / private-IP guard.
// We pin allowLoopback:false so the production-style check applies regardless
// of NODE_ENV during the test run.
// ---------------------------------------------------------------------------

test('assertOutboundUrl rejects cloud metadata hostnames', async () => {
  await assert.rejects(
    () => assertOutboundUrl('http://169.254.169.254/latest/meta-data/', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_HOST_BLOCKED' || err.code === 'OUTBOUND_PRIVATE_IP',
  );
  await assert.rejects(
    () => assertOutboundUrl('http://metadata.google.internal/', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_HOST_BLOCKED',
  );
});

test('assertOutboundUrl rejects file:// and other non-http schemes', async () => {
  await assert.rejects(
    () => assertOutboundUrl('file:///etc/passwd', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_PROTOCOL_BLOCKED',
  );
  await assert.rejects(
    () => assertOutboundUrl('gopher://attacker.example/', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_PROTOCOL_BLOCKED',
  );
});

test('assertOutboundUrl rejects literal private IP destinations', async () => {
  await assert.rejects(
    () => assertOutboundUrl('http://10.0.0.5/', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_PRIVATE_IP',
  );
  await assert.rejects(
    () => assertOutboundUrl('http://127.0.0.1:8080/', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_PRIVATE_IP',
  );
});

test('assertOutboundUrl honours OUTBOUND_ALLOWED_HOSTS when set', async () => {
  const previous = process.env.OUTBOUND_ALLOWED_HOSTS;
  process.env.OUTBOUND_ALLOWED_HOSTS = 'api.mistral.ai,api.resend.com';
  try {
    await assert.rejects(
      () => assertOutboundUrl('https://attacker.example/', { allowLoopback: false }),
      (err) => err.code === 'OUTBOUND_HOST_NOT_ALLOWLISTED',
    );
  } finally {
    if (previous === undefined) delete process.env.OUTBOUND_ALLOWED_HOSTS;
    else process.env.OUTBOUND_ALLOWED_HOSTS = previous;
  }
});

test('assertOutboundUrl rejects malformed URLs', async () => {
  await assert.rejects(
    () => assertOutboundUrl('not a url', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_INVALID_URL',
  );
});

// ---------------------------------------------------------------------------
// SSRF redirect-bypass + extended IP-range coverage (Copilot B1, B2, B3).
// ---------------------------------------------------------------------------

test('isPrivateOrLoopbackIp covers IPv4 link-local 169.254.0.0/16', () => {
  // Whole range — the metadata IP 169.254.169.254 was already covered via
  // METADATA_HOSTS but the rest of the link-local block was reachable.
  assert.equal(isPrivateOrLoopbackIp('169.254.0.1'), true);
  assert.equal(isPrivateOrLoopbackIp('169.254.169.123'), true);
  assert.equal(isPrivateOrLoopbackIp('169.254.255.254'), true);
  // Boundary — 169.255.x is outside the link-local /16.
  assert.equal(isPrivateOrLoopbackIp('169.255.0.1'), false);
});

test('isPrivateOrLoopbackIp covers IPv4-mapped IPv6 in compact form', () => {
  // Compact hex form survives normalize (only the dotted form is rewritten),
  // so the explicit ::ffff:0:0/96 entry has to do the work.
  assert.equal(isPrivateOrLoopbackIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateOrLoopbackIp('::ffff:a9fe:a9fe'), true); // ::ffff:169.254.169.254
});

test('assertOutboundUrl rejects link-local destinations', async () => {
  await assert.rejects(
    () => assertOutboundUrl('http://169.254.0.7/probe', { allowLoopback: false }),
    (err) => err.code === 'OUTBOUND_PRIVATE_IP',
  );
});

test('safeFetch validates every redirect hop', async () => {
  // Stub global fetch so the test never hits the network. The handler returns
  // a 302 to 127.0.0.1, which must trip assertOutboundUrl on hop 2 — proving
  // the per-hop validation works.
  const originalFetch = globalThis.fetch;
  let firstUrl = '';
  globalThis.fetch = async (url) => {
    if (firstUrl === '') firstUrl = url;
    if (url === 'https://example.com/') {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:8080/secrets' },
      });
    }
    return new Response('ok', { status: 200 });
  };
  try {
    await assert.rejects(
      () => safeFetch('https://example.com/', {}, { allowLoopback: false }),
      (err) => err.code === 'OUTBOUND_PRIVATE_IP',
    );
    assert.equal(firstUrl, 'https://example.com/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('safeFetch enforces redirect hop limit', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { location: `https://example.com/hop-${calls}` },
    });
  };
  try {
    await assert.rejects(
      () => safeFetch('https://example.com/start', {}, { allowLoopback: false, maxRedirects: 2 }),
      (err) => err.code === 'OUTBOUND_TOO_MANY_REDIRECTS',
    );
    // 2 hops allowed → 3 actual fetch invocations (start + hop-1 + hop-2),
    // then the third Location push triggers the limit error.
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('safeFetch with maxRedirects=0 forbids any redirect', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, { status: 302, headers: { location: 'https://example.com/next' } });
  try {
    await assert.rejects(
      () => safeFetch('https://example.com/', {}, { allowLoopback: false, maxRedirects: 0 }),
      (err) => err.code === 'OUTBOUND_TOO_MANY_REDIRECTS',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
