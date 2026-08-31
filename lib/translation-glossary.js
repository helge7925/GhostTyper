import crypto from 'node:crypto';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTerm(value) {
  return String(value || '').trim();
}

const LANGUAGE_ALIASES = {
  chinese: 'zh',
  dutch: 'nl',
  english: 'en',
  french: 'fr',
  german: 'de',
  italian: 'it',
  japanese: 'ja',
  polish: 'pl',
  portuguese: 'pt',
  russian: 'ru',
  'simplified chinese': 'zh-cn',
  spanish: 'es',
  'traditional chinese': 'zh-tw',
};

// Candidate threshold is broad enough for review/model context. Automatic
// reuse is deliberately much stricter and disabled for short labels/codes.
export const FUZZY_TM_CANDIDATE_THRESHOLD = 0.68;
export const FUZZY_TM_AUTO_THRESHOLD = 0.92;
export const FUZZY_TM_MIN_AUTO_SOURCE_LENGTH = 18;

function normalizeLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  return LANGUAGE_ALIASES[normalized] || normalized;
}

function termPattern(term) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'giu');
}

function asGlossaryObject(glossary) {
  if (Array.isArray(glossary)) {
    return { entries: glossary, doNotTranslate: [] };
  }
  return {
    entries: Array.isArray(glossary?.entries) ? glossary.entries : [],
    doNotTranslate: Array.isArray(glossary?.doNotTranslate) ? glossary.doNotTranslate : [],
  };
}

async function resolveQueryFn(queryFn) {
  if (queryFn) return queryFn;
  const db = await import('./db.js');
  return db.query;
}

