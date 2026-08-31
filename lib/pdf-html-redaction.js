export const PDF_REDACTION_LIMITS = {
  maxTerms: 50,
  maxTermChars: 200,
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlText(value) {
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function normalizePdfRedactionTerms(input) {
  if (input === undefined || input === null || input === '') return { value: [] };
  const raw = Array.isArray(input) ? input : String(input).split(/[\n,;]/);
  if (raw.length > PDF_REDACTION_LIMITS.maxTerms) return { error: 'TOO_MANY_REDACTION_TERMS' };
  const unique = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') return { error: 'INVALID_REDACTION_TERM' };
    const term = item.trim();
    if (!term) continue;
    if (term.length > PDF_REDACTION_LIMITS.maxTermChars) return { error: 'REDACTION_TERM_TOO_LONG' };
    const key = term.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(term);
    }
  }
  return { value: unique };
}

export function redactHtmlText(html, terms) {
  const normalized = normalizePdfRedactionTerms(terms);
  if (normalized.error) {
    const error = new Error(normalized.error);
    error.code = normalized.error;
    throw error;
  }
  if (normalized.value.length === 0) return { html: String(html || ''), applied: 0, terms: 0 };

  let applied = 0;
  const parts = String(html || '').split(/(<[^>]*>)/g);
  const redacted = parts.map((part) => {
    if (part.startsWith('<')) return part;
    let next = part;
    for (const term of normalized.value) {
      const replacement = '█'.repeat(Math.max(3, Math.min(40, [...term].length)));
      for (const candidate of new Set([term, escapeHtml(term)])) {
        next = next.replace(new RegExp(escapeRegExp(candidate), 'giu'), () => {
          applied += 1;
          return replacement;
        });
      }
    }
    return next;
  }).join('');

  const residualText = decodeHtmlText(redacted).toLocaleLowerCase();
  const residual = normalized.value.find((term) => residualText.includes(term.toLocaleLowerCase()));
  if (residual) {
    const error = new Error('PDF_REDACTION_INCOMPLETE');
    error.code = 'PDF_REDACTION_INCOMPLETE';
    throw error;
  }

  return { html: redacted, applied, terms: normalized.value.length };
}
