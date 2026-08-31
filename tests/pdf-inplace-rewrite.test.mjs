import test from 'node:test';
import assert from 'node:assert/strict';
import { degrees, PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts } from 'pdf-lib';
import {
  extractRuns,
  segmentRuns,
  rewritePdf,
} from '../lib/pdf-inplace.js';
import { PdfRedactionError, stripTextShowingOperators } from '../lib/pdf-redaction-engine.js';

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

async function buildImageVectorLinkPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  ));
  page.drawImage(png, { x: 50, y: 720, width: 160, height: 40 });
  page.drawRectangle({ x: 45, y: 715, width: 170, height: 50, borderWidth: 2 });
  page.drawText('Source above image and vector', { x: 60, y: 740, size: 12, font });
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [55, 735, 230, 755],
    Border: [0, 0, 0],
    A: { S: 'URI', URI: PDFString.of('https://example.invalid/source') },
  });
  page.node.addAnnot(doc.context.register(link));
  return Buffer.from(await doc.save());
}

async function buildRotatedCroppedTextPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.setRotation(degrees(90));
  page.setCropBox(20, 30, 520, 720);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Rotated source text', { x: 60, y: 700, size: 12, font });
  return Buffer.from(await doc.save());
}

async function buildTwoPageTextPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]).drawText('Extracted source on the translated first page', {
    x: 60, y: 740, size: 12, font,
  });
  doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]).drawText('Source text on an unsegmented second page', {
    x: 60, y: 740, size: 12, font,
  });
  return Buffer.from(await doc.save());
}

async function buildPdfWithAnnotationMetadata(key) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Ordinary source text for annotation metadata coverage', { x: 60, y: 740, size: 12, font });
  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [55, 735, 230, 755],
    [key]: PDFString.of('Source-bearing annotation text'),
  });
  page.node.addAnnot(doc.context.register(annotation));
  return Buffer.from(await doc.save());
}

async function buildPdfWithAcroForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Ordinary source text for AcroForm coverage', { x: 60, y: 740, size: 12, font });
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [] }));
  return Buffer.from(await doc.save());
}

async function buildPdfWithAccessibilityMetadata(key) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Ordinary source text for accessibility metadata coverage', { x: 60, y: 740, size: 12, font });
  const structureElement = doc.context.obj({
    Type: 'StructElem',
    S: 'P',
    [key]: PDFString.of('Source-bearing accessibility text'),
  });
  const structureRef = doc.context.register(structureElement);
  doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.obj({
    Type: 'StructTreeRoot',
    K: [structureRef],
  }));
  return Buffer.from(await doc.save());
}

async function buildPdfWithMarkedPropertyMetadata(key) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Ordinary source text for marked-property coverage', { x: 60, y: 740, size: 12, font });
  page.node.Resources().set(PDFName.of('Properties'), doc.context.obj({
    P1: {
      [key]: PDFString.of('Source-bearing named marked-content text'),
    },
  }));
  return Buffer.from(await doc.save());
}

async function buildPdfWithTextContentResource(kind) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Ordinary source text for content-resource coverage', { x: 60, y: 740, size: 12, font });
  const content = Buffer.from('BT /F1 12 Tf (Hidden resource source text) Tj ET');
  if (kind === 'pattern') {
    doc.context.register(doc.context.flateStream(content, {
      Type: 'Pattern',
      PatternType: 1,
      PaintType: 1,
      TilingType: 1,
      BBox: [0, 0, 100, 100],
      XStep: 100,
      YStep: 100,
      Resources: {},
    }));
  } else {
    const charProcRef = doc.context.register(doc.context.flateStream(content));
    doc.context.register(doc.context.obj({
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, 0, 1000, 1000],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: { A: charProcRef },
      Encoding: { Type: 'Encoding', Differences: [65, 'A'] },
      FirstChar: 65,
      LastChar: 65,
      Widths: [500],
      Resources: {},
    }));
  }
  return Buffer.from(await doc.save());
}

async function rewriteFixture(buffer) {
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  return rewritePdf(buffer, segments, segments.map(() => 'Translated fixture text'));
}

