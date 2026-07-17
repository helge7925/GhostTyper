import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  detectTextLayer,
  extractRuns,
  segmentRuns,
} from '../lib/pdf-inplace.js';

// --- fixture builders (no binary PDFs in the repo) -------------------------

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

// Draw a block of lines starting at (x, topY), stepping down by `leading`.
// Returns the y of the next free line so callers can stack blocks.
async function drawLines(page, font, { x, topY, size, leading, lines }) {
  let y = topY;
  for (const text of lines) {
    page.drawText(text, { x, y, size, font });
    y -= leading;
  }
  return y;
}

async function buildSingleColumnPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Paragraph 1: three tightly-spaced lines.
  let y = await drawLines(page, font, {
    x: 60, topY: 740, size: 12, leading: 16,
    lines: ['The quick brown fox jumps', 'over the lazy dog while the', 'sun sets behind the hills.'],
  });
  // A large paragraph gap → new segment.
  y -= 40;
  await drawLines(page, font, {
    x: 60, topY: y, size: 12, leading: 16,
    lines: ['A second paragraph follows', 'after a clear vertical gap.'],
  });
  return Buffer.from(await doc.save());
}

async function buildTwoColumnPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Left column at x=50, right column at x=340 — a wide gutter in between.
  await drawLines(page, font, {
    x: 50, topY: 740, size: 11, leading: 15,
    lines: ['Left column line one', 'left column line two', 'left column line three'],
  });
  await drawLines(page, font, {
    x: 340, topY: 740, size: 11, leading: 15,
    lines: ['Right column line one', 'right column line two', 'right column line three'],
  });
  return Buffer.from(await doc.save());
}

async function buildMixedFontSizePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Heading (size 22) then body (size 11) — font-size change → separate segments.
  page.drawText('Document Heading', { x: 60, y: 740, size: 22, font });
  await drawLines(page, font, {
    x: 60, topY: 700, size: 11, leading: 15,
    lines: ['Body text line one of the section', 'body text line two of the section'],
  });
  return Buffer.from(await doc.save());
}

async function buildBlankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return Buffer.from(await doc.save());
}

// --- detectTextLayer -------------------------------------------------------

test('detectTextLayer flags a text-bearing PDF as digital', async () => {
  const buffer = await buildSingleColumnPdf();
  const result = await detectTextLayer(buffer);
  assert.equal(result.digital, true);
  assert.equal(result.pages, 1);
  assert.ok(result.totalChars > 40, `expected chars, got ${result.totalChars}`);
});

test('detectTextLayer flags a blank (no-text) PDF as non-digital', async () => {
  const buffer = await buildBlankPdf();
  const result = await detectTextLayer(buffer);
  assert.equal(result.digital, false);
  assert.equal(result.reason, 'no-meaningful-text-layer');
});

test('detectTextLayer returns non-digital on unparseable input', async () => {
  const result = await detectTextLayer(Buffer.from('not a pdf at all'));
  assert.equal(result.digital, false);
  assert.match(result.reason, /pdf-parse-failed/);
});

// --- extractRuns -----------------------------------------------------------

test('extractRuns returns positioned runs with sane geometry', async () => {
  const buffer = await buildSingleColumnPdf();
  const { pageCount, pages, runs } = await extractRuns(buffer);
  assert.equal(pageCount, 1);
  assert.equal(pages[0].width, PAGE_WIDTH);
  assert.equal(pages[0].height, PAGE_HEIGHT);
  assert.ok(runs.length >= 5, `expected >=5 runs, got ${runs.length}`);
  for (const run of runs) {
    assert.ok(run.width > 0, 'run has positive width');
    assert.ok(run.fontSize > 0, 'run has positive font size');
    assert.ok(run.top > run.bottom, 'glyph box top above bottom');
    assert.ok(run.x >= 0 && run.right <= PAGE_WIDTH + 1, 'run within page width');
  }
});

// --- segmentRuns -----------------------------------------------------------

test('segmentRuns groups single-column text into two paragraphs', async () => {
  const buffer = await buildSingleColumnPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  assert.equal(segments.length, 2, `expected 2 segments, got ${segments.length}`);
  assert.match(segments[0].text, /quick brown fox/);
  assert.match(segments[1].text, /second paragraph/);
  // Reading order: first segment sits above the second.
  assert.ok(segments[0].bbox.y0 > segments[1].bbox.y1, 'first paragraph above second');
  // bbox sanity.
  for (const segment of segments) {
    assert.ok(segment.bbox.x1 > segment.bbox.x0, 'bbox width positive');
    assert.ok(segment.bbox.y1 > segment.bbox.y0, 'bbox height positive');
  }
});

test('segmentRuns keeps a run→segment map covering every run', async () => {
  const buffer = await buildSingleColumnPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  const mappedRuns = segments.reduce((sum, s) => sum + s.runs.length, 0);
  assert.equal(mappedRuns, extraction.runs.length, 'no run lost during segmentation');
});

test('segmentRuns orders two columns left-block then right-block', async () => {
  const buffer = await buildTwoColumnPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  // Each column is one contiguous paragraph → 2 segments in reading order.
  assert.equal(segments.length, 2, `expected 2 column segments, got ${segments.length}`);
  assert.match(segments[0].text, /Left column/);
  assert.match(segments[1].text, /Right column/);
  assert.ok(segments[0].column === 0 && segments[1].column === 1, 'columns indexed L→R');
});

test('segmentRuns splits a heading from body on font-size change', async () => {
  const buffer = await buildMixedFontSizePdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  assert.equal(segments.length, 2, `expected heading + body, got ${segments.length}`);
  assert.match(segments[0].text, /Document Heading/);
  assert.ok(segments[0].fontSize > segments[1].fontSize, 'heading larger than body');
});
