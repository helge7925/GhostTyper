/**
 * Glossary interchange: CSV round-trip + minimal TBX-Basic export.
 *
 * CSV columns (fixed order, header required on export, tolerated on import):
 *   source_term, target_lang, target_term, do_not_translate, notes
 *
 * The CSV writer/reader is a small self-contained RFC-4180-ish implementation
 * (quotes fields containing "," / '"' / newlines, doubles embedded quotes) so
 * an exported file re-imports byte-for-byte equivalent — including terms that
 * themselves contain commas, quotes or line breaks.
 */

export const GLOSSARY_CSV_COLUMNS = ['source_term', 'target_lang', 'target_term', 'do_not_translate', 'notes'];

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function isTruthyFlag(value) {
  return ['true', '1', 'yes', 'y', 'ja', 'x'].includes(String(value ?? '').trim().toLowerCase());
}

/**
 * Serialize glossary rows to CSV. do-not-translate entries export with empty
 * target_lang / target_term so the round-trip preserves their shape.
 */
export function glossaryToCsv(entries = []) {
  const lines = [GLOSSARY_CSV_COLUMNS.join(',')];
  for (const entry of entries) {
    const isDnt = !!entry.do_not_translate;
    lines.push([
      csvEscape(entry.source_term),
      csvEscape(isDnt ? '' : (entry.target_lang || '')),
      csvEscape(isDnt ? '' : (entry.target_term || '')),
      isDnt ? 'true' : 'false',
      csvEscape(entry.notes || ''),
    ].join(','));
  }
  return lines.join('\r\n');
}

/**
 * Parse a CSV string into an array of field-arrays. Handles quoted fields with
 * embedded commas, doubled quotes and CR/LF newlines. Strips a leading BOM.
 */
export function parseCsvRecords(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; sawAny = true; continue; }
    if (ch === ',') { record.push(field); field = ''; sawAny = true; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') { record.push(field); records.push(record); record = []; field = ''; sawAny = false; continue; }
    field += ch;
    sawAny = true;
  }
  if (sawAny || field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function looksLikeHeader(record) {
  return Array.isArray(record)
    && record.map((cell) => String(cell || '').trim().toLowerCase()).includes('source_term');
}

/**
 * Parse a glossary CSV into row objects ready for validation. When the first
 * record is a header row, columns are mapped by name (any order / subset);
 * otherwise the fixed GLOSSARY_CSV_COLUMNS order is assumed. `line` is the
 * 1-based source line so per-row import errors point back to the file.
 */
export function parseGlossaryCsv(text) {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { rows: [] };

  let columns = GLOSSARY_CSV_COLUMNS;
  let dataStart = 0;
  if (looksLikeHeader(records[0])) {
    columns = records[0].map((cell) => String(cell || '').trim().toLowerCase());
    dataStart = 1;
  }

  const rows = [];
  for (let r = dataStart; r < records.length; r += 1) {
    const record = records[r];
    // Skip fully blank lines (a trailing newline produces one empty field).
    if (record.length === 1 && String(record[0]).trim() === '') continue;

    const byColumn = {};
    columns.forEach((col, index) => { byColumn[col] = record[index]; });

    rows.push({
      line: r + 1,
      data: {
        source_term: String(byColumn.source_term ?? '').trim(),
        target_lang: String(byColumn.target_lang ?? '').trim(),
        target_term: String(byColumn.target_term ?? '').trim(),
        do_not_translate: isTruthyFlag(byColumn.do_not_translate),
        notes: String(byColumn.notes ?? '').trim(),
      },
    });
  }
  return { rows };
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Minimal TBX-Basic export of a glossary scope. Fixed entries emit two
 * langSets (source default language + target_lang); do-not-translate entries
 * emit a single source langSet flagged with a termNote. Export-only — the CSV
 * path is the round-trip format.
 */
export function glossaryToTbx(entries = [], { sourceLang = 'de', scopeLabel = 'workspace' } = {}) {
  const srcLang = xmlEscape(sourceLang || 'de');
  const termEntries = entries.map((entry, index) => {
    const source = xmlEscape(entry.source_term);
    if (entry.do_not_translate) {
      return [
        `    <termEntry id="c${index + 1}">`,
        `      <langSet xml:lang="${srcLang}">`,
        '        <tig>',
        `          <term>${source}</term>`,
        '          <termNote type="termType">doNotTranslate</termNote>',
        entry.notes ? `          <descrip type="context">${xmlEscape(entry.notes)}</descrip>` : null,
        '        </tig>',
        '      </langSet>',
        '    </termEntry>',
      ].filter(Boolean).join('\n');
    }
    const targetLang = xmlEscape(entry.target_lang || 'en');
    return [
      `    <termEntry id="c${index + 1}">`,
      `      <langSet xml:lang="${srcLang}">`,
      '        <tig>',
      `          <term>${source}</term>`,
      entry.notes ? `          <descrip type="context">${xmlEscape(entry.notes)}</descrip>` : null,
      '        </tig>',
      '      </langSet>',
      `      <langSet xml:lang="${targetLang}">`,
      '        <tig>',
      `          <term>${xmlEscape(entry.target_term)}</term>`,
      '        </tig>',
      '      </langSet>',
      '    </termEntry>',
    ].filter(Boolean).join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<martif type="TBX-Basic" xml:lang="en">',
    '  <martifHeader>',
    '    <fileDesc>',
    '      <sourceDesc>',
    `        <p>GhostTyper glossary export (${xmlEscape(scopeLabel)})</p>`,
    '      </sourceDesc>',
    '    </fileDesc>',
    '  </martifHeader>',
    '  <text>',
    '    <body>',
    ...termEntries,
    '    </body>',
    '  </text>',
    '</martif>',
    '',
  ].join('\n');
}
