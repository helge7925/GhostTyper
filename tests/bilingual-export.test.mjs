import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BILINGUAL_EXPORT_LIMITS,
  alignBilingualText,
  buildBilingualHtml,
  normalizeBilingualExportInput,
} from '../lib/bilingual-export.js';

test('alignBilingualText aligns paragraphs and preserves unmatched rows', () => {
  assert.deepEqual(alignBilingualText('One\n\nTwo', 'Eins\n\nZwei\n\nDrei'), [
    { source: 'One', target: 'Eins' },
    { source: 'Two', target: 'Zwei' },
    { source: '', target: 'Drei' },
  ]);
});

test('buildBilingualHtml renders aligned columns and escapes markup', () => {
  const html = buildBilingualHtml({
    title: '<Review>',
    sourceLabel: 'Source & original',
    targetLabel: 'Target',
    pairs: [{ source: '<script>alert(1)</script>', target: 'A & B' }],
  });
  assert.match(html, /&lt;Review&gt;/);
  assert.match(html, /Source &amp; original/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<script>/);
});

test('normalizeBilingualExportInput enforces row and total-size bounds', () => {
  assert.match(
    normalizeBilingualExportInput({ pairs: Array(BILINGUAL_EXPORT_LIMITS.maxPairs + 1).fill({ source: 'a', target: 'b' }) }).error,
    /Too many/,
  );
  assert.match(
    normalizeBilingualExportInput({ pairs: [{ source: 'a'.repeat(BILINGUAL_EXPORT_LIMITS.maxFieldChars + 1), target: 'b' }] }).error,
    /too long/,
  );
});

test('normalizeBilingualExportInput accepts bounded HTML and PDF exports', () => {
  for (const format of ['html', 'pdf']) {
    const result = normalizeBilingualExportInput({
      pairs: [{ source: 'Hello', target: 'Hallo' }],
      format,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.value.format, format);
  }
});
