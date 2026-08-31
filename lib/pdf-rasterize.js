import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

// EdenAI's chat/completions has no PDF content-block support that
// actually works against the hardcoded chat model (confirmed live,
// 2026-08-30 — see migrate-ocr-extraction-to-edenai/design.md), so a
// PDF given to performOcrEdenAi is rasterized to one PNG per page here
// and sent as multiple image_url blocks in a single chat message
// instead. poppler-utils (pdfinfo/pdftoppm) ships in the Docker image
// alongside ffmpeg/chromium for exactly this purpose.
const MAX_OCR_PDF_PAGES = Number.parseInt(process.env.MAX_OCR_PDF_PAGES, 10) || 20;
const OCR_RASTERIZE_DPI = Number.parseInt(process.env.OCR_RASTERIZE_DPI, 10) || 150;

async function countPdfPages(pdfPath) {
  const { stdout } = await execFileAsync('pdfinfo', [pdfPath]);
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  return match ? Number.parseInt(match[1], 10) : null;
}

// Returns one PNG buffer per page, in page order. Throws
// PDF_TOO_MANY_PAGES (before rendering anything) if the document
// exceeds MAX_OCR_PDF_PAGES, and PDF_RASTERIZE_FAILED if pdftoppm
// produces no output at all (corrupt/encrypted/unreadable PDF).
export async function rasterizePdfToImages(pdfPath) {
  const pageCount = await countPdfPages(pdfPath);
  if (pageCount && pageCount > MAX_OCR_PDF_PAGES) {
    throw Object.assign(
      new Error(`PDF hat zu viele Seiten für OCR (${pageCount}, max. ${MAX_OCR_PDF_PAGES}).`),
      { code: 'PDF_TOO_MANY_PAGES' },
    );
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ocr-rasterize-'));
  const outputPrefix = path.join(tmpDir, 'page');
  try {
    await execFileAsync('pdftoppm', ['-png', '-r', String(OCR_RASTERIZE_DPI), pdfPath, outputPrefix]);
    const files = (await readdir(tmpDir))
      .filter((name) => name.startsWith('page') && name.endsWith('.png'))
      .sort();
    if (files.length === 0) {
      throw Object.assign(new Error('PDF konnte nicht in Bilder umgewandelt werden.'), {
        code: 'PDF_RASTERIZE_FAILED',
      });
    }
    return await Promise.all(files.map((name) => readFile(path.join(tmpDir, name))));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