async function reextractText(buffer) {
  const { runs } = await extractRuns(buffer);
  return runs.map((r) => r.str).join(' ');
}

// --- physical redaction engine --------------------------------------------

test('content-stream redaction removes text-show operands but preserves vectors', () => {
  const source = Buffer.from('q 1 0 0 RG 10 10 50 20 re S BT /F1 12 Tf 60 740 Td (Secret source) Tj ET Q');
  const result = stripTextShowingOperators(source);
  const output = result.bytes.toString('latin1');
  assert.equal(result.removed, 1);
  assert.doesNotMatch(output, /Secret source|\bTj\b/);
  assert.match(output, /10 10 50 20 re S/);
  assert.match(output, /\bq\b[\s\S]*\bQ\b/);
});

test('content-stream redaction fails closed for text clipping and inline images', () => {
  assert.throws(
    () => stripTextShowingOperators(Buffer.from('BT 4 Tr (clip) Tj ET')),
    (error) => error instanceof PdfRedactionError && error.reason === 'text-clipping-unsupported',
  );
  assert.throws(
    () => stripTextShowingOperators(Buffer.from('BI /W 1 /H 1 ID x EI')),
    (error) => error instanceof PdfRedactionError && error.reason === 'inline-image-unsupported',
  );
});

test('content-stream redaction fails closed for source-bearing ActualText metadata', () => {
  assert.throws(
    () => stripTextShowingOperators(Buffer.from(
      '/Span << /ActualText (Secret source text) >> BDC BT /F1 12 Tf (encoded) Tj ET EMC',
    )),
    (error) => error instanceof PdfRedactionError
      && error.reason === 'source-bearing-marked-content-unsupported',
  );
  assert.throws(
    () => stripTextShowingOperators(Buffer.from(
      '/Span << /Actual#54ext (Escaped source text) >> BDC BT (encoded) Tj ET EMC',
    )),
    (error) => error instanceof PdfRedactionError
      && error.reason === 'source-bearing-marked-content-unsupported',
  );
  assert.throws(
    () => stripTextShowingOperators(Buffer.from(
      '/Span << /ActualText (Marked point source text) >> DP',
    )),
    (error) => error instanceof PdfRedactionError
      && error.reason === 'source-bearing-marked-content-unsupported',
  );
  for (const name of ['Alt', 'E', 'A#6Ct']) {
    assert.throws(
      () => stripTextShowingOperators(Buffer.from(
        `/Span << /${name} (Accessible source text) >> BDC BT (encoded) Tj ET EMC`,
      )),
      (error) => error instanceof PdfRedactionError
        && error.reason === 'source-bearing-marked-content-unsupported',
    );
  }
});

test('rewritePdf rejects source-bearing annotation metadata without confusing page Contents', async () => {
  for (const key of ['Contents', 'RC', 'V', 'DV', 'TU', 'T', 'Subj']) {
    const buffer = await buildPdfWithAnnotationMetadata(key);
    await assert.rejects(
      rewriteFixture(buffer),
      (error) => error instanceof PdfRedactionError
        && error.reason === 'source-bearing-annotation-metadata-unsupported',
      `annotation key ${key} must fail closed`,
    );
  }
});

test('rewritePdf rejects AcroForms and structure-tree Alt/E accessibility metadata', async () => {
  await assert.rejects(
    rewriteFixture(await buildPdfWithAcroForm()),
    (error) => error instanceof PdfRedactionError
      && error.reason === 'source-bearing-form-metadata-unsupported',
  );
  for (const key of ['Alt', 'E']) {
    await assert.rejects(
      rewriteFixture(await buildPdfWithAccessibilityMetadata(key)),
      (error) => error instanceof PdfRedactionError
        && error.reason === 'source-bearing-marked-content-unsupported',
    );
  }
});

test('rewritePdf rejects Alt/E in named marked-content property resources', async () => {
  for (const key of ['Alt', 'E']) {
    await assert.rejects(
      rewriteFixture(await buildPdfWithMarkedPropertyMetadata(key)),
      (error) => error instanceof PdfRedactionError
        && error.reason === 'source-bearing-marked-content-unsupported',
    );
  }
});

