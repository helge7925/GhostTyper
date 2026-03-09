const STOPWORDS = new Set([
  'der', 'die', 'das', 'und', 'oder', 'aber', 'ein', 'eine', 'einer', 'einem', 'einen',
  'mit', 'ohne', 'für', 'von', 'zum', 'zur', 'im', 'in', 'am', 'an', 'auf', 'aus', 'bei',
  'ich', 'du', 'er', 'sie', 'wir', 'ihr', 'es', 'man', 'nicht', 'kein', 'keine', 'ja', 'nein',
  'the', 'and', 'or', 'with', 'without', 'for', 'from', 'to', 'in', 'on', 'at', 'is', 'are'
]);

function normalizeTerm(term) {
  return String(term || '').trim().slice(0, 80);
}

export function parseContextBiasTerms(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return [];

  const parts = rawValue
    .split(/[\n,;]+/)
    .map((entry) => normalizeTerm(entry))
    .filter(Boolean);

  const seen = new Set();
  const unique = [];

  for (const part of parts) {
    const key = part.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }

  return unique;
}

export function serializeContextBiasTerms(terms) {
  const normalized = parseContextBiasTerms(Array.isArray(terms) ? terms.join(', ') : String(terms || ''));
  return normalized.length > 0 ? normalized.join(', ') : null;
}

function shouldIndexToken(token) {
  if (!token) return false;
  if (token.length < 3 || token.length > 60) return false;
  if (/^\d+$/.test(token)) return false;

  const lower = token.toLocaleLowerCase('de-DE');
  if (STOPWORDS.has(lower)) return false;

  const hasDigit = /\d/.test(token);
  const isAcronym = /^[A-ZÄÖÜ0-9-]{2,}$/.test(token);
  const hasUpperInside = /[A-ZÄÖÜ]/.test(token.slice(1));
  const hasCompound = /[-_/]/.test(token);
  const hasUmlaut = /[ÄÖÜäöüß]/.test(token);

  return hasDigit || isAcronym || hasUpperInside || hasCompound || hasUmlaut;
}

function scoreToken(token) {
  let score = 1;
  if (/^[A-ZÄÖÜ0-9-]{2,}$/.test(token)) score += 1;
  if (/\d/.test(token)) score += 1;
  if (/[-_/]/.test(token)) score += 1;
  return score;
}

export function extractGlossaryCandidates(text) {
  if (!text || typeof text !== 'string') return [];

  const matches = text.match(/[A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9\-_/]{2,}/g) || [];
  const aggregated = new Map();

  for (const rawToken of matches) {
    const token = normalizeTerm(rawToken);
    if (!shouldIndexToken(token)) continue;

    const key = token.toLocaleLowerCase('de-DE');
    const current = aggregated.get(key) || { term: token, count: 0, score: 0 };
    current.count += 1;
    current.score += scoreToken(token);

    if (token.length > current.term.length) {
      current.term = token;
    }

    aggregated.set(key, current);
  }

  return Array.from(aggregated.values());
}

export function buildGlossarySuggestions({
  texts = [],
  existingTerms = [],
  limit = 30,
}) {
  const existing = new Set(parseContextBiasTerms(existingTerms.join(', ')).map((term) => term.toLocaleLowerCase('de-DE')));
  const aggregate = new Map();

  for (const text of texts) {
    const candidates = extractGlossaryCandidates(text);
    for (const candidate of candidates) {
      const key = candidate.term.toLocaleLowerCase('de-DE');
      if (existing.has(key)) continue;

      const entry = aggregate.get(key) || { term: candidate.term, count: 0, score: 0 };
      entry.count += candidate.count;
      entry.score += candidate.score;
      if (candidate.term.length > entry.term.length) {
        entry.term = candidate.term;
      }
      aggregate.set(key, entry);
    }
  }

  return Array.from(aggregate.values())
    .filter((entry) => entry.count >= 2 || entry.score >= 3)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.score !== a.score) return b.score - a.score;
      return a.term.localeCompare(b.term, 'de');
    })
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((entry) => ({
      term: entry.term,
      count: entry.count,
      score: entry.score,
    }));
}
