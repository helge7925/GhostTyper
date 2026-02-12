export const DEFAULT_PDF_THEME = 'atelier';
export const DEFAULT_PDF_FONT_PRESET = 'google-sans';

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

export function normalizePdfTheme(theme) {
  return Object.prototype.hasOwnProperty.call(THEME_TOKENS, theme) ? theme : DEFAULT_PDF_THEME;
}

export function normalizePdfFontPreset(fontPreset) {
  return Object.prototype.hasOwnProperty.call(FONT_PRESETS, fontPreset)
    ? fontPreset
    : DEFAULT_PDF_FONT_PRESET;
}

export function buildPdfPrintStyles({ theme, fontPreset } = {}) {
  const resolvedTheme = normalizePdfTheme(theme);
  const resolvedFontPreset = normalizePdfFontPreset(fontPreset);
  const tokens = THEME_TOKENS[resolvedTheme];
  const fontFamily = FONT_PRESETS[resolvedFontPreset];
  const fontImport = FONT_IMPORTS[resolvedFontPreset] ? `@import url('${FONT_IMPORTS[resolvedFontPreset]}');` : '';

  return `
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
      orphans: 3;
      widows: 3;
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
    }
    #print-root h2 {
      font-size: 1.22rem;
      margin: 1.75rem 0 0.65rem;
      color: var(--pdf-accent);
      padding-top: 0.45rem;
      border-top: 1px solid var(--pdf-border);
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
    #print-root h2 + p,
    #print-root h2 + ul,
    #print-root h2 + ol,
    #print-root h2 + blockquote,
    #print-root h2 + pre,
    #print-root h3 + p,
    #print-root h3 + ul,
    #print-root h3 + ol,
    #print-root h3 + blockquote,
    #print-root h3 + pre {
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    #print-root p {
      margin: 0 0 0.75em;
      color: var(--pdf-text);
      page-break-inside: auto;
      break-inside: auto;
      orphans: 4;
      widows: 4;
      hyphens: auto;
    }
    #print-root strong { color: var(--pdf-heading); }
    #print-root ul, #print-root ol {
      margin: 0 0 0.9em;
      padding-left: 1.35em;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    #print-root li {
      margin: 0 0 0.3em;
      color: var(--pdf-text);
      page-break-inside: avoid;
      break-inside: avoid-page;
      orphans: 2;
      widows: 2;
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
    #print-root thead {
      display: table-header-group;
    }
    #print-root th, #print-root td {
      border: 1px solid var(--pdf-border);
      padding: 0.38em 0.5em;
      vertical-align: top;
      text-align: left;
      orphans: 2;
      widows: 2;
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
  `;
}
