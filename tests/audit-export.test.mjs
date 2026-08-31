import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { eventsToCsv } from '../lib/audit-csv.js';
import { AUDIT_ZERO_HASH, computeAuditEntryHash } from '../lib/audit-chain.js';
import {
  buildAuditExportPackage,
  verifyAuditExportPackage,
  verifyManifestSignature,
} from '../lib/audit-export.js';

function event() {
  const row = {
    id: 1, organization_id: 7, user_id: 2, action: '=CMD()', target_type: 'document',
    target_id: '+1', severity: 'info', metadata: { reason: 'approved' },
    created_at: new Date('2026-06-30T10:00:00.000Z'), prev_hash: AUDIT_ZERO_HASH,
  };
  row.entry_hash = computeAuditEntryHash(AUDIT_ZERO_HASH, row);
  return row;
}

test('CSV neutralizes spreadsheet formulas before RFC-style quoting', () => {
  const csv = eventsToCsv([event()]);
  assert.match(csv, /"'=CMD\(\)"/);
  assert.match(csv, /"'\+1"/);
});

test('signed package verifies manifest and content digests', async () => {
  const built = await buildAuditExportPackage({
    events: [event()], organization: { id: 7, name: 'Test Org' },
    range: { since: new Date('2026-06-01Z'), until: new Date('2026-07-01Z') },
    signingKey: 'test-only-secret', generatedAt: new Date('2026-06-30Z'),
    pdfRenderer: async () => Buffer.from('%PDF-test'),
  });
  assert.equal(built.manifest.signed, true);
  assert.equal(verifyManifestSignature(built.manifest, 'test-only-secret').valid, true);
  assert.equal((await verifyAuditExportPackage(built.buffer, 'test-only-secret')).valid, true);

  const zip = await JSZip.loadAsync(built.buffer);
  zip.file('audit-trail.csv', 'altered');
  const tampered = await zip.generateAsync({ type: 'nodebuffer' });
  const result = await verifyAuditExportPackage(tampered, 'test-only-secret');
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('audit-trail.csv:DIGEST_MISMATCH'));
});

test('package is explicitly unsigned when no signing key is configured', async () => {
  const built = await buildAuditExportPackage({
    events: [event()], organization: { id: 7, name: 'Test Org' },
    range: { since: new Date('2026-06-01Z'), until: new Date('2026-07-01Z') },
    signingKey: '', generatedAt: new Date('2026-06-30Z'),
    pdfRenderer: async () => Buffer.from('%PDF-test'),
  });
  assert.equal(built.manifest.signed, false);
  assert.equal(built.manifest.signature, null);
  assert.equal((await verifyAuditExportPackage(built.buffer)).valid, true);
  const withRequiredSignature = await verifyAuditExportPackage(built.buffer, 'required-key');
  assert.equal(withRequiredSignature.valid, false);
  assert.ok(withRequiredSignature.errors.includes('SIGNATURE_REQUIRED'));
});
