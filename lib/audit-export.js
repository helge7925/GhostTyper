import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import JSZip from 'jszip';
import { eventsToCsv } from './audit-csv.js';
import { verifyAuditChain } from './audit-chain.js';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      if (value[key] !== undefined) out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function auditEventsToHtml(events, organizationName) {
  const rows = events.map((event) => `<tr>
    <td>${escapeHtml(event.id)}</td><td>${escapeHtml(new Date(event.created_at).toISOString())}</td>
    <td>${escapeHtml(event.action)}</td><td>${escapeHtml(event.target_type)}</td>
    <td>${escapeHtml(event.target_id)}</td><td>${escapeHtml(event.severity || 'info')}</td>
    <td><code>${escapeHtml(JSON.stringify(event.metadata || {}))}</code></td>
  </tr>`).join('');
  return `<h1>Audit trail — ${escapeHtml(organizationName)}</h1>
    <p>Generated ${escapeHtml(new Date().toISOString())}</p>
    <table><thead><tr><th>ID</th><th>Timestamp</th><th>Action</th><th>Target type</th><th>Target ID</th><th>Severity</th><th>Metadata</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function unsignedManifest(manifest) {
  const { signature: _signature, ...body } = manifest;
  return body;
}

export function signManifest(manifest, signingKey) {
  if (!signingKey) return { ...manifest, signed: false, algorithm: null, signature: null };
  const body = { ...manifest, signed: true, algorithm: 'HMAC-SHA256' };
  const signature = createHmac('sha256', signingKey).update(stableJson(body)).digest('hex');
  return { ...body, signature };
}

export function verifyManifestSignature(manifest, signingKey) {
  if (!manifest?.signed) return { valid: false, reason: 'UNSIGNED' };
  if (!signingKey || manifest.algorithm !== 'HMAC-SHA256' || typeof manifest.signature !== 'string') {
    return { valid: false, reason: 'SIGNATURE_CONFIGURATION_INVALID' };
  }
  const expected = createHmac('sha256', signingKey)
    .update(stableJson(unsignedManifest(manifest)))
    .digest();
  let received;
  try {
    received = Buffer.from(manifest.signature, 'hex');
  } catch {
    return { valid: false, reason: 'SIGNATURE_INVALID' };
  }
  const valid = received.length === expected.length && timingSafeEqual(received, expected);
  return { valid, reason: valid ? null : 'SIGNATURE_INVALID' };
}

export async function buildAuditExportPackage({
  events,
  organization,
  range,
  signingKey = process.env.AUDIT_SIGNING_KEY,
  generatedAt = new Date(),
  pdfRenderer = null,
}) {
  const csv = eventsToCsv(events);
  const csvBuffer = Buffer.from(csv, 'utf8');
  const html = auditEventsToHtml(events, organization.name);
  if (csvBuffer.length > 8 * 1024 * 1024 || Buffer.byteLength(html, 'utf8') > 8 * 1024 * 1024) {
    throw new Error('AUDIT_EXPORT_TOO_LARGE');
  }
  const renderPdf = pdfRenderer || (await import('./pdf-export.js')).renderPdfBufferFromHtml;
  const pdf = await renderPdf(html, { timeoutMs: 30_000 });
  const pdfBuffer = Buffer.from(pdf);
  if (pdfBuffer.length > 20 * 1024 * 1024) throw new Error('AUDIT_EXPORT_TOO_LARGE');
  const firstPreviousHash = events[0]?.prev_hash || null;
  const headHash = events.at(-1)?.entry_hash || null;
  const chain = events.length
    ? verifyAuditChain(events, { initialPreviousHash: firstPreviousHash, expectedHeadHash: headHash })
    : { valid: true, errors: [], rows: 0, headHash: null };
  if (!chain.valid) throw new Error('AUDIT_CHAIN_INVALID');

  const manifest = signManifest({
    format_version: 1,
    generated_at: generatedAt.toISOString(),
    organization: { id: String(organization.id), name: organization.name },
    range: { since: range.since.toISOString(), until: range.until.toISOString() },
    row_count: events.length,
    first_id: events[0] ? String(events[0].id) : null,
    last_id: events.at(-1) ? String(events.at(-1).id) : null,
    range_start_prev_hash: firstPreviousHash,
    chain_head_hash: headHash,
    files: {
      'audit-trail.csv': { sha256: sha256(csvBuffer), bytes: csvBuffer.length },
      'audit-trail.pdf': { sha256: sha256(pdfBuffer), bytes: pdfBuffer.length },
    },
  }, signingKey);

  const zip = new JSZip();
  zip.file('audit-trail.csv', csvBuffer);
  zip.file('audit-trail.pdf', pdfBuffer);
  zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), manifest };
}

export async function verifyAuditExportPackage(buffer, signingKey) {
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) return { valid: false, errors: ['MANIFEST_MISSING'] };
  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.async('string'));
  } catch {
    return { valid: false, errors: ['MANIFEST_INVALID'] };
  }
  const errors = [];
  for (const [name, expected] of Object.entries(manifest.files || {})) {
    const file = zip.file(name);
    if (!file) {
      errors.push(`${name}:MISSING`);
      continue;
    }
    const content = await file.async('nodebuffer');
    if (sha256(content) !== expected.sha256 || content.length !== expected.bytes) errors.push(`${name}:DIGEST_MISMATCH`);
  }
  const signature = verifyManifestSignature(manifest, signingKey);
  if (signingKey && !manifest.signed) errors.push('SIGNATURE_REQUIRED');
  if (manifest.signed && !signature.valid) errors.push(signature.reason);
  return { valid: errors.length === 0, errors, manifest, signature };
}
