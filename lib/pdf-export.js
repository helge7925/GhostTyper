import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildPdfPrintStyles,
  normalizePdfFontPreset,
  normalizePdfTheme,
} from './pdf-print-style';

const DEFAULT_TIMEOUT_MS = 20_000;

function resolveChromiumPath() {
  if (process.env.PDF_CHROMIUM_PATH && existsSync(process.env.PDF_CHROMIUM_PATH)) {
    return process.env.PDF_CHROMIUM_PATH;
  }

  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  return found || candidates[0];
}

function sanitizePrintHtml(html) {
  if (!html) return '';

  // Strip executable script/style payloads from user content before rendering.
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
}

function sanitizeProfileText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePremiumProfile(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    project: sanitizeProfileText(source.project, 160),
    company: sanitizeProfileText(source.company, 160),
    name: sanitizeProfileText(source.name, 160),
    role: sanitizeProfileText(source.role, 160),
    contact: sanitizeProfileText(source.contact, 255),
    footer: sanitizeProfileText(source.footer, 255),
  };
}

function buildPremiumHeader({ title, profile }) {
  const resolvedTitle = sanitizeProfileText(title, 120) || 'Dokument';
  const project = profile.project || profile.company || '';
  const exportDate = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date());
  const noteLine = [profile.name, profile.role, profile.contact].filter(Boolean).join(' · ');
  const footer = profile.footer || '';

  return `
    <section id="pdf-premium-header">
      <div class="pdf-premium-main">
        <p class="pdf-premium-title">${escapeHtml(resolvedTitle)}</p>
        <p class="pdf-premium-date">${escapeHtml(exportDate)}</p>
      </div>
      ${project ? `<p class="pdf-premium-project">Projekt: ${escapeHtml(project)}</p>` : ''}
      ${noteLine ? `<p class="pdf-premium-note">${escapeHtml(noteLine)}</p>` : ''}
      ${footer ? `<p class="pdf-premium-footer">${escapeHtml(footer)}</p>` : ''}
    </section>
  `;
}

function createPrintDocument(rawHtml, options = {}) {
  const safeHtml = sanitizePrintHtml(rawHtml);
  const theme = normalizePdfTheme(options.theme);
  const fontPreset = normalizePdfFontPreset(options.fontPreset);
  const shouldRenderPremiumLayout = Boolean(options.premiumLayout);
  const premiumProfile = normalizePremiumProfile(options.premiumProfile);
  const premiumHeaderHtml = shouldRenderPremiumLayout
    ? buildPremiumHeader({
        title: options.documentTitle,
        profile: premiumProfile,
      })
    : '';
  const printStyles = buildPdfPrintStyles({ theme, fontPreset });

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${printStyles}</style>
  </head>
  <body>
    <main id="print-root">${premiumHeaderHtml}${safeHtml}</main>
  </body>
</html>`;
}

function runChromiumPdf(inputHtmlPath, outputPdfPath, timeoutMs) {
  const chromiumPath = resolveChromiumPath();

  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outputPdfPath}`,
      `file://${inputHtmlPath}`,
    ];

    const child = spawn(chromiumPath, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('PDF_RENDER_TIMEOUT'));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        const err = new Error('PDF_RENDERER_UNAVAILABLE');
        err.cause = error;
        reject(err);
        return;
      }
      reject(error);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`PDF_RENDER_FAILED:${code}`));
    });
  });
}

export async function renderPdfBufferFromHtml(rawHtml, options = {}) {
  const html = createPrintDocument(rawHtml, options);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

  const base = randomUUID();
  const htmlPath = path.join(os.tmpdir(), `${base}.html`);
  const pdfPath = path.join(os.tmpdir(), `${base}.pdf`);

  try {
    await writeFile(htmlPath, html, 'utf8');
    await runChromiumPdf(htmlPath, pdfPath, timeoutMs);
    return await readFile(pdfPath);
  } finally {
    await unlink(htmlPath).catch(() => {});
    await unlink(pdfPath).catch(() => {});
  }
}
