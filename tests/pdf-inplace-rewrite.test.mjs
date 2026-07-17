import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  extractRuns,
  segmentRuns,
  rewritePdf,
  isWinAnsiEncodable,
  findNonEncodableTranslations,
} from '../lib/pdf-inplace.js';

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

async function buildSingleColumnPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 740;
  for (const line of ['The quick brown fox jumps', 'over the lazy dog while the', 'sun sets behind the hills.']) {
    page.drawText(line, { x: 60, y, size: 12, font });
    y -= 16;
  }
  y -= 40;
  for (const line of ['A second paragraph follows', 'after a clear vertical gap.']) {
    page.drawText(line, { x: 60, y, size: 12, font });
    y -= 16;
  }
  return Buffer.from(await doc.save());
}

// A short single-line segment we can blow up with a much longer "translation".
async function buildShortLinePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Kurz', { x: 60, y: 740, size: 12, font });
  return Buffer.from(await doc.save());
}

async function reextractText(buffer) {
  const { runs } = await extractRuns(buffer);
  return runs.map((r) => r.str).join(' ');
}

// --- encodability helpers --------------------------------------------------

test('isWinAnsiEncodable accepts German latin text incl. umlauts and euro', () => {
  assert.equal(isWinAnsiEncodable('Grüße über Öl, 5 € — ok'), true);
});

test('isWinAnsiEncodable rejects CJK / cyrillic target text', () => {
  assert.equal(isWinAnsiEncodable('翻译文本'), false);
  assert.equal(isWinAnsiEncodable('Привет'), false);
});

test('findNonEncodableTranslations reports the offending indices', () => {
  const indices = findNonEncodableTranslations(['Hallo', '你好', 'Welt']);
  assert.deepEqual(indices, [1]);
});

// --- golden round-trip -----------------------------------------------------

test('rewritePdf identity round-trip keeps segments and re-extractable text', async () => {
  const buffer = await buildSingleColumnPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  const translations = segments.map((s) => s.text); // identity "translation"

  const { buffer: out, report } = await rewritePdf(buffer, segments, translations);
  assert.equal(report.mode, 'in-place');
  assert.equal(report.segments, segments.length);
  assert.equal(report.translated, segments.length);
  assert.equal(report.nonEncodable, 0);

  // Re-extract and re-segment the output: text present, segment count stable.
  const outExtraction = await extractRuns(out);
  const outSegments = segmentRuns(outExtraction.runs, outExtraction.pages);
  assert.equal(outSegments.length, segments.length, 'segment count stable after rewrite');
  const outText = await reextractText(out);
  assert.match(outText, /quick brown fox/);
  assert.match(outText, /second paragraph/);
});

test('rewritePdf translates each segment to a real target string', async () => {
  const buffer = await buildSingleColumnPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  // Replace with German of similar length so it fits without overflow.
  const translations = segments.map((_, i) => (i === 0
    ? 'Der flinke braune Fuchs springt ueber den Hund'
    : 'Ein zweiter Absatz folgt danach'));

  const { buffer: out, report } = await rewritePdf(buffer, segments, translations);
  assert.equal(report.translated, segments.length);
  const outText = await reextractText(out);
  assert.match(outText, /flinke braune Fuchs/);
  assert.match(outText, /zweiter Absatz/);
  // Note (design.md decision): white-out is a visual cover; the original text
  // objects remain in the stream underneath and still re-extract. Phase 2
  // strips them. This test asserts the translation was drawn, not removal.
});

// --- overflow strategy -----------------------------------------------------

test('rewritePdf counts an overflow when a long string cannot fit one short line', async () => {
  const buffer = await buildShortLinePdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  assert.equal(segments.length, 1);
  // Original "Kurz" (~24pt wide) vs. a very long single-line translation.
  const translations = ['Ein ausserordentlich langer uebersetzter Satz der niemals in die kurze Zeile passt'];

  const { report } = await rewritePdf(buffer, segments, translations);
  assert.equal(report.translated, 1);
  assert.equal(report.overflows, 1, 'the un-fittable single line is counted as an overflow');
});

test('rewritePdf skips and counts a non-encodable translation without losing the original', async () => {
  const buffer = await buildShortLinePdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  const { buffer: out, report } = await rewritePdf(buffer, segments, ['你好世界']);
  assert.equal(report.nonEncodable, 1);
  assert.equal(report.translated, 0);
  // Original text survives (not whited out) — no silent loss.
  const outText = await reextractText(out);
  assert.match(outText, /Kurz/);
});
