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
