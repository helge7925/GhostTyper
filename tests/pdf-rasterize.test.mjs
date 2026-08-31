import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { rasterizePdfToImages } from '../lib/pdf-rasterize.js';

const execFileAsync = promisify(execFile);

// poppler-utils (pdfinfo/pdftoppm) ships in the Docker image (see
// Dockerfile) alongside ffmpeg/chromium, but isn't guaranteed on every
// machine that runs `npm test` — skip rather than fail hard if it's
// genuinely missing here, matching how estimateAudioDurationSeconds
// (lib/ai-service.js) treats a missing ffprobe as a soft-fallback
// condition, not a hard requirement.
let popplerAvailable = true;
try {
  await execFileAsync('pdfinfo', ['-v']);
} catch {
  popplerAvailable = false;
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

test('rasterizePdfToImages returns one PNG buffer per page, in order', { skip: !popplerAvailable }, async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-rasterize-test-'));
  try {
    const pdfPath = path.join(tmpDir, 'multi.pdf');
    await writeFile(pdfPath, await makePdf(['Seite eins', 'Seite zwei', 'Seite drei']));

    const images = await rasterizePdfToImages(pdfPath);
    assert.equal(images.length, 3);
    for (const buf of images) {
      assert.ok(Buffer.isBuffer(buf));
      // PNG magic bytes.
      assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('rasterizePdfToImages handles a single-page PDF (no numbering ambiguity)', { skip: !popplerAvailable }, async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-rasterize-test-'));
  try {
    const pdfPath = path.join(tmpDir, 'single.pdf');
    await writeFile(pdfPath, await makePdf(['Nur eine Seite']));

    const images = await rasterizePdfToImages(pdfPath);
    assert.equal(images.length, 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('rasterizePdfToImages throws PDF_TOO_MANY_PAGES before rendering when the default page cap (20) is exceeded', { skip: !popplerAvailable }, async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-rasterize-test-'));
  try {
    const pdfPath = path.join(tmpDir, 'toomany.pdf');
    await writeFile(pdfPath, await makePdf(Array.from({ length: 21 }, (_, i) => `Seite ${i + 1}`)));

    await assert.rejects(
      rasterizePdfToImages(pdfPath),
      (error) => {
        assert.equal(error.code, 'PDF_TOO_MANY_PAGES');
        assert.match(error.message, /21/);
        assert.match(error.message, /max\. 20/);
        return true;
      },
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
