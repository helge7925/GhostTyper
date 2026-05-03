/**
 * Builds the download filename for a translated file.
 *
 * Format: `<base> - <languageLabel><extension>`
 *   - DE-UI:  "Bericht - englisch.docx", "Report - deutsch.pdf"
 *   - EN-UI:  "Report - english.docx", "Bericht - german.pdf"
 *   - Fallback (when no localized label is provided): "Bericht - translated.docx"
 *
 * Sanitization rules:
 *   - Strip any existing extension from the original filename.
 *   - Allow letters (incl. German umlauts), digits, spaces, dot, underscore, hyphen.
 *     Everything else (slash, backslash, control chars, quotes, parentheses,
 *     em-dash, etc.) is replaced by a single underscore.
 *   - Trim leading/trailing underscores and whitespace.
 *   - Cap base length at 100 chars, label length at 50 chars.
 *   - Both base and label fall back to a sensible default if empty after
 *     sanitization (`dokument` for the base, `translated` for the label).
 */
const ALLOWED_FILENAME_CHARS = /[^a-zA-Z0-9äöüÄÖÜß._\- ]+/g;

function sanitizeBase(filename) {
  const stripped = String(filename || '')
    .replace(/\.[^/.]+$/, '')
    .replace(ALLOWED_FILENAME_CHARS, '_')
    .replace(/_+/g, '_')
    .replace(/^[\s_]+|[\s_]+$/g, '')
    .slice(0, 100);
  return stripped || 'dokument';
}

function sanitizeLabel(label, fallback) {
  const cleaned = String(label || '')
    .replace(ALLOWED_FILENAME_CHARS, '_')
    .replace(/_+/g, '_')
    .replace(/^[\s_]+|[\s_]+$/g, '')
    .slice(0, 50);
  return cleaned || fallback || 'translated';
}

export function buildTranslatedFilename(filename, extension, languageLabel, fallback = 'translated') {
  const base = sanitizeBase(filename);
  const label = sanitizeLabel(languageLabel, fallback);
  const ext = String(extension || '').startsWith('.') ? extension : extension ? `.${extension}` : '';
  return `${base} - ${label}${ext}`;
}
