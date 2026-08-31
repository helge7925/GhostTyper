function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const BILINGUAL_EXPORT_LIMITS = {
  maxPairs: 2000,
  maxFieldChars: 120_000,
  maxTotalChars: 240_000,
  maxTitleChars: 200,
  maxLabelChars: 100,
};

export function alignBilingualText(sourceText, targetText) {
  const split = (value) => String(value ?? '')
    .split(/\n\s*\n|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = split(sourceText);
  const target = split(targetText);
  const rowCount = Math.max(source.length, target.length);
  return Array.from({ length: rowCount }, (_, index) => ({
    source: source[index] || '',
    target: target[index] || '',
  }));
}

export function normalizeBilingualExportInput(body = {}) {
  if (!Array.isArray(body.pairs)) {
    return { error: 'Source/target pairs are required' };
  }
  if (body.pairs.length > BILINGUAL_EXPORT_LIMITS.maxPairs) {
    return { error: 'Too many bilingual rows' };
  }

  const pairs = [];
  let totalChars = 0;
  for (const pair of body.pairs) {
    if (
      !pair
      || typeof pair !== 'object'
      || typeof pair.source !== 'string'
      || typeof pair.target !== 'string'
    ) {
      return { error: 'Every bilingual row must contain string source and target fields' };
    }
    if (
      pair.source.length > BILINGUAL_EXPORT_LIMITS.maxFieldChars
      || pair.target.length > BILINGUAL_EXPORT_LIMITS.maxFieldChars
    ) {
      return { error: 'A bilingual field is too long' };
    }
    totalChars += pair.source.length + pair.target.length;
    if (totalChars > BILINGUAL_EXPORT_LIMITS.maxTotalChars) {
      return { error: 'Bilingual export content is too large' };
    }
    if (pair.source.trim() || pair.target.trim()) {
      pairs.push({ source: pair.source, target: pair.target });
    }
  }
  if (pairs.length === 0) {
    return { error: 'Source/target pairs are required' };
  }

  const format = body.format === undefined ? 'html' : String(body.format).toLowerCase();
  if (!['html', 'pdf'].includes(format)) {
    return { error: 'Format must be html or pdf' };
  }

  const title = body.title === undefined ? 'Bilingual translation' : body.title;
  const sourceLabel = body.sourceLabel === undefined ? 'Source' : body.sourceLabel;
  const targetLabel = body.targetLabel === undefined ? 'Target' : body.targetLabel;
  if (typeof title !== 'string' || title.length > BILINGUAL_EXPORT_LIMITS.maxTitleChars) {
    return { error: 'Invalid bilingual export title' };
  }
  if (
    typeof sourceLabel !== 'string'
    || typeof targetLabel !== 'string'
    || sourceLabel.length > BILINGUAL_EXPORT_LIMITS.maxLabelChars
    || targetLabel.length > BILINGUAL_EXPORT_LIMITS.maxLabelChars
  ) {
    return { error: 'Invalid bilingual export labels' };
  }

  return { value: { pairs, format, title, sourceLabel, targetLabel } };
}

export function buildBilingualHtml({ pairs = [], title = 'Bilingual translation', sourceLabel = 'Source', targetLabel = 'Target' } = {}) {
  const rows = pairs.map((pair) => `
    <tr>
      <td>${escapeHtml(pair.source)}</td>
      <td>${escapeHtml(pair.target)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      color: #111827;
      font-family: Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      margin: 32px;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 20px;
    }
    table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
    }
    th,
    td {
      border: 1px solid #d1d5db;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      width: 50%;
      word-break: break-word;
    }
    th {
      background: #f3f4f6;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(sourceLabel)}</th>
        <th>${escapeHtml(targetLabel)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}