export function normalizeForHash(text) {
  return String(text || '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function hashSource(text) {
  return crypto.createHash('sha256').update(normalizeForHash(text)).digest('hex');
}

export function buildGlossaryPromptBlock(glossary = {}) {
  const { entries, doNotTranslate } = asGlossaryObject(glossary);
  const fixedEntries = entries
    .map((entry) => ({
      source: normalizeTerm(entry.source_term ?? entry.sourceTerm),
      target: normalizeTerm(entry.target_term ?? entry.targetTerm),
    }))
    .filter((entry) => entry.source && entry.target);
  const fixedTerms = doNotTranslate.map(normalizeTerm).filter(Boolean);
  const lines = [];

  if (fixedEntries.length > 0) {
    lines.push(`Use these fixed translations: ${fixedEntries
      .map((entry) => `${JSON.stringify(entry.source)} -> ${JSON.stringify(entry.target)}`)
      .join('; ')}.`);
  }
  if (fixedTerms.length > 0) {
    lines.push(`Keep these terms unchanged (do not translate): ${fixedTerms.map((term) => JSON.stringify(term)).join(', ')}.`);
    lines.push('Preserve every DNTX...XTDN placeholder exactly, including its spelling and characters.');
  }
  if (fixedEntries.length > 0) {
    lines.push('Preserve every TRMX...XMRT placeholder exactly, including its spelling and characters.');
  }

  return lines.join('\n');
}

export function buildTMContextPromptBlock(matches = []) {
  const candidates = (Array.isArray(matches) ? matches : [])
    .filter((match) => match?.type === 'fuzzy' && match.sourceText && match.targetText)
    .filter((match, index, all) => all.findIndex((entry) => entry.id === match.id) === index)
    .slice(0, 20);
  if (candidates.length === 0) return '';

  return [
    'Translation-memory references (context only; adapt them to the current source).',
    'Glossary and do-not-translate rules take precedence. Unverified references must never be copied blindly.',
    ...candidates.map((match) => (
      `${JSON.stringify(match.sourceText)} -> ${JSON.stringify(match.targetText)} `
      + `(similarity ${Number(match.score).toFixed(3)}, ${match.verified ? 'verified' : 'unverified'})`
    )),
  ].join('\n');
}

export function selectRelevantEntries(glossary = {}, text = '') {
  const { entries, doNotTranslate } = asGlossaryObject(glossary);
  const haystack = String(text || '');
  const relevant = entries.filter((entry) => {
    const source = normalizeTerm(entry.source_term ?? entry.sourceTerm);
    return source && termPattern(source).test(haystack);
  });
  const relevantDoNotTranslate = doNotTranslate.filter((term) => {
    const source = normalizeTerm(term);
    return source && termPattern(source).test(haystack);
  });

  return {
    entries: relevant,
    doNotTranslate: relevantDoNotTranslate,
  };
}

function tolerantTokenPattern(token) {
  return new RegExp(token.split('').map(escapeRegExp).join('[\\s_-]*'), 'gi');
}

export function restoreDoNotTranslate(text, map = [], fallbackText = null) {
  let restored = String(text ?? '');
  for (const entry of map) {
    const pattern = tolerantTokenPattern(entry.token);
    if (!pattern.test(restored)) {
      return fallbackText === null ? restored : String(fallbackText);
    }
    pattern.lastIndex = 0;
    restored = restored.replace(pattern, entry.value);
  }
  return restored;
}

/**
 * Like `restoreDoNotTranslate`, but instead of silently returning the fallback
 * it reports which placeholders the model failed to preserve. This is the
 * detection hook the quality guard builds on: `fellBack` mirrors the existing
 * "revert to source on placeholder loss" behavior, and `lostTokens` carries the
 * dropped map entries (each with its `kind` — 'dnt' for do-not-translate terms,
 * 'term' for approved fixed translations).
 */
export function reportRestore(value, map = [], fallbackText = null) {
  const output = String(value ?? '');
  const lostTokens = map.filter((entry) => !tolerantTokenPattern(entry.token).test(output));
  if (lostTokens.length > 0) {
    return {
      text: fallbackText === null ? output : String(fallbackText),
      fellBack: true,
      lostTokens,
    };
  }
  let restored = output;
  for (const entry of map) {
    const pattern = tolerantTokenPattern(entry.token);
    pattern.lastIndex = 0;
    restored = restored.replace(pattern, entry.value);
  }
  return { text: restored, fellBack: false, lostTokens: [] };
}

export function protectDoNotTranslate(text, terms = [], fixedEntries = []) {
  let masked = String(text ?? '');
  const map = [];
  const candidates = [
    ...[...new Set(terms.map(normalizeTerm).filter(Boolean))]
      .map((source) => ({ source, preserveSource: true })),
    ...fixedEntries
      .map((entry) => ({
        source: normalizeTerm(entry.source_term ?? entry.sourceTerm),
        target: normalizeTerm(entry.target_term ?? entry.targetTerm),
        preserveSource: false,
      }))
      .filter((entry) => entry.source && entry.target),
  ].sort((a, b) => b.source.length - a.source.length);

  candidates.forEach((candidate) => {
    const pattern = termPattern(candidate.source);
    masked = masked.replace(pattern, (match) => {
      const token = candidate.preserveSource
        ? `DNTX${map.length}X${hashSource(match).slice(0, 12).toUpperCase()}XTDN`
        : `TRMX${map.length}X${hashSource(match).slice(0, 12).toUpperCase()}XMRT`;
      map.push({
        token,
        value: candidate.preserveSource ? match : candidate.target,
        kind: candidate.preserveSource ? 'dnt' : 'term',
      });
      return token;
    });
  });

  return {
    masked,
    map,
    restore: (value) => restoreDoNotTranslate(value, map, text),
    restoreWithReport: (value) => reportRestore(value, map, text),
  };
}

/**
 * Merge the two glossary tiers into a single lookup structure.
 *
 * Rules (see the personal-workspace-glossary spec):
 *   - Workspace rows have `user_id IS NULL`; personal rows carry a user id.
 *   - Fixed translations conflict on lower(source_term)+lower(target_lang):
 *     the workspace entry wins, the personal one is dropped.
 *   - do-not-translate is the UNION of both tiers; a personal entry can never
 *     un-mask a workspace do-not-translate term (personal fixed entries whose
 *     source is a workspace DNT term are dropped). To keep "workspace wins"
 *     airtight and avoid contradictory prompt instructions, a personal DNT
 *     term whose source matches a workspace fixed entry is likewise dropped.
 *   - Every returned entry carries a `tier` field. `personalTerms` lists the
 *     source terms that survived as personal-tier — the TM leak guard uses it.
 */
function mergeGlossaryTiers(rows) {
  const isWorkspace = (row) => row.user_id === null || row.user_id === undefined;

  const workspaceFixedSources = new Set();
  const workspaceDntSources = new Set();
  for (const row of rows) {
    if (!isWorkspace(row)) continue;
    const source = normalizeTerm(row.source_term).toLowerCase();
    if (!source) continue;
    if (row.do_not_translate) workspaceDntSources.add(source);
    else workspaceFixedSources.add(source);
  }

  const entries = [];
  const entryKeys = new Set();
  const personalTermSet = new Map(); // lower(source) -> original-case term
  const addEntry = (row, tier) => {
    const source = normalizeTerm(row.source_term);
    const lowerSource = source.toLowerCase();
    const lowerLang = normalizeTerm(row.target_lang).toLowerCase();
    const key = `${lowerSource}|${lowerLang}`;
    if (entryKeys.has(key)) return; // workspace already claimed this source+lang
    // A personal fixed entry may not un-mask a workspace do-not-translate term.
    if (tier === 'personal' && workspaceDntSources.has(lowerSource)) return;
    entryKeys.add(key);
    entries.push({
      source_term: row.source_term,
      target_lang: row.target_lang,
      target_term: row.target_term,
      tier,
    });
    if (tier === 'personal') personalTermSet.set(lowerSource, source);
  };

  // Workspace fixed entries first (they win on conflict), then personal.
  for (const row of rows) {
    if (isWorkspace(row) && !row.do_not_translate) addEntry(row, 'workspace');
  }
  for (const row of rows) {
    if (!isWorkspace(row) && !row.do_not_translate) addEntry(row, 'personal');
  }

  // do-not-translate: union of both tiers, workspace terms first.
  const doNotTranslate = [];
  const dntSeen = new Set();
  const addDnt = (row, tier) => {
    const source = normalizeTerm(row.source_term);
    const lowerSource = source.toLowerCase();
    if (!lowerSource || dntSeen.has(lowerSource)) return;
    // Workspace wins: a personal DNT never overrides a workspace fixed entry.
    if (tier === 'personal' && workspaceFixedSources.has(lowerSource)) return;
    dntSeen.add(lowerSource);
    doNotTranslate.push(row.source_term);
    if (tier === 'personal') personalTermSet.set(lowerSource, source);
  };
  for (const row of rows) {
    if (isWorkspace(row) && row.do_not_translate) addDnt(row, 'workspace');
  }
  for (const row of rows) {
    if (!isWorkspace(row) && row.do_not_translate) addDnt(row, 'personal');
  }

  return {
    entries,
    doNotTranslate,
    personalTerms: [...personalTermSet.values()],
  };
}

export async function getGlossaryForPair(orgId, sourceLang, targetLang, options = null) {
  if (!orgId || !targetLang) {
    return { entries: [], doNotTranslate: [], personalTerms: [] };
  }

  // Backward compatible: the 4th argument used to be a bare `queryFn`. Accept
  // both `getGlossaryForPair(org, src, tgt, queryFn)` and the new
  // `getGlossaryForPair(org, src, tgt, { userId, queryFn })`.
  const normalized = typeof options === 'function'
    ? { queryFn: options, userId: null }
    : { queryFn: options?.queryFn ?? null, userId: options?.userId ?? null };
  const { queryFn } = normalized;
  const userId = normalized.userId;
  const hasUser = userId !== null && userId !== undefined;

  const runQuery = await resolveQueryFn(queryFn);
  const params = [orgId, normalizeLanguage(targetLang)];
  // Without a user id we only expose workspace terminology — identical to the
  // pre-two-tier behavior. With a user id we add that user's personal tier.
  let tierClause = 'AND user_id IS NULL';
  if (hasUser) {
    params.push(userId);
    tierClause = 'AND (user_id IS NULL OR user_id = $3)';
  }

  const result = await runQuery(
    `SELECT source_term, target_lang, target_term, do_not_translate, user_id
      FROM translation_glossary
      WHERE organization_id = $1
        ${tierClause}
        AND (
          do_not_translate = true
          OR (
            do_not_translate = false
            AND lower(target_lang) = $2
            AND target_term IS NOT NULL
            AND btrim(target_term) <> ''
          )
        )
      ORDER BY lower(source_term) ASC`,
    params
  );

  return mergeGlossaryTiers(result.rows);
}

/**
 * Given a merged glossary (from `getGlossaryForPair`) and a source text,
 * return the personal-tier source terms that occur in the text — reusing the
 * same case-insensitive, word-boundary matching as `selectRelevantEntries`.
 */
export function selectAppliedPersonalTerms(glossary = {}, text = '') {
  const personalTerms = Array.isArray(glossary?.personalTerms) ? glossary.personalTerms : [];
  const haystack = String(text || '');
  return personalTerms.filter((term) => {
    const source = normalizeTerm(term);
    return source && termPattern(source).test(haystack);
  });
}

/**
 * TM leak guard: the org-wide translation memory must never cache a
 * translation shaped by someone's personal glossary. Returns true when at
 * least one personal-tier term was applied to `text`, in which case the
 * caller must skip `storeTM` for that segment (TM lookup stays org-wide).
 */
export function shouldSkipTMForText(glossary = {}, text = '') {
  return selectAppliedPersonalTerms(glossary, text).length > 0;
}

/**
 * Term-coverage instrumentation. Given a merged glossary and a source text,
 * report which fixed translations were APPLIED (source matched, with tier) and
 * which do-not-translate terms were MASKED (with tier). Pure and side-effect
 * free — reuses the same word-boundary matching as `selectRelevantEntries`, so
 * it never disagrees with what the prompt/masking layer actually did.
 */
export function describeGlossaryApplication(glossary = {}, text = '') {
  const relevant = selectRelevantEntries(glossary, text);
  const personalSet = new Set(
    (Array.isArray(glossary?.personalTerms) ? glossary.personalTerms : [])
      .map((term) => normalizeTerm(term).toLowerCase())
  );
  const tierFor = (source, declaredTier) => declaredTier
    || (personalSet.has(source.toLowerCase()) ? 'personal' : 'workspace');

  const applied = relevant.entries.map((entry) => {
    const source = normalizeTerm(entry.source_term ?? entry.sourceTerm);
    return {
      source,
      target: normalizeTerm(entry.target_term ?? entry.targetTerm),
      tier: tierFor(source, entry.tier),
    };
  });
  const masked = relevant.doNotTranslate.map((term) => {
    const source = normalizeTerm(term);
    return { term: source, tier: tierFor(source, null) };
  });

  return { applied, masked };
}

function sumUsages(usages = []) {
  return usages.filter(Boolean).reduce((total, usage) => ({
    prompt_tokens: (total.prompt_tokens || 0) + (usage.prompt_tokens || usage.input_tokens || 0),
    completion_tokens: (total.completion_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0),
  }), {});
}

function dntViolationsFrom(lostTokens = []) {
  return lostTokens
    .filter((token) => token.kind === 'dnt')
    .map((token) => ({ term: token.value }));
}

/**
 * Quality guard for a single inline text. Masks the relevant glossary, calls the
 * injected `translate(maskedText, { glossaryBlock, strict })`, restores, and — if
 * any protected placeholder was dropped — retries ONCE with `strict: true` (the
 * caller wires that to a stricter placeholder-preservation prompt). Surviving
 * violations after the retry are reported in `dntViolations`; the restored text
 * still falls back to source on loss, so a protected term is never mistranslated.
 */
export async function translateTextWithGlossaryGuard({ text, glossary = {}, tmSuggestions = [], translate }) {
  const relevant = selectRelevantEntries(glossary, text);
  const glossaryBlock = [
    buildGlossaryPromptBlock(relevant),
    buildTMContextPromptBlock(tmSuggestions),
  ].filter(Boolean).join('\n\n');
  const protectedText = protectDoNotTranslate(text, relevant.doNotTranslate, relevant.entries);
  const { applied, masked } = describeGlossaryApplication(glossary, text);

  const first = await translate(protectedText.masked, { glossaryBlock, strict: false });
  let report = protectedText.restoreWithReport(first?.translatedText ?? '');
  let model = first?.model;
  const usages = [first?.usage];
  let retried = false;

  if (report.fellBack) {
    retried = true;
    const second = await translate(protectedText.masked, { glossaryBlock, strict: true });
    report = protectedText.restoreWithReport(second?.translatedText ?? '');
    model = second?.model ?? model;
    usages.push(second?.usage);
  }

  return {
    translatedText: report.text,
    usage: sumUsages(usages),
    model,
    applied,
    masked,
    dntViolations: dntViolationsFrom(report.lostTokens),
    retried,
  };
}

/**
 * Batch variant of the guard for file segments. Masks each text, calls the
 * injected `translateSegments(maskedTexts, { glossaryBlock, strict })` once, and
 * retries ONLY the segments whose placeholders were dropped in a single stricter
 * follow-up call. Returns per-segment metadata (source, target, applied, masked,
 * dntViolations, retried) plus the aggregated usage across both calls.
 */
export async function translateSegmentsWithGlossaryGuard({
  texts,
  glossary = {},
  tmSuggestions = [],
  translateSegments,
}) {
  const safeTexts = Array.isArray(texts) ? texts.map((entry) => String(entry ?? '')) : [];
  if (safeTexts.length === 0) {
    return { translations: [], perSegment: [], usage: {}, model: undefined };
  }

  const prepared = safeTexts.map((text) => {
    const relevant = selectRelevantEntries(glossary, text);
    return {
      text,
      protectedText: protectDoNotTranslate(text, relevant.doNotTranslate, relevant.entries),
      meta: describeGlossaryApplication(glossary, text),
    };
  });
  // One prompt block for the batch — same union-of-misses shape the file path
  // used before, so the model sees every relevant term in one instruction.
  const glossaryBlock = [
    buildGlossaryPromptBlock(selectRelevantEntries(glossary, safeTexts.join('\n'))),
    buildTMContextPromptBlock(tmSuggestions.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))),
  ].filter(Boolean).join('\n\n');

  const first = await translateSegments(
    prepared.map((entry) => entry.protectedText.masked),
    { glossaryBlock, strict: false },
  );
  const usages = [first?.usage];
  let model = first?.model;

  const reports = prepared.map((entry, i) => entry.protectedText.restoreWithReport(first?.translations?.[i] ?? ''));
  const retriedFlags = new Array(prepared.length).fill(false);

  const retryIndices = reports
    .map((report, i) => (report.fellBack ? i : -1))
    .filter((i) => i >= 0);

  if (retryIndices.length > 0) {
    const retry = await translateSegments(
      retryIndices.map((i) => prepared[i].protectedText.masked),
      { glossaryBlock, strict: true },
    );
    usages.push(retry?.usage);
    model = retry?.model ?? model;
    retryIndices.forEach((segIndex, k) => {
      reports[segIndex] = prepared[segIndex].protectedText.restoreWithReport(retry?.translations?.[k] ?? '');
      retriedFlags[segIndex] = true;
    });
  }

  const perSegment = prepared.map((entry, i) => ({
    source: entry.text,
    target: reports[i].text,
    applied: entry.meta.applied,
    masked: entry.meta.masked,
    dntViolations: dntViolationsFrom(reports[i].lostTokens),
    retried: retriedFlags[i],
  }));

  return {
    translations: perSegment.map((entry) => entry.target),
    perSegment,
    usage: sumUsages(usages),
    model,
  };
}

