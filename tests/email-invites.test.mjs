import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeInviteFromName } from '../lib/email-invites.js';

test('sanitizeInviteFromName strips CR/LF and caps length', () => {
  const dirty = 'Team\tInvite\r\nName';
  assert.equal(sanitizeInviteFromName(dirty), 'TeamInviteName');

  const longName = 'a'.repeat(120);
  assert.equal(sanitizeInviteFromName(longName).length, 80);
});
