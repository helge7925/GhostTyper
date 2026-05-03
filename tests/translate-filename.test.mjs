import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslatedFilename } from '../lib/translate-filename.js';

test('buildTranslatedFilename uses German label when UI is DE', () => {
  assert.equal(
    buildTranslatedFilename('Bericht.docx', '.docx', 'englisch'),
    'Bericht - englisch.docx',
  );
  assert.equal(
    buildTranslatedFilename('Bericht.docx', '.docx', 'deutsch'),
    'Bericht - deutsch.docx',
  );
});

test('buildTranslatedFilename uses English label when UI is EN', () => {
  assert.equal(
    buildTranslatedFilename('Report.xlsx', '.xlsx', 'english'),
    'Report - english.xlsx',
  );
  assert.equal(
    buildTranslatedFilename('Report.xlsx', '.xlsx', 'german'),
    'Report - german.xlsx',
  );
});

test('buildTranslatedFilename falls back to "translated" when no label given', () => {
  assert.equal(
    buildTranslatedFilename('Notes.pptx', '.pptx', ''),
    'Notes - translated.pptx',
  );
  assert.equal(
    buildTranslatedFilename('Notes.pptx', '.pptx', null),
    'Notes - translated.pptx',
  );
});

test('buildTranslatedFilename respects custom fallback', () => {
  assert.equal(
    buildTranslatedFilename('memo.pdf', '.pdf', '', 'übersetzt'),
    'memo - übersetzt.pdf',
  );
});

test('buildTranslatedFilename strips existing extension from filename', () => {
  assert.equal(
    buildTranslatedFilename('foo.bar.docx', '.docx', 'englisch'),
    'foo.bar - englisch.docx',
  );
});

test('buildTranslatedFilename preserves spaces and umlauts in original filename', () => {
  assert.equal(
    buildTranslatedFilename('Mein Brief Über Reisen.docx', '.docx', 'englisch'),
    'Mein Brief Über Reisen - englisch.docx',
  );
});

test('buildTranslatedFilename sanitizes illegal filesystem chars', () => {
  // Slash, backslash, colon, asterisk, question mark, double quote, lt/gt, pipe.
  const result = buildTranslatedFilename('a/b\\c:d*e?f"g<h>i|j.docx', '.docx', 'englisch');
  // Whatever the sanitizer produces, it must NOT contain any of those characters.
  assert.match(result, /^[^/\\:*?"<>|]+ - englisch\.docx$/);
});

test('buildTranslatedFilename sanitizes illegal chars in language label', () => {
  const result = buildTranslatedFilename('Bericht.docx', '.docx', 'eng/lisch');
  assert.equal(result, 'Bericht - eng_lisch.docx');
});

test('buildTranslatedFilename caps base length at 100 chars', () => {
  const longName = 'a'.repeat(150) + '.docx';
  const result = buildTranslatedFilename(longName, '.docx', 'englisch');
  // 100 chars base + " - englisch.docx" = 100 + 16 = 116
  assert.ok(result.length <= 120);
  assert.ok(result.endsWith(' - englisch.docx'));
  assert.ok(result.startsWith('a'.repeat(100)));
});

test('buildTranslatedFilename caps language label at 50 chars', () => {
  const longLabel = 'x'.repeat(80);
  const result = buildTranslatedFilename('doc.pdf', '.pdf', longLabel);
  // The label portion must be <= 50 chars.
  const labelInResult = result.replace(/^doc - /, '').replace(/\.pdf$/, '');
  assert.equal(labelInResult.length, 50);
});

test('buildTranslatedFilename falls back to "dokument" if filename is empty after sanitize', () => {
  assert.equal(
    buildTranslatedFilename('???.docx', '.docx', 'englisch'),
    'dokument - englisch.docx',
  );
  assert.equal(
    buildTranslatedFilename('', '.docx', 'englisch'),
    'dokument - englisch.docx',
  );
});

test('buildTranslatedFilename handles extension without leading dot', () => {
  assert.equal(
    buildTranslatedFilename('Bericht.docx', 'pdf', 'englisch'),
    'Bericht - englisch.pdf',
  );
});

test('buildTranslatedFilename handles missing extension', () => {
  assert.equal(
    buildTranslatedFilename('Bericht.docx', '', 'englisch'),
    'Bericht - englisch',
  );
});