/**
 * Fold per-segment metadata (from the batch guard and/or TM hits) into one
 * request-level summary for the file-translation API response. Applied terms
 * dedupe on source+tier, masked terms and violations on the term.
 */
export function aggregateSegmentMetadata(perSegment = []) {
  const appliedMap = new Map();
  const maskedMap = new Map();
  const violationMap = new Map();
  let retriedSegments = 0;
  let exactTmHits = 0;
  let fuzzyTmHits = 0;
  const tmSuggestionMap = new Map();

  for (const segment of perSegment) {
    for (const entry of segment?.applied || []) {
      appliedMap.set(`${String(entry.source).toLowerCase()}|${entry.tier}`, entry);
    }
    for (const entry of segment?.masked || []) {
      maskedMap.set(String(entry.term).toLowerCase(), entry);
    }
    for (const entry of segment?.dntViolations || []) {
      violationMap.set(String(entry.term).toLowerCase(), entry);
    }
    if (segment?.retried) retriedSegments += 1;
    if (segment?.tmMatch?.type === 'exact') exactTmHits += 1;
    if (segment?.tmMatch?.type === 'fuzzy') fuzzyTmHits += 1;
    for (const match of segment?.tmSuggestions || []) {
      tmSuggestionMap.set(String(match.id), match);
    }
  }

  return {
    applied: [...appliedMap.values()],
    masked: [...maskedMap.values()],
    dntViolations: [...violationMap.values()],
    retriedSegments,
    exactTmHits,
    fuzzyTmHits,
    tmSuggestions: [...tmSuggestionMap.values()],
  };
}

