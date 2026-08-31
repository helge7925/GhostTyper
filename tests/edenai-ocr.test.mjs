import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// lib/edenai-service.js imports lib/ai-service.js (for
// transcribeAudioEdenAi's shared chunking helper), which transitively
// reaches lib/db.js via api-utils.js -> rate-limit.js -> db.js — same
// DATABASE_URL-guard + dynamic-import pattern as
// tests/edenai-pricing-gate.test.mjs and tests/settings-service.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';
const { performOcrEdenAi } = await import('../lib/edenai-service.js');
const { EDENAI_BASE_URL } = await import('../lib/edenai.js');

const execFileAsync = promisify(execFile);
let popplerAvailable = true;
try {
  await execFileAsync('pdfinfo', ['-v']);
} catch {
  popplerAvailable = false;
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// A 1x1 PNG is enough — performOcrEdenAi never decodes the image itself,
// it just base64-encodes the file and puts it in an image_url block.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function makeTempFile(name, buffer) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'edenai-ocr-test-'));
  const filePath = path.join(tmpDir, name);
  await writeFile(filePath, buffer);
  return { filePath, tmpDir };
}

async function makePdf(pageTexts) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage([300, 200]);
    page.drawText(text, { x: 20, y: 150, size: 18, font, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await doc.save());
}

test('performOcrEdenAi sends a single image_url block for an image file', async () => {
  const { filePath, tmpDir } = await makeTempFile('page.png', TINY_PNG);
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return response({ choices: [{ message: { content: '# Extracted' } }] });
  };
  try {
    const result = await performOcrEdenAi(filePath, 'k', 'image/png', { model: 'mistral/mistral-small-latest' });
    assert.equal(captured.url, `${EDENAI_BASE_URL}/chat/completions`);
    assert.equal(captured.body.model, 'mistral/mistral-small-latest');
    const content = captured.body.messages[0].content;
    assert.equal(content.length, 2);
    assert.equal(content[0].type, 'text');
    assert.match(content[0].text, /Extract every visible word/);
    assert.equal(content[1].type, 'image_url');
    assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
    assert.equal(result.markdown, '# Extracted');
  } finally {
    global.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('performOcrEdenAi returns {markdown, usage, model, providerRequestId} matching performOCR\'s contract', async () => {
  const { filePath, tmpDir } = await makeTempFile('page.png', TINY_PNG);
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    choices: [{ message: { content: '# Rechnung\n\n| A | B |\n|---|---|\n| 1 | 2 |' } }],
    usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 },
    id: 'chatcmpl-ocr1',
    model: 'mistral-small-latest',
  });
  try {
    const result = await performOcrEdenAi(filePath, 'k', 'image/png', { model: 'mistral/mistral-small-latest' });
    assert.deepEqual(result, {
      markdown: '# Rechnung\n\n| A | B |\n|---|---|\n| 1 | 2 |',
      usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 },
      model: 'mistral-small-latest',
      providerRequestId: 'chatcmpl-ocr1',
    });
  } finally {
    global.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('performOcrEdenAi throws MODEL_UNAVAILABLE when no model is given', async () => {
  const { filePath, tmpDir } = await makeTempFile('page.png', TINY_PNG);
  try {
    await assert.rejects(
      performOcrEdenAi(filePath, 'k', 'image/png', {}),
      (error) => error.code === 'MODEL_UNAVAILABLE',
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('performOcrEdenAi rasterizes a multi-page PDF into multiple image_url blocks in one message, using the multi-page prompt', { skip: !popplerAvailable }, async () => {
  const pdfBuffer = await makePdf(['Seite eins', 'Seite zwei']);
  const { filePath, tmpDir } = await makeTempFile('doc.pdf', pdfBuffer);
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = JSON.parse(options.body);
    return response({ choices: [{ message: { content: '# Doc' } }] });
  };
  try {
    await performOcrEdenAi(filePath, 'k', 'application/pdf', { model: 'mistral/mistral-small-latest' });
    const content = captured.messages[0].content;
    // 1 text block + 2 image blocks (one per page).
    assert.equal(content.length, 3);
    assert.equal(content[0].type, 'text');
    assert.match(content[0].text, /consecutive pages of one document/);
    assert.equal(content[1].type, 'image_url');
    assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
    assert.equal(content[2].type, 'image_url');
    assert.match(content[2].image_url.url, /^data:image\/png;base64,/);
  } finally {
    global.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('performOcrEdenAi uses the single-page prompt for a one-page PDF', { skip: !popplerAvailable }, async () => {
  const pdfBuffer = await makePdf(['Nur eine Seite']);
  const { filePath, tmpDir } = await makeTempFile('doc.pdf', pdfBuffer);
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = JSON.parse(options.body);
    return response({ choices: [{ message: { content: '# Doc' } }] });
  };
  try {
    await performOcrEdenAi(filePath, 'k', 'application/pdf', { model: 'mistral/mistral-small-latest' });
    const content = captured.messages[0].content;
    assert.equal(content.length, 2);
    assert.doesNotMatch(content[0].text, /consecutive pages/);
  } finally {
    global.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('performOcrEdenAi propagates PDF_TOO_MANY_PAGES for an oversized PDF', { skip: !popplerAvailable }, async () => {
  const pdfBuffer = await makePdf(Array.from({ length: 21 }, (_, i) => `Seite ${i + 1}`));
  const { filePath, tmpDir } = await makeTempFile('doc.pdf', pdfBuffer);
  try {
    await assert.rejects(
      performOcrEdenAi(filePath, 'k', 'application/pdf', { model: 'mistral/mistral-small-latest' }),
      (error) => error.code === 'PDF_TOO_MANY_PAGES',
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
