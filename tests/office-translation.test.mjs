import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  detectOfficeMimeTypeFromBuffer,
} from '../lib/file-signature.js';
import {
  inspectOfficeDocumentBuffer,
  translateOfficeDocumentBuffer,
} from '../lib/office-translation.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

async function makeZip(entries) {
  const zip = new JSZip();
  Object.entries(entries).forEach(([name, content]) => zip.file(name, content));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('detectOfficeMimeTypeFromBuffer detects DOCX by content types', async () => {
  const buffer = await makeZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': '<w:document><w:t>Hello</w:t></w:document>',
  });

  assert.equal(await detectOfficeMimeTypeFromBuffer(buffer), DOCX_MIME);
});

test('translateOfficeDocumentBuffer translates DOCX text nodes and keeps XML structure', async () => {
  const buffer = await makeZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': '<w:document><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>World</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>',
    'word/header1.xml': '<w:hdr><w:t>Header</w:t></w:hdr>',
  });

  const inspection = await inspectOfficeDocumentBuffer(buffer, DOCX_MIME);
  assert.equal(inspection.segmentCount, 3);

  const result = await translateOfficeDocumentBuffer(buffer, DOCX_MIME, {
    translator: async (segments) => segments.map((segment) => `DE:${segment}`),
  });
  const zip = await JSZip.loadAsync(result.buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const headerXml = await zip.file('word/header1.xml').async('string');

  assert.match(documentXml, /<w:t>DE:Hello<\/w:t>/);
  assert.match(documentXml, /<w:t>DE:World<\/w:t>/);
  assert.match(headerXml, /<w:t>DE:Header<\/w:t>/);
});

test('translateOfficeDocumentBuffer translates XLSX strings without changing formulas', async () => {
  const buffer = await makeZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/sharedStrings.xml': '<sst><si><t>Product</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="inlineStr"><is><t>Comment</t></is></c><c><f>A1+B1</f><v>2</v></c></row></sheetData></worksheet>',
  });

  assert.equal(await detectOfficeMimeTypeFromBuffer(buffer), XLSX_MIME);
  const result = await translateOfficeDocumentBuffer(buffer, XLSX_MIME, {
    translator: async (segments) => segments.map((segment) => `DE:${segment}`),
  });
  const zip = await JSZip.loadAsync(result.buffer);
  const sharedStrings = await zip.file('xl/sharedStrings.xml').async('string');
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');

  assert.match(sharedStrings, /<t>DE:Product<\/t>/);
  assert.match(sheet, /<t>DE:Comment<\/t>/);
  assert.match(sheet, /<f>A1\+B1<\/f>/);
  assert.match(sheet, /<v>2<\/v>/);
});

test('translateOfficeDocumentBuffer translates visible PPTX slide text', async () => {
  const buffer = await makeZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    'ppt/slides/slide1.xml': '<p:sld><p:cSld><p:spTree><a:t>Title</a:t><a:t>Subtitle</a:t></p:spTree></p:cSld></p:sld>',
  });

  assert.equal(await detectOfficeMimeTypeFromBuffer(buffer), PPTX_MIME);
  const result = await translateOfficeDocumentBuffer(buffer, PPTX_MIME, {
    translator: async (segments) => segments.map((segment) => `DE:${segment}`),
  });
  const zip = await JSZip.loadAsync(result.buffer);
  const slide = await zip.file('ppt/slides/slide1.xml').async('string');

  assert.match(slide, /<a:t>DE:Title<\/a:t>/);
  assert.match(slide, /<a:t>DE:Subtitle<\/a:t>/);
});

// A .docx is a ZIP archive, so the 500 MB upload limit says nothing about how
// far its XML parts expand in memory. These cover the caps that bound the
// inflated side — see MAX_OFFICE_XML_ENTRY_BYTES in lib/constants.js. The
// fixtures stay tiny by tightening the caps per call instead of building an
// actual 64 MB bomb.
async function makeCompressedZip(entries) {
  const zip = new JSZip();
  Object.entries(entries).forEach(([name, content]) => zip.file(name, content));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('inspectOfficeDocumentBuffer refuses an entry that expands past the cap', async () => {
  // ~200 KB of repetitive XML compresses to a few hundred bytes — the same
  // ~950:1 ratio a decompression bomb relies on, just scaled down.
  const padding = 'A'.repeat(200_000);
  const buffer = await makeCompressedZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${padding}</w:t></w:r></w:p></w:body></w:document>`,
  });

  assert.ok(buffer.length < 10_000, `fixture should stay small, was ${buffer.length} bytes`);

  await assert.rejects(
    () => inspectOfficeDocumentBuffer(buffer, DOCX_MIME, { maxEntryBytes: 50_000 }),
    (error) => {
      assert.equal(error.code, 'OFFICE_ARCHIVE_TOO_LARGE');
      assert.match(error.message, /word\/document\.xml/);
      return true;
    },
  );
});

test('translateOfficeDocumentBuffer refuses a bomb before calling the translator', async () => {
  const padding = 'A'.repeat(200_000);
  const buffer = await makeCompressedZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${padding}</w:t></w:r></w:p></w:body></w:document>`,
  });

  let translatorCalls = 0;
  await assert.rejects(
    () => translateOfficeDocumentBuffer(buffer, DOCX_MIME, {
      maxEntryBytes: 50_000,
      translator: async (segments) => {
        translatorCalls += 1;
        return segments;
      },
    }),
    (error) => error.code === 'OFFICE_ARCHIVE_TOO_LARGE',
  );

  // The guard has to bite before any provider spend happens.
  assert.equal(translatorCalls, 0);
});

test('collected entries are capped in total, not just individually', async () => {
  const padding = 'B'.repeat(60_000);
  const part = (tag) => `<w:document><w:body><w:p><w:r><w:t>${tag}${padding}</w:t></w:r></w:p></w:body></w:document>`;
  const buffer = await makeCompressedZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': part('a'),
    'word/header1.xml': part('b'),
    'word/footer1.xml': part('c'),
  });

  // Each part is under the per-entry cap; only their sum crosses the total.
  await assert.rejects(
    () => inspectOfficeDocumentBuffer(buffer, DOCX_MIME, {
      maxEntryBytes: 100_000,
      maxTotalBytes: 150_000,
    }),
    (error) => {
      assert.equal(error.code, 'OFFICE_ARCHIVE_TOO_LARGE');
      assert.match(error.message, /Dokument ist entpackt zu groß/);
      return true;
    },
  );
});

test('a normal document still passes with the production caps', async () => {
  const buffer = await makeCompressedZip({
    '[Content_Types].xml': '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>',
  });

  const inspection = await inspectOfficeDocumentBuffer(buffer, DOCX_MIME);
  assert.equal(inspection.segmentCount, 1);
  assert.equal(inspection.text, 'Hello');
});