/**
 * Fire-and-forget last_used_at bump for TM rows that were just served from
 * cache. Deliberately NOT awaited by the lookups — it must never delay (or
 * fail) the translation return path. Swallows its own errors; a missed
 * timestamp only degrades the "recently used" ordering in the TM browser.
 */
function touchTMLastUsed(ids, runQuery) {
  const validIds = (Array.isArray(ids) ? ids : [])
    .filter((id) => id !== null && id !== undefined);
  if (validIds.length === 0 || typeof runQuery !== 'function') return;
  Promise.resolve()
    .then(() => runQuery(
      'UPDATE translation_memory SET last_used_at = NOW() WHERE id = ANY($1::bigint[])',
      [validIds],
    ))
    .catch(() => {});
}

function normalizeLookupOptions(options) {
  if (typeof options === 'function') return { queryFn: options, glossary: null };
  return {
    queryFn: options?.queryFn ?? null,
    glossary: options?.glossary ?? null,
  };
}

function normalizedCharacterLength(text) {
  return Array.from(normalizeForHash(text))
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .length;
}

const CRITICAL_UNITS = new Set([
  'a', 'bar', 'c', 'cm', 'g', 'ghz', 'h', 'hz', 'k', 'kg', 'khz', 'kn', 'kv',
  'l', 'm', 'ma', 'mg', 'mhz', 'min', 'ml', 'mm', 'mmol', 'mol', 'mpa', 'ms',
  'mw', 'n', 'nm', 'pa', 'ph', 'psi', 'rpm', 's', 'ug', 'ul', 'um', 'v', 'w',
  'kw', 'kpa', 'µg', 'µl', 'µm', '°c',
]);

