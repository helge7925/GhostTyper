import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOutboundUrl,
  extractClientIp,
  isIpAllowedByList,
  isMaintenanceRequestAllowed,
  isPrivateOrLoopbackIp,
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
