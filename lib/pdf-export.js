import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_THEME = 'atelier';
const DEFAULT_FONT_PRESET = 'google-sans';

const THEME_TOKENS = {
  atelier: {
    text: '#1f2a37',
    muted: '#5b6573',
    heading: '#16202d',
    accent: '#d66136',
    border: 'rgba(22, 32, 45, 0.12)',
    blockBg: '#f5f3ef',
  },
  ghosttyper: {
    text: '#1b1f2a',
    muted: '#4b5565',
    heading: '#111827',
    accent: '#ff5917',
    border: 'rgba(17, 24, 39, 0.12)',
    blockBg: '#f8fafc',
  },
  minimal: {
    text: '#111827',
    muted: '#4b5563',
    heading: '#0f172a',
    accent: '#0f172a',
    border: 'rgba(15, 23, 42, 0.16)',
    blockBg: '#f8fafc',
  },
};

const FONT_PRESETS = {
  'google-sans': '"Inter", "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  'google-serif': '"Merriweather", "Source Serif 4", Georgia, "Times New Roman", serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  humanist: '"Avenir Next", "Helvetica Neue", "Segoe UI", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif',
};

const FONT_IMPORTS = {
  'google-sans': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&display=swap',
  'google-serif': 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
};

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

function normalizeTheme(theme) {
  return Object.prototype.hasOwnProperty.call(THEME_TOKENS, theme) ? theme : DEFAULT_THEME;
}

function normalizeFontPreset(fontPreset) {
  return Object.prototype.hasOwnProperty.call(FONT_PRESETS, fontPreset)
    ? fontPreset
    : DEFAULT_FONT_PRESET;
}

function createPrintDocument(rawHtml, options = {}) {
  const safeHtml = sanitizePrintHtml(rawHtml);
  const theme = normalizeTheme(options.theme);
  const fontPreset = normalizeFontPreset(options.fontPreset);
  const shouldRenderPremiumLayout = Boolean(options.premiumLayout);
  const premiumProfile = normalizePremiumProfile(options.premiumProfile);
  const premiumHeaderHtml = shouldRenderPremiumLayout
    ? buildPremiumHeader({
        title: options.documentTitle,
        profile: premiumProfile,
      })
    : '';
  const tokens = THEME_TOKENS[theme];
  const fontFamily = FONT_PRESETS[fontPreset];
  const fontImport = FONT_IMPORTS[fontPreset] ? `@import url('${FONT_IMPORTS[fontPreset]}');` : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      ${fontImport}
      @page { size: A4 portrait; margin: 18mm 16mm 20mm 16mm; }
      :root {
        --pdf-text: ${tokens.text};
        --pdf-muted: ${tokens.muted};
        --pdf-heading: ${tokens.heading};
        --pdf-accent: ${tokens.accent};
        --pdf-border: ${tokens.border};
        --pdf-block-bg: ${tokens.blockBg};
      }
      html, body { margin: 0; padding: 0; background: #fff; color: var(--pdf-text); }
      body {
        font-family: ${fontFamily};
        font-size: 11.5pt;
        line-height: 1.68;
        text-rendering: optimizeLegibility;
      }
      #print-root {
        width: 100%;
        color: var(--pdf-text);
        overflow-wrap: anywhere;
      }
      #pdf-premium-header {
        margin: 0 0 1.2rem;
        padding: 0 0 0.8rem;
        border-bottom: 1px solid var(--pdf-border);
        page-break-inside: avoid;
        break-inside: avoid-page;
      }
      .pdf-premium-main {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.8rem;
      }
      .pdf-premium-title {
        margin: 0;
        font-size: 1.05rem;
        line-height: 1.3;
        color: var(--pdf-heading);
        font-weight: 600;
      }
      .pdf-premium-date {
        margin: 0;
        color: var(--pdf-muted);
        font-size: 9pt;
        white-space: nowrap;
      }
      .pdf-premium-project {
        margin: 0.35rem 0 0;
        color: var(--pdf-muted);
        font-size: 8.8pt;
      }
      .pdf-premium-note {
        margin: 0.3rem 0 0;
        color: var(--pdf-muted);
        font-size: 8.5pt;
      }
      .pdf-premium-footer {
        margin: 0.3rem 0 0;
        color: var(--pdf-muted);
        font-size: 8.3pt;
      }
      #print-root h1, #print-root h2, #print-root h3, #print-root h4 {
        color: var(--pdf-heading);
        letter-spacing: 0.01em;
      }
      #print-root h1, #print-root h2, #print-root h3 {
        page-break-after: avoid;
        break-after: avoid-page;
        page-break-inside: avoid;
        break-inside: avoid-page;
      }
      #print-root h1 {
        font-size: 1.7rem;
        margin: 0 0 1rem;
        padding-bottom: 0.45rem;
        border-bottom: 1px solid var(--pdf-border);
      }
      #print-root h2 {
        font-size: 1.22rem;
        margin: 1.75rem 0 0.65rem;
        color: var(--pdf-accent);
      }
      #print-root h3 {
        font-size: 1.06rem;
        margin: 1.25rem 0 0.45rem;
        color: var(--pdf-heading);
      }
      #print-root h1 + *, #print-root h2 + *, #print-root h3 + * {
        page-break-before: avoid;
        break-before: avoid-page;
      }
      #print-root p {
        margin: 0 0 0.75em;
        color: var(--pdf-text);
        page-break-inside: auto;
        break-inside: auto;
        orphans: 3;
        widows: 3;
        hyphens: auto;
      }
      #print-root strong { color: var(--pdf-heading); }
      #print-root ul, #print-root ol { margin: 0 0 0.9em; padding-left: 1.35em; }
      #print-root li {
        margin: 0 0 0.3em;
        color: var(--pdf-text);
        page-break-inside: auto;
        break-inside: auto;
      }
      #print-root li::marker { color: var(--pdf-accent); }
      #print-root a { color: var(--pdf-accent); text-decoration: underline; }
      #print-root blockquote {
        margin: 1em 0;
        padding: 0.55em 0.9em;
        border-left: 3px solid var(--pdf-accent);
        background: var(--pdf-block-bg);
        color: var(--pdf-muted);
      }
      #print-root code, #print-root pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      #print-root pre {
        background: var(--pdf-block-bg);
        padding: 0.65em 0.8em;
        border-radius: 8px;
        border: 1px solid var(--pdf-border);
      }
      #print-root blockquote, #print-root pre, #print-root table, #print-root tr, #print-root img, #print-root figure {
        page-break-inside: avoid;
        break-inside: avoid-page;
      }
      #print-root table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.55em 0 1em;
        border: 1px solid var(--pdf-border);
        border-radius: 8px;
        overflow: hidden;
      }
      #print-root th, #print-root td {
        border: 1px solid var(--pdf-border);
        padding: 0.38em 0.5em;
        vertical-align: top;
        text-align: left;
      }
      #print-root th {
        color: var(--pdf-heading);
        background: var(--pdf-block-bg);
      }
      #print-root tbody tr:nth-child(even) { background: #fcfbf9; }
      #print-root hr {
        border: none;
        border-top: 1px solid var(--pdf-border);
        margin: 1.1em 0;
      }
    </style>
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