const NEGATION_PATTERNS = [
  ['are-not', /\baren['’]t\b/giu],
  ['can-not', /\bcan['’]t\b/giu],
  ['cannot', /\bcannot\b/giu],
  ['contracted-not', /\b[\p{L}]+n['’]t\b/giu],
  ['could-not', /\bcouldn['’]t\b/giu],
  ['did-not', /\bdidn['’]t\b/giu],
  ['does-not', /\bdoesn['’]t\b/giu],
  ['do-not', /\bdon['’]t\b/giu],
  ['forbidden', /\b(?:forbidden|prohibited)\b/giu],
  ['had-not', /\bhadn['’]t\b/giu],
  ['has-not', /\bhasn['’]t\b/giu],
  ['have-not', /\bhaven['’]t\b/giu],
  ['is-not', /\bisn['’]t\b/giu],
  ['kein', /\bkein(?:e|en|em|er|es)?\b/giu],
  ['keinerlei', /\bkeinerlei\b/giu],
  ['keineswegs', /\bkeineswegs\b/giu],
  ['might-not', /\bmightn['’]t\b/giu],
  ['must-not', /\bmustn['’]t\b/giu],
  ['never', /\b(?:never|niemals)\b/giu],
  ['nie', /\bnie\b/giu],
  ['nicht', /\bnicht\b/giu],
  ['no', /\bno\b/giu],
  ['not', /\bnot\b/giu],
  ['ohne', /\bohne\b/giu],
  ['shall-not', /\bshan['’]t\b/giu],
  ['should-not', /\bshouldn['’]t\b/giu],
  ['was-not', /\bwasn['’]t\b/giu],
  ['were-not', /\bweren['’]t\b/giu],
  ['weder', /\bweder\b/giu],
  ['will-not', /\bwon['’]t\b/giu],
  ['without', /\bwithout\b/giu],
  ['would-not', /\bwouldn['’]t\b/giu],
  ['不得', /不得/gu],
  ['不', /不/gu],
  ['别', /别/gu],
  ['別', /別/gu],
  ['勿', /勿/gu],
  ['未', /未/gu],
  ['没有', /没有/gu],
  ['沒有', /沒有/gu],
  ['无', /无/gu],
  ['無', /無/gu],
  ['禁止', /禁止/gu],
];

function signatureEquals(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function criticalTokenSignature(text) {
  const source = String(text || '').normalize('NFC');
  const tokens = source.match(/[\p{L}\p{N}]+(?:[._:/+%-][\p{L}\p{N}]+)*%?/gu) || [];
  const signature = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const normalized = token.toLowerCase();
    if (/\p{N}/u.test(token)) signature.push(`value:${normalized}`);
    if (CRITICAL_UNITS.has(normalized) && /\p{N}/u.test(tokens[index - 1] || '')) {
      signature.push(`unit:${normalized}`);
    }
    if (
      token.length >= 2
      && /\p{Lu}/u.test(token)
      && !/\p{Ll}/u.test(token)
      && !/\p{N}/u.test(token)
    ) {
      signature.push(`code:${normalized}`);
    }
  }
  return signature.sort();
}

function negationSignature(text) {
  const source = normalizeForHash(text);
  return NEGATION_PATTERNS.flatMap(([label, pattern]) => {
    pattern.lastIndex = 0;
    return new Array([...source.matchAll(pattern)].length).fill(label);
  }).sort();
}

function fuzzySafety(sourceText, candidateSourceText) {
  const criticalTokensMatch = signatureEquals(
    criticalTokenSignature(sourceText),
    criticalTokenSignature(candidateSourceText),
  );
  const negationsMatch = signatureEquals(
    negationSignature(sourceText),
    negationSignature(candidateSourceText),
  );
  return { criticalTokensMatch, negationsMatch };
}

function mapTMMatch(row, type, sourceText, glossary) {
  const score = type === 'exact' ? 1 : Number(row.score || 0);
  const personalGlossaryApplies = type === 'fuzzy' && shouldSkipTMForText(glossary, sourceText);
  const personalGlossaryUnavailable = type === 'fuzzy' && glossary?.personalGlossaryUnavailable === true;
  const safety = type === 'fuzzy'
    ? fuzzySafety(sourceText, row.source_text || '')
    : { criticalTokensMatch: true, negationsMatch: true };
  return {
    type,
    score,
    id: row.id,
    sourceText: row.source_text || sourceText,
    targetText: row.target_text,
    verified: row.verified === true,
    autoReusable: type === 'exact' || (
      row.verified === true
      && score > FUZZY_TM_AUTO_THRESHOLD
      && normalizedCharacterLength(sourceText) >= FUZZY_TM_MIN_AUTO_SOURCE_LENGTH
      && !personalGlossaryApplies
      && !personalGlossaryUnavailable
      && safety.criticalTokensMatch
      && safety.negationsMatch
    ),
    personalGlossaryBlocked: personalGlossaryApplies,
    personalGlossaryUnavailableBlocked: personalGlossaryUnavailable,
    criticalTokensMatch: safety.criticalTokensMatch,
    negationsMatch: safety.negationsMatch,
  };
}

/**
 * Structured exact-first lookup. A fuzzy result is automatic only when
 * `autoReusable` is true; otherwise callers expose it as context/review data.
 */
export async function lookupTMMatch(orgId, sourceLang, targetLang, sourceText, options = null) {
  const [match] = await lookupTMMatchesBatch(
    orgId,
    sourceLang,
    targetLang,
    [sourceText],
    options,
  );
  return match;
}

/**
 * Runs one exact query and one fuzzy query for all exact misses. Every query is
 * scoped to the active organization and normalized language pair.
 */
export async function lookupTMMatchesBatch(
  orgId,
  sourceLang,
  targetLang,
  sourceTexts,
  options = null,
) {
  const texts = Array.isArray(sourceTexts) ? sourceTexts.map((text) => String(text ?? '')) : [];
  const matches = new Array(texts.length).fill(null);
  if (!orgId || !sourceLang || !targetLang || texts.length === 0) return matches;

  const normalized = texts.map(normalizeForHash);
  const hashes = normalized.map((value, index) => (value ? hashSource(texts[index]) : null));
  const wantedHashes = [...new Set(hashes.filter(Boolean))];
  if (wantedHashes.length === 0) return matches;

  const { queryFn, glossary } = normalizeLookupOptions(options);
  const runQuery = await resolveQueryFn(queryFn);
  const sourceLanguage = normalizeLanguage(sourceLang);
  const targetLanguage = normalizeLanguage(targetLang);
  const exactResult = await runQuery(
    `SELECT id, source_hash, source_normalized, source_text, target_text, verified
      FROM translation_memory
      WHERE organization_id = $1
        AND source_lang = $2
        AND target_lang = $3
        AND (
          source_hash = ANY($4::text[])
          OR source_normalized = ANY($5::text[])
        )
      ORDER BY verified DESC, updated_at DESC`,
    [orgId, sourceLanguage, targetLanguage, wantedHashes, [...new Set(normalized.filter(Boolean))]]
  );

  const exactByHash = new Map();
  const exactByNormalized = new Map();
  for (const row of exactResult.rows) {
    if (row.source_hash && !exactByHash.has(row.source_hash)) exactByHash.set(row.source_hash, row);
    if (row.source_normalized && !exactByNormalized.has(row.source_normalized)) {
      exactByNormalized.set(row.source_normalized, row);
    }
  }

  const reusedIds = [];
  const missIndices = [];
  for (let index = 0; index < texts.length; index += 1) {
    if (!hashes[index]) continue;
    const row = exactByHash.get(hashes[index]) || exactByNormalized.get(normalized[index]);
    if (row) {
      matches[index] = mapTMMatch(row, 'exact', texts[index], glossary);
      if (row.id !== null && row.id !== undefined) reusedIds.push(row.id);
    } else {
      missIndices.push(index);
    }
  }

  // `auto` groups text from potentially different detected languages under one
  // storage key. Exact hashes remain safe, but fuzzy reuse needs a confirmed
  // source language to preserve language-pair isolation.
  if (missIndices.length > 0 && sourceLanguage !== 'auto') {
    const fuzzyResult = await runQuery(
      `WITH inputs AS (
         SELECT source_normalized, input_index::integer
         FROM unnest($4::text[]) WITH ORDINALITY AS input(source_normalized, input_index)
       )
       SELECT inputs.input_index, candidate.id, candidate.source_text,
         candidate.target_text, candidate.verified, candidate.score
       FROM inputs
       JOIN LATERAL (
         SELECT tm.id, tm.source_text, tm.target_text, tm.verified,
           similarity(tm.source_normalized, inputs.source_normalized) AS score
         FROM translation_memory tm
         WHERE tm.organization_id = $1
           AND tm.source_lang = $2
           AND tm.target_lang = $3
           AND tm.source_normalized % inputs.source_normalized
           AND similarity(tm.source_normalized, inputs.source_normalized) >= $5
         ORDER BY score DESC, tm.verified DESC,
           COALESCE(tm.last_used_at, tm.updated_at) DESC
         LIMIT 1
       ) candidate ON true
       ORDER BY inputs.input_index`,
      [
        orgId,
        sourceLanguage,
        targetLanguage,
        missIndices.map((index) => normalized[index]),
        FUZZY_TM_CANDIDATE_THRESHOLD,
      ]
    );

    for (const row of fuzzyResult.rows) {
      const originalIndex = missIndices[Number(row.input_index) - 1];
      if (originalIndex === undefined) continue;
      const match = mapTMMatch(row, 'fuzzy', texts[originalIndex], glossary);
      matches[originalIndex] = match;
      if (match.autoReusable && row.id !== null && row.id !== undefined) reusedIds.push(row.id);
    }
  }

  touchTMLastUsed([...new Set(reusedIds)], runQuery);
  return matches;
}

export async function lookupTM(orgId, sourceLang, targetLang, sourceText, queryFn = null) {
  if (!orgId || !sourceLang || !targetLang || !normalizeForHash(sourceText)) {
    return null;
  }

  const runQuery = await resolveQueryFn(queryFn);
  // Prefer a human-verified correction over an auto-cached translation for the
  // same source hash. The UNIQUE constraint means at most one row per hash
  // today, but ORDER BY verified DESC keeps this correct and future-proof.
  const result = await runQuery(
    `SELECT id, target_text
      FROM translation_memory
      WHERE organization_id = $1
        AND source_lang = $2
        AND target_lang = $3
        AND source_hash = $4
      ORDER BY verified DESC, updated_at DESC
      LIMIT 1`,
    [orgId, normalizeLanguage(sourceLang), normalizeLanguage(targetLang), hashSource(sourceText)]
  );

  const row = result.rows[0];
  if (!row) return null;
  touchTMLastUsed([row.id], runQuery);
  return row.target_text || null;
}

/**
 * Batched variant of lookupTM: one query for many source texts. Returns an
 * array aligned with `sourceTexts` — hit → target text, miss → null. Used by
 * the live-translation bridge, which otherwise fires one query per sentence
 * unit on every poll tick.
 */
export async function lookupTMBatch(orgId, sourceLang, targetLang, sourceTexts, queryFn = null) {
  const texts = Array.isArray(sourceTexts) ? sourceTexts : [];
  const results = new Array(texts.length).fill(null);
  if (!orgId || !sourceLang || !targetLang || texts.length === 0) {
    return results;
  }

  const hashes = texts.map((text) => (normalizeForHash(text) ? hashSource(text) : null));
  const wantedHashes = [...new Set(hashes.filter(Boolean))];
  if (wantedHashes.length === 0) return results;

  const runQuery = await resolveQueryFn(queryFn);
  const result = await runQuery(
    `SELECT id, source_hash, target_text
      FROM translation_memory
      WHERE organization_id = $1
        AND source_lang = $2
        AND target_lang = $3
        AND source_hash = ANY($4::text[])
      ORDER BY verified DESC, updated_at DESC`,
    [orgId, normalizeLanguage(sourceLang), normalizeLanguage(targetLang), wantedHashes]
  );

  // verified-first ordering means the first row seen per hash is the winner;
  // ignore any lower-precedence duplicates. Collect the winners' ids so their
  // last_used_at is bumped in one fire-and-forget UPDATE after the return path.
  const byHash = new Map();
  const hitIds = [];
  for (const row of result.rows) {
    if (byHash.has(row.source_hash)) continue;
    byHash.set(row.source_hash, row.target_text);
    if (row.id !== null && row.id !== undefined) hitIds.push(row.id);
  }
  touchTMLastUsed(hitIds, runQuery);
  return hashes.map((hash) => (hash ? byHash.get(hash) || null : null));
}

export async function storeTM(orgId, sourceLang, targetLang, sourceText, targetText, queryFn = null) {
  if (
    !orgId
    || !sourceLang
    || !targetLang
    || !normalizeForHash(sourceText)
    || !String(targetText || '').trim()
  ) {
    return false;
  }

  const runQuery = await resolveQueryFn(queryFn);
  await runQuery(
    `INSERT INTO translation_memory (
        organization_id,
        source_lang,
        target_lang,
        source_hash,
        source_normalized,
        source_text,
        target_text
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (organization_id, source_lang, target_lang, source_hash)
      DO UPDATE SET
        source_normalized = EXCLUDED.source_normalized,
        source_text = EXCLUDED.source_text,
        target_text = EXCLUDED.target_text,
        updated_at = NOW()
      WHERE translation_memory.verified = false`,
    [
      orgId,
      normalizeLanguage(sourceLang),
      normalizeLanguage(targetLang),
      hashSource(sourceText),
      normalizeForHash(sourceText),
      sourceText,
      targetText,
    ]
  );

  return true;
}

/**
 * Store or overwrite a TM entry as human-verified (verified = true). Used by
 * the file review view when a translator saves a correction: the entry then
 * wins over any auto-cached translation for the same source hash on the next
 * lookup (see the ORDER BY verified DESC in lookupTM/lookupTMBatch). Same
 * validation and language normalization as storeTM; last_used_at is stamped so
 * a freshly corrected entry surfaces at the top of the TM browser.
 */
export async function upsertVerifiedTM(orgId, sourceLang, targetLang, sourceText, targetText, queryFn = null) {
  if (
    !orgId
    || !sourceLang
    || !targetLang
    || !normalizeForHash(sourceText)
    || !String(targetText || '').trim()
  ) {
    return false;
  }

  const runQuery = await resolveQueryFn(queryFn);
  await runQuery(
    `INSERT INTO translation_memory (
        organization_id,
        source_lang,
        target_lang,
        source_hash,
        source_normalized,
        source_text,
        target_text,
        verified,
        last_used_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
      ON CONFLICT (organization_id, source_lang, target_lang, source_hash)
      DO UPDATE SET
        source_normalized = EXCLUDED.source_normalized,
        source_text = EXCLUDED.source_text,
        target_text = EXCLUDED.target_text,
        verified = true,
        last_used_at = NOW(),
        updated_at = NOW()`,
    [
      orgId,
      normalizeLanguage(sourceLang),
      normalizeLanguage(targetLang),
      hashSource(sourceText),
      normalizeForHash(sourceText),
      sourceText,
      targetText,
    ]
  );

  return true;
}
