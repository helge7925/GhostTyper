import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, PERMISSIONS, hasPermission, assertPermission } from '../lib/permissions.js';

test('ROLES are ordered least → most powerful', () => {
  assert.deepEqual(ROLES, ['viewer', 'auditor', 'member', 'admin', 'owner']);
});

test('hasPermission: viewer can read but not write transcriptions', () => {
  assert.equal(hasPermission('viewer', 'transcription.read'), true);
  assert.equal(hasPermission('viewer', 'transcription.write'), false);
  assert.equal(hasPermission('viewer', 'transcription.delete'), false);
});

test('hasPermission: member can start meetings, not administer them', () => {
  assert.equal(hasPermission('member', 'meeting.start'), true);
  assert.equal(hasPermission('member', 'meeting.admin'), false);
});

test('hasPermission: admin manages org settings + members, owner-only stays closed', () => {
  assert.equal(hasPermission('admin', 'org.settings'), true);
  assert.equal(hasPermission('admin', 'org.members.write'), true);
  assert.equal(hasPermission('admin', 'org.billing'), false);
  assert.equal(hasPermission('admin', 'org.delete'), false);
});

test('hasPermission: owner has billing + delete', () => {
  assert.equal(hasPermission('owner', 'org.billing'), true);
  assert.equal(hasPermission('owner', 'org.delete'), true);
});

test('hasPermission: auditor sees audit log but cannot write content', () => {
  assert.equal(hasPermission('auditor', 'audit.read'), true);
  assert.equal(hasPermission('auditor', 'audit.export'), true);
  assert.equal(hasPermission('auditor', 'transcription.write'), false);
  // auditor is NOT a member, so it must not inherit member powers
  assert.equal(hasPermission('auditor', 'meeting.start'), false);
});

test('hasPermission fails closed on unknown role / permission / nullish', () => {
  assert.equal(hasPermission('superuser', 'org.delete'), false);
  assert.equal(hasPermission('owner', 'does.not.exist'), false);
  assert.equal(hasPermission(null, 'transcription.read'), false);
  assert.equal(hasPermission('owner', null), false);
  assert.equal(hasPermission(undefined, undefined), false);
  assert.equal(hasPermission('', ''), false);
});

test('every permission lists only known roles', () => {
  for (const [perm, roles] of Object.entries(PERMISSIONS)) {
    assert.ok(Array.isArray(roles), `${perm} must map to an array`);
    for (const r of roles) {
      assert.ok(ROLES.includes(r), `${perm} references unknown role "${r}"`);
    }
  }
});

test('read-tier permissions include the whole role set', () => {
  for (const perm of ['transcription.read', 'template.read', 'folder.read', 'org.read']) {
    assert.deepEqual([...PERMISSIONS[perm]].sort(), [...ROLES].sort(), `${perm} should be readable by all roles`);
  }
});

test('assertPermission throws a 403/FORBIDDEN error when denied', () => {
  assert.throws(
    () => assertPermission('viewer', 'transcription.write'),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.permission, 'transcription.write');
      return true;
    },
  );
});

test('assertPermission is silent (no throw) when allowed', () => {
  assert.doesNotThrow(() => assertPermission('owner', 'org.delete'));
  assert.doesNotThrow(() => assertPermission('member', 'transcription.write'));
});
