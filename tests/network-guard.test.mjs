import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
