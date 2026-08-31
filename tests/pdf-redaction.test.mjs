import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractRuns, segmentRuns } from '../lib/pdf-inplace.js';
import { redactPdfSourceText } from '../lib/pdf-redaction-engine.js';
import { normalizePdfRedactionTerms, redactHtmlText } from '../lib/pdf-html-redaction.js';

test('HTML redaction removes terms while preserving unrelated content', () => {
  const result = redactHtmlText('<p>Visible SECRET text &amp; more.</p>', ['SECRET']);
  assert.doesNotMatch(result.html, /SECRET/i);
  assert.match(result.html, /Visible/);
  assert.match(result.html, /████/);
  assert.equal(result.applied, 1);
});

test('HTML redaction fails closed when a term spans markup', () => {
  assert.throws(
    () => redactHtmlText('<p>John <strong>Smith</strong></p>', ['John Smith']),
    /PDF_REDACTION_INCOMPLETE/,
  );
});

test('redaction term input is bounded', () => {
  assert.equal(normalizePdfRedactionTerms(['secret', 'SECRET']).value.length, 1);
  assert.equal(normalizePdfRedactionTerms(Array(51).fill('x')).error, 'TOO_MANY_REDACTION_TERMS');
});

test('content-stream redaction leaves no extractable source text', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('CONFIDENTIAL SOURCE', { x: 40, y: 120, size: 14, font });
  const original = Buffer.from(await doc.save({ useObjectStreams: false }));
  const extracted = await extractRuns(original);
  const segments = segmentRuns(extracted.runs, extracted.pages);
  const redacted = await redactPdfSourceText(original, segments);
  const after = await extractRuns(redacted.buffer);
  assert.doesNotMatch(after.runs.map((run) => run.str).join(' '), /CONFIDENTIAL SOURCE/);
  assert.equal(redacted.report.whiteOutUsed, false);
  assert.ok(redacted.report.removedTextOperators >= 1);
});