test('rewritePdf fails closed for text-bearing tiling patterns and Type3 CharProcs', async () => {
  for (const kind of ['pattern', 'type3']) {
    await assert.rejects(
      rewriteFixture(await buildPdfWithTextContentResource(kind)),
      (error) => error instanceof PdfRedactionError
        && error.reason === 'source-text-resource-stream-unsupported',
      `${kind} text resource must fail closed`,
    );
  }
});

test('rewritePdf fails closed when an unsegmented page contains text operators', async () => {
  const buffer = await buildTwoPageTextPdf();
  const extraction = await extractRuns(buffer);
  const firstPageSegments = segmentRuns(
    extraction.runs.filter((run) => run.page === 1),
    extraction.pages,
  );
  await assert.rejects(
    rewritePdf(buffer, firstPageSegments, firstPageSegments.map(() => 'Translated first page text')),
    (error) => error instanceof PdfRedactionError && error.reason === 'unsegmented-page-text',
  );
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
  assert.equal(report.redaction.whiteOutUsed, false);
  assert.ok(report.redaction.removedTextOperators >= segments.length);
  assert.equal(report.sourceTextVerification.verified, true);

  // Re-extract the output. Noto metrics may change pdfjs paragraph clustering,
  // but the complete text and reading order remain independently verifiable.
  const outText = await reextractText(out);
  assert.match(outText, /quick brown fox/);
  assert.match(outText, /second paragraph/);
  assert.ok(outText.indexOf('quick brown fox') < outText.indexOf('second paragraph'));
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
  assert.doesNotMatch(outText, /quick brown fox/);
  assert.doesNotMatch(outText, /second paragraph follows/);
  assert.equal(report.sourceTextVerification.verified, true);
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

test('rewritePdf fails closed before returning a PDF for an unsupported glyph', async () => {
  const buffer = await buildShortLinePdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  await assert.rejects(
    rewritePdf(buffer, segments, ['\u{10FFFF}']),
    (error) => error.code === 'PDF_FONT_COVERAGE' && error.missingGlyphs[0].codePoint === 'U+10FFFF',
  );
});

test('embedded Noto fonts cover Latin, Cyrillic, Arabic, Simplified Chinese, and Traditional Chinese', async () => {
  const fixtures = [
    { language: 'English', text: 'Verified translated equipment text', family: 'Noto Sans' },
    { language: 'German', text: 'Geprüfte Übersetzung für Öl und Grüße', family: 'Noto Sans' },
    { language: 'Russian', text: 'Проверенный перевод оборудования', family: 'Noto Sans' },
    { language: 'Arabic', text: 'تم التحقق من ترجمة المعدات', family: 'Noto Sans Arabic' },
    { language: 'zh-CN', text: '设备翻译文本已经验证', family: 'Noto Sans SC' },
    { language: 'zh-TW', text: '設備翻譯文字已經驗證', family: 'Noto Sans TC' },
  ];
  for (const fixture of fixtures) {
    const buffer = await buildShortLinePdf();
    const extraction = await extractRuns(buffer);
    const segments = segmentRuns(extraction.runs, extraction.pages);
    const { buffer: out, report } = await rewritePdf(buffer, segments, [fixture.text], {
      targetLanguage: fixture.language,
    });
    const output = (await reextractText(out)).replace(/[\s\p{Cc}\p{Cf}]+/gu, '');
    assert.match(output, new RegExp(fixture.text.replace(/\s+/g, '')));
    assert.ok(report.embeddedFonts.some((font) => font.family === fixture.family));
    assert.equal(report.missingGlyphs.length, 0);
    assert.equal(report.sourceTextVerification.verified, true);
  }
});

test('rewritePdf preserves image/vector resources and removes stale overlapping links', async () => {
  const buffer = await buildImageVectorLinkPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  const { buffer: out, report } = await rewritePdf(buffer, segments, ['Translated above image and vector'], {
    targetLanguage: 'English',
  });
  const outputDoc = await PDFDocument.load(out);
  const imageObjects = outputDoc.context.enumerateIndirectObjects().filter(([, object]) => {
    if (!(object instanceof PDFRawStream)) return false;
    const subtype = object.dict.get(PDFName.of('Subtype'));
    return subtype instanceof PDFName && subtype.asString() === '/Image';
  });
  assert.ok(imageObjects.length >= 1, 'underlying image object remains in output');
  assert.equal(report.redaction.removedLinks, 1);
  assert.equal(outputDoc.getPages()[0].node.Annots()?.size() || 0, 0);
  const text = await reextractText(out);
  assert.doesNotMatch(text, /Source above image/);
  assert.match(text, /Translated above image/);
});

test('rewritePdf removes and replaces source text on a rotated cropped page', async () => {
  const buffer = await buildRotatedCroppedTextPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  const { buffer: out, report } = await rewritePdf(buffer, segments, ['Gedrehter Zieltext'], {
    targetLanguage: 'German',
  });
  const text = await reextractText(out);
  assert.doesNotMatch(text, /Rotated source text/);
  assert.match(text, /Gedrehter Zieltext/);
  assert.equal(report.redaction.geometryConfidence, 'exact-page-user-space');
  assert.deepEqual(report.pageGeometry[0].cropBox, { x: 20, y: 30, width: 520, height: 720 });
  assert.equal(report.pageGeometry[0].rotation, 90);
  assert.equal(report.sourceTextVerification.verified, true);
});

// --- Technical datasheet regression fixture -------------------------------
//
// GxP-motivated regression: a table-heavy two-column datasheet carries a
// model number ("RX-500") protected as do-not-translate. The full chain
// (glossary masking -> fake translation -> placeholder restore -> in-place
// rewrite) must deliver the term verbatim in the re-extracted output PDF.

async function buildTechnicalDatasheetPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Left column: parameter labels; right column: values (table-like layout).
  const rows = [
    ['Modell', 'RX-500'],
    ['Durchsatz', '500 kg pro Stunde'],
    ['Spannung', '400 Volt Drehstrom'],
  ];
  let y = 740;
  for (const [label, value] of rows) {
    page.drawText(label, { x: 60, y, size: 12, font });
    page.drawText(value, { x: 320, y, size: 12, font });
    y -= 18;
  }
  y -= 40;
  page.drawText('Das Modell RX-500 erreicht den maximalen Durchsatz', { x: 60, y, size: 12, font });
  page.drawText('nur mit dem originalen Granulator-Einsatz.', { x: 60, y: y - 16, size: 12, font });
  return Buffer.from(await doc.save());
}

test('technical datasheet: do-not-translate model number survives the full in-place chain', async () => {
  const { translateSegmentsWithGlossaryGuard } = await import('../lib/translation-glossary.js');

  const buffer = await buildTechnicalDatasheetPdf();
  const extraction = await extractRuns(buffer);
  const segments = segmentRuns(extraction.runs, extraction.pages);
  assert.ok(segments.length >= 2, 'two-column fixture yields multiple segments');

  const glossary = { entries: [], doNotTranslate: ['RX-500'], personalTerms: [] };
  const guard = await translateSegmentsWithGlossaryGuard({
    texts: segments.map((s) => s.text),
    glossary,
    // Fake translator: "translates" surrounding words but must leave the
    // DNTX...XTDN placeholder untouched, like a well-behaved model would.
    translateSegments: async (maskedSegments) => ({
      translations: maskedSegments.map((s) => s
        .replace(/Modell/g, 'Model')
        .replace(/Durchsatz/g, 'throughput')
        .replace(/Spannung/g, 'voltage')),
      usage: {},
      model: 'fake-translator',
    }),
  });

  // The restored translations must already carry the verbatim term ...
  const joined = guard.translations.join(' ');
  assert.match(joined, /RX-500/);
  assert.doesNotMatch(joined, /DNTX/);

  // ... and so must the re-extracted text of the rewritten PDF.
  const { buffer: out, report } = await rewritePdf(buffer, segments, guard.translations);
  assert.equal(report.nonEncodable, 0);
  const outText = await reextractText(out);
  assert.match(outText, /RX-500/);
  assert.match(outText, /Model/);
});
