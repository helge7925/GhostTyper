import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateSegmentMetadata,
  buildGlossaryPromptBlock,
  describeGlossaryApplication,
  getGlossaryForPair,
  hashSource,
  lookupTM,
  lookupTMBatch,
  normalizeForHash,
  protectDoNotTranslate,
  reportRestore,
  restoreDoNotTranslate,
  selectAppliedPersonalTerms,
  selectRelevantEntries,
  shouldSkipTMForText,
  storeTM,
  translateSegmentsWithGlossaryGuard,
  translateTextWithGlossaryGuard,
  upsertVerifiedTM,
} from '../lib/translation-glossary.js';
import { normalizeGlossaryPayload } from '../lib/translation-glossary-validation.js';

test('buildGlossaryPromptBlock returns empty string for empty glossary', () => {
  assert.equal(buildGlossaryPromptBlock({ entries: [], doNotTranslate: [] }), '');
});

test('buildGlossaryPromptBlock formats fixed translations and do-not-translate terms', () => {
  const block = buildGlossaryPromptBlock({
    entries: [{ source_term: 'Strahlentladung', target_term: 'blast discharge' }],
    doNotTranslate: ['Romaco', 'Kilian'],
  });
  assert.match(block, /Use these fixed translations: "Strahlentladung" -> "blast discharge"\./);
  assert.match(block, /Keep these terms unchanged \(do not translate\): "Romaco", "Kilian"\./);
  assert.match(block, /DNTX\.\.\.XTDN placeholder/);
});

test('selectRelevantEntries filters terms by case-insensitive source occurrence', () => {
  const selected = selectRelevantEntries({
    entries: [
      { source_term: 'Strahlentladung', target_term: 'blast discharge' },
      { source_term: 'Granulator', target_term: 'granulator' },
    ],
    doNotTranslate: ['Romaco'],
  }, 'Die STRAHLENTLADUNG startet bei Romaco.');
  assert.deepEqual(selected.entries, [{ source_term: 'Strahlentladung', target_term: 'blast discharge' }]);
  assert.deepEqual(selected.doNotTranslate, ['Romaco']);
});

test('selectRelevantEntries excludes substring matches and irrelevant protected terms', () => {
  const selected = selectRelevantEntries({
    entries: [{ source_term: 'SAT', target_term: 'site acceptance test' }],
    doNotTranslate: ['Romaco', 'Noack'],
  }, 'Saturday at Romaco');
  assert.deepEqual(selected.entries, []);
  assert.deepEqual(selected.doNotTranslate, ['Romaco']);
});

test('protectDoNotTranslate and restore round-trip when terms are present', () => {
  const text = 'Romaco Kilian bleibt Romaco.';
  const protectedText = protectDoNotTranslate(text, ['Romaco', 'Kilian']);
  assert.notEqual(protectedText.masked, text);
  assert.equal(protectedText.restore(protectedText.masked), text);
  assert.equal(restoreDoNotTranslate(protectedText.masked, protectedText.map), text);
});

test('do-not-translate restore tolerates changed placeholder casing and separators', () => {
  const text = 'Romaco bleibt.';
  const protectedText = protectDoNotTranslate(text, ['Romaco']);
  const changedToken = protectedText.map[0].token.toLowerCase().split('').join('_');
  assert.equal(protectedText.restore(protectedText.masked.replace(protectedText.map[0].token, changedToken)), text);
});

test('do-not-translate restore falls back to source when a model drops a placeholder', () => {
  const text = 'Romaco bleibt.';
  const protectedText = protectDoNotTranslate(text, ['Romaco']);
  assert.equal(protectedText.restore('The product remains.'), text);
});

test('approved glossary translations are restored deterministically', () => {
  const protectedText = protectDoNotTranslate(
    'Die Strahlentladung startet.',
    [],
    [{ source_term: 'Strahlentladung', target_term: 'blast discharge' }],
  );
  assert.match(protectedText.masked, /TRMX/);
  assert.equal(protectedText.restore(protectedText.masked), 'Die blast discharge startet.');
});

test('protectDoNotTranslate and restore round-trip when terms are absent', () => {
  const text = 'Keine Produktnamen im Satz.';
  const protectedText = protectDoNotTranslate(text, ['Romaco']);
  assert.equal(protectedText.masked, text);
  assert.equal(protectedText.restore(protectedText.masked), text);
});

test('hashSource normalizes case and whitespace', () => {
  assert.equal(normalizeForHash('  Hallo   WELT\n'), 'hallo welt');
  assert.equal(hashSource('Hallo Welt'), hashSource('  hallo\nwelt  '));
});

test('lookupTM finds exact normalized hash with injected query store', async () => {
  const storedHash = hashSource('Hello world');
  const fakeQuery = async (sql, params) => {
    assert.match(sql, /FROM translation_memory/);
    assert.deepEqual(params, [7, 'de', 'en', storedHash]);
    return { rows: [{ target_text: 'Hello world translated' }] };
  };
  assert.equal(await lookupTM(7, 'de', 'en', '  HELLO   world ', fakeQuery), 'Hello world translated');
});

test('TM language keys normalize UI language names to shared ISO codes', async () => {
  const fakeQuery = async (_sql, params) => {
    assert.equal(params[1], 'de');
    assert.equal(params[2], 'en');
    return { rows: [] };
  };
  await lookupTM(7, 'German', 'English', 'Hallo', fakeQuery);
});

test('getGlossaryForPair scopes query by organization and normalized target language', async () => {
  const fakeQuery = async (sql, params) => {
    assert.match(sql, /organization_id = \$1/);
    assert.match(sql, /lower\(target_lang\) = \$2/);
    assert.deepEqual(params, [42, 'de-de']);
    return {
      rows: [
        { source_term: 'Romaco', do_not_translate: true, target_lang: null, target_term: null },
        { source_term: 'Granulator', do_not_translate: false, target_lang: 'de-DE', target_term: 'Granulator' },
      ],
    };
  };
  assert.deepEqual(await getGlossaryForPair(42, 'en', 'DE-de', fakeQuery), {
    entries: [{ source_term: 'Granulator', target_lang: 'de-DE', target_term: 'Granulator', tier: 'workspace' }],
    doNotTranslate: ['Romaco'],
    personalTerms: [],
  });
});

test('getGlossaryForPair workspace-only lookup filters personal rows in SQL', async () => {
  let capturedSql = '';
  let capturedParams = null;
  const fakeQuery = async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;
    return { rows: [{ source_term: 'Romaco', target_lang: null, target_term: null, do_not_translate: true, user_id: null }] };
  };
  const result = await getGlossaryForPair(1, 'de', 'en', { queryFn: fakeQuery });
  assert.match(capturedSql, /user_id IS NULL/);
  assert.equal(capturedParams.length, 2);
  assert.deepEqual(result.personalTerms, []);
  assert.deepEqual(result.doNotTranslate, ['Romaco']);
});

test('getGlossaryForPair personal lookup scopes SQL to the requesting user id', async () => {
  let capturedSql = '';
  let capturedParams = null;
  const fakeQuery = async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;
    return { rows: [] };
  };
  await getGlossaryForPair(1, 'de', 'en', { userId: 99, queryFn: fakeQuery });
  assert.match(capturedSql, /user_id IS NULL OR user_id = \$3/);
  assert.deepEqual(capturedParams, [1, 'en', 99]);
});

test('getGlossaryForPair: workspace entry wins over a conflicting personal entry', async () => {
  const rows = [
    { source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', do_not_translate: false, user_id: null },
    { source_term: 'Granulator', target_lang: 'en', target_term: 'granulating machine', do_not_translate: false, user_id: 7 },
  ];
  const result = await getGlossaryForPair(1, 'de', 'en', { userId: 7, queryFn: async () => ({ rows }) });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0], {
    source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', tier: 'workspace',
  });
  // The dropped personal entry must not count as an applied personal term.
  assert.deepEqual(result.personalTerms, []);
});

test('getGlossaryForPair: personal entry fills a gap the workspace does not cover', async () => {
  const rows = [
    { source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', do_not_translate: false, user_id: null },
    { source_term: 'Tablettenpresse', target_lang: 'en', target_term: 'tablet press', do_not_translate: false, user_id: 7 },
  ];
  const result = await getGlossaryForPair(1, 'de', 'en', { userId: 7, queryFn: async () => ({ rows }) });
  const personal = result.entries.find((entry) => entry.tier === 'personal');
  assert.equal(personal.source_term, 'Tablettenpresse');
  assert.deepEqual(result.personalTerms, ['Tablettenpresse']);
});

test('getGlossaryForPair: do-not-translate is a union; personal cannot un-mask a workspace DNT', async () => {
  const rows = [
    { source_term: 'Romaco', target_lang: null, target_term: null, do_not_translate: true, user_id: null },
    { source_term: 'Kilian', target_lang: null, target_term: null, do_not_translate: true, user_id: 7 },
    // Personal tries to translate a workspace do-not-translate term -> dropped.
    { source_term: 'Romaco', target_lang: 'en', target_term: 'Romaco Inc', do_not_translate: false, user_id: 7 },
  ];
  const result = await getGlossaryForPair(1, 'de', 'en', { userId: 7, queryFn: async () => ({ rows }) });
  assert.deepEqual([...result.doNotTranslate].sort(), ['Kilian', 'Romaco']);
  assert.equal(result.entries.some((entry) => entry.source_term === 'Romaco'), false);
  assert.ok(result.personalTerms.includes('Kilian'));
  assert.equal(result.personalTerms.includes('Romaco'), false);
});

test('getGlossaryForPair: a workspace fixed entry beats a personal do-not-translate for the same term', async () => {
  const rows = [
    { source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', do_not_translate: false, user_id: null },
    { source_term: 'Granulator', target_lang: null, target_term: null, do_not_translate: true, user_id: 7 },
  ];
  const result = await getGlossaryForPair(1, 'de', 'en', { userId: 7, queryFn: async () => ({ rows }) });
  assert.deepEqual(result.doNotTranslate, []);
  assert.equal(result.entries[0].tier, 'workspace');
  assert.deepEqual(result.personalTerms, []);
});

test('shouldSkipTMForText: personal hit skips storeTM, workspace-only hit stores', async () => {
  const rows = [
    { source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', do_not_translate: false, user_id: null },
    { source_term: 'Wirbelschicht', target_lang: 'en', target_term: 'fluid bed', do_not_translate: false, user_id: 7 },
  ];
  const glossary = await getGlossaryForPair(1, 'de', 'en', { userId: 7, queryFn: async () => ({ rows }) });
  assert.equal(shouldSkipTMForText(glossary, 'Die Wirbelschicht trocknet.'), true);
  assert.equal(shouldSkipTMForText(glossary, 'Der Granulator läuft.'), false);
  assert.equal(shouldSkipTMForText(glossary, 'Kein Fachbegriff hier.'), false);
});

test('shouldSkipTMForText is false for a workspace-only glossary (backward compatible)', () => {
  assert.equal(shouldSkipTMForText({ entries: [], doNotTranslate: [] }, 'irgendein Text'), false);
  assert.equal(shouldSkipTMForText(undefined, 'irgendein Text'), false);
});

test('selectAppliedPersonalTerms matches personal terms case-insensitively', async () => {
  const rows = [
    { source_term: 'Wirbelschicht', target_lang: 'en', target_term: 'fluid bed', do_not_translate: false, user_id: 7 },
  ];
  const glossary = await getGlossaryForPair(1, 'de', 'en', { userId: 7, queryFn: async () => ({ rows }) });
  assert.deepEqual(selectAppliedPersonalTerms(glossary, 'die WIRBELSCHICHT startet'), ['Wirbelschicht']);
  assert.deepEqual(selectAppliedPersonalTerms(glossary, 'nichts passendes'), []);
});

test('personal isolation: a userId-A merge never surfaces user B rows (SQL param carries A only)', async () => {
  // Simulates the DB honoring the WHERE clause: it only returns rows the SQL
  // asked for. We assert the query is parameterised with the caller's id.
  const store = {
    7: [{ source_term: 'AlphaOnly', target_lang: 'en', target_term: 'alpha', do_not_translate: false, user_id: 7 }],
    8: [{ source_term: 'BetaOnly', target_lang: 'en', target_term: 'beta', do_not_translate: false, user_id: 8 }],
  };
  const fakeQuery = async (_sql, params) => {
    const requestedUser = params[2];
    return { rows: store[requestedUser] || [] };
  };
  const aResult = await getGlossaryForPair(1, 'de', 'en', { userId: 7, queryFn: fakeQuery });
  const bResult = await getGlossaryForPair(1, 'de', 'en', { userId: 8, queryFn: fakeQuery });
  assert.deepEqual(aResult.personalTerms, ['AlphaOnly']);
  assert.deepEqual(bResult.personalTerms, ['BetaOnly']);
  assert.equal(aResult.entries.some((e) => e.source_term === 'BetaOnly'), false);
});

test('storeTM upserts with normalized hash using injected query store', async () => {
  let called = false;
  const fakeQuery = async (sql, params) => {
    called = true;
    assert.match(sql, /ON CONFLICT/);
    assert.equal(params[0], 7);
    assert.equal(params[1], 'de');
    assert.equal(params[2], 'en');
    assert.equal(params[3], hashSource('Hello world'));
    assert.equal(params[4], 'Hello world');
    assert.equal(params[5], 'Hallo Welt');
    return { rows: [] };
  };
  assert.equal(await storeTM(7, 'de', 'en', 'Hello world', 'Hallo Welt', fakeQuery), true);
  assert.equal(called, true);
});

test('storeTM supports auto source language and skips empty text', async () => {
  let autoParams;
  const autoQuery = async (_sql, params) => {
    autoParams = params;
    return { rows: [] };
  };
  assert.equal(await storeTM(7, 'AUTO', 'EN', 'Hello', 'Hallo', autoQuery), true);
  assert.equal(autoParams[1], 'auto');
  assert.equal(autoParams[2], 'en');

  const fakeQuery = async () => {
    throw new Error('query should not be called');
  };
  assert.equal(await storeTM(7, 'de', 'en', ' ', 'Hallo', fakeQuery), false);
});

// ---------------------------------------------------------------------------
// Translation Excellence — Stage 2: TM hygiene (verified precedence, last-used)
// ---------------------------------------------------------------------------

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test('lookupTM orders verified first and bumps last_used_at fire-and-forget', async () => {
  let selectSql = '';
  const updateCalls = [];
  const fakeQuery = async (sql, params) => {
    if (/UPDATE translation_memory/.test(sql)) {
      updateCalls.push(params);
      return { rows: [] };
    }
    selectSql = sql;
    return { rows: [{ id: 5, target_text: 'verified translation' }] };
  };
  const hit = await lookupTM(7, 'de', 'en', 'Hallo Welt', fakeQuery);
  assert.equal(hit, 'verified translation');
  assert.match(selectSql, /ORDER BY verified DESC/);
  await flushMicrotasks();
  assert.deepEqual(updateCalls, [[[5]]]);
});

test('lookupTM returns null and skips the last_used_at bump on a miss', async () => {
  const updateCalls = [];
  const fakeQuery = async (sql) => {
    if (/UPDATE translation_memory/.test(sql)) {
      updateCalls.push(true);
      return { rows: [] };
    }
    return { rows: [] };
  };
  assert.equal(await lookupTM(7, 'de', 'en', 'Hallo', fakeQuery), null);
  await flushMicrotasks();
  assert.equal(updateCalls.length, 0);
});

test('lookupTMBatch prefers the verified row per hash and bumps only the winners', async () => {
  const sourceTexts = ['Erster Satz.', 'Zweiter Satz.'];
  const [h0, h1] = sourceTexts.map((text) => hashSource(text));
  let selectSql = '';
  const updateCalls = [];
  const fakeQuery = async (sql, params) => {
    if (/UPDATE translation_memory/.test(sql)) {
      updateCalls.push(params[0]);
      return { rows: [] };
    }
    selectSql = sql;
    // DB returns verified-first (ORDER BY verified DESC); the unverified
    // duplicate for h0 must be ignored by the JS keep-first dedup.
    return {
      rows: [
        { id: 10, source_hash: h0, target_text: 'VERIFIED zero' },
        { id: 11, source_hash: h0, target_text: 'auto zero' },
        { id: 20, source_hash: h1, target_text: 'auto one' },
      ],
    };
  };
  const results = await lookupTMBatch(3, 'de', 'en', sourceTexts, fakeQuery);
  assert.deepEqual(results, ['VERIFIED zero', 'auto one']);
  assert.match(selectSql, /ORDER BY verified DESC/);
  await flushMicrotasks();
  // Winner ids only (10, 20) — never the shadowed duplicate 11.
  assert.equal(updateCalls.length, 1);
  assert.deepEqual([...updateCalls[0]].sort((a, b) => a - b), [10, 20]);
});

test('upsertVerifiedTM writes verified=true with an upsert and normalized languages', async () => {
  let capturedSql = '';
  let capturedParams = null;
  const fakeQuery = async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;
    return { rows: [] };
  };
  assert.equal(await upsertVerifiedTM(7, 'German', 'English', 'Hallo Welt', 'Hello world', fakeQuery), true);
  assert.match(capturedSql, /ON CONFLICT/);
  assert.match(capturedSql, /verified = true/);
  assert.match(capturedSql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, true, NOW\(\)\)/);
  assert.equal(capturedParams[0], 7);
  assert.equal(capturedParams[1], 'de');
  assert.equal(capturedParams[2], 'en');
  assert.equal(capturedParams[3], hashSource('Hallo Welt'));
  assert.equal(capturedParams[4], 'Hallo Welt');
  assert.equal(capturedParams[5], 'Hello world');
});

test('upsertVerifiedTM rejects empty source/target without touching the store', async () => {
  const fakeQuery = async () => {
    throw new Error('query should not be called');
  };
  assert.equal(await upsertVerifiedTM(7, 'de', 'en', '   ', 'Hello', fakeQuery), false);
  assert.equal(await upsertVerifiedTM(7, 'de', 'en', 'Hallo', '  ', fakeQuery), false);
  assert.equal(await upsertVerifiedTM(null, 'de', 'en', 'Hallo', 'Hello', fakeQuery), false);
});

test('glossary API payload validation normalizes language codes and rejects malformed input', () => {
  assert.deepEqual(normalizeGlossaryPayload({
    source_term: ' Granulator ',
    target_lang: 'DE-de',
    target_term: ' Granulator ',
  }).value, {
    sourceTerm: 'Granulator',
    targetLang: 'de-de',
    targetTerm: 'Granulator',
    doNotTranslate: false,
    notes: null,
  });
  assert.match(normalizeGlossaryPayload({ source_term: 'Term', target_lang: 'German', target_term: 'Begriff' }).error, /Sprachcode/);
  assert.match(normalizeGlossaryPayload({ source_term: 'Term', do_not_translate: 'true' }).error, /Zielsprache/);
});

// ---------------------------------------------------------------------------
// Translation Excellence — Stage 1: applied/masked metadata + DNT survival guard
// ---------------------------------------------------------------------------

// Matches the placeholder shapes minted by protectDoNotTranslate.
const DNT_TOKEN = /DNTX\d+X[0-9A-F]+XTDN/;

test('describeGlossaryApplication reports applied fixed entries with tier and masked DNT terms', () => {
  const glossary = {
    entries: [
      { source_term: 'Granulator', target_term: 'granulator', target_lang: 'en', tier: 'workspace' },
      { source_term: 'Wirbelschicht', target_term: 'fluid bed', target_lang: 'en', tier: 'personal' },
    ],
    doNotTranslate: ['Romaco'],
    personalTerms: ['Wirbelschicht'],
  };
  const result = describeGlossaryApplication(glossary, 'Der Granulator speist die Wirbelschicht bei Romaco.');
  assert.deepEqual(result.applied, [
    { source: 'Granulator', target: 'granulator', tier: 'workspace' },
    { source: 'Wirbelschicht', target: 'fluid bed', tier: 'personal' },
  ]);
  assert.deepEqual(result.masked, [{ term: 'Romaco', tier: 'workspace' }]);
});

test('describeGlossaryApplication returns nothing when no glossary term occurs in the text', () => {
  const glossary = {
    entries: [{ source_term: 'Granulator', target_term: 'granulator', target_lang: 'en', tier: 'workspace' }],
    doNotTranslate: ['Romaco'],
    personalTerms: [],
  };
  assert.deepEqual(describeGlossaryApplication(glossary, 'Ein Satz ohne Fachbegriffe.'), { applied: [], masked: [] });
});

test('reportRestore flags a dropped do-not-translate placeholder and falls back to source', () => {
  const source = 'Romaco baut Maschinen.';
  const protectedText = protectDoNotTranslate(source, ['Romaco']);
  const dropped = protectedText.masked.replace(DNT_TOKEN, 'REMOVED');
  const report = reportRestore(dropped, protectedText.map, source);
  assert.equal(report.fellBack, true);
  assert.equal(report.text, source);
  assert.equal(report.lostTokens.length, 1);
  assert.equal(report.lostTokens[0].kind, 'dnt');
});

test('reportRestore restores cleanly when every placeholder survives', () => {
  const source = 'Romaco baut Maschinen.';
  const protectedText = protectDoNotTranslate(source, ['Romaco']);
  const report = reportRestore(protectedText.masked, protectedText.map, source);
  assert.equal(report.fellBack, false);
  assert.deepEqual(report.lostTokens, []);
  assert.equal(report.text, source);
});

test('translateTextWithGlossaryGuard: happy path applies metadata without retry', async () => {
  const glossary = {
    entries: [{ source_term: 'Granulator', target_term: 'granulator', target_lang: 'en', tier: 'workspace' }],
    doNotTranslate: ['Romaco'],
    personalTerms: [],
  };
  let calls = 0;
  const result = await translateTextWithGlossaryGuard({
    text: 'Der Granulator von Romaco.',
    glossary,
    // Identity translator: every placeholder survives.
    translate: async (masked) => {
      calls += 1;
      return { translatedText: masked, usage: { prompt_tokens: 5, completion_tokens: 3 }, model: 'deepseek-v4-pro' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.retried, false);
  assert.deepEqual(result.dntViolations, []);
  assert.deepEqual(result.applied, [{ source: 'Granulator', target: 'granulator', tier: 'workspace' }]);
  assert.deepEqual(result.masked, [{ term: 'Romaco', tier: 'workspace' }]);
  // The fixed-translation placeholder restores to the TARGET term (that is
  // how protectDoNotTranslate enforces glossary translations), so the
  // identity translator still yields the target casing here.
  assert.equal(result.translatedText, 'Der granulator von Romaco.');
  assert.deepEqual(result.usage, { prompt_tokens: 5, completion_tokens: 3 });
});

test('translateTextWithGlossaryGuard: retries once with strict prompt and recovers', async () => {
  const glossary = { entries: [], doNotTranslate: ['Romaco'], personalTerms: [] };
  const strictFlags = [];
  const result = await translateTextWithGlossaryGuard({
    text: 'Romaco bleibt Romaco.',
    glossary,
    translate: async (masked, { strict }) => {
      strictFlags.push(strict);
      // First (non-strict) attempt drops the placeholder; strict retry keeps it.
      const translatedText = strict ? masked : masked.replace(DNT_TOKEN, 'GONE');
      return { translatedText, usage: { prompt_tokens: 2 }, model: 'm' };
    },
  });
  assert.deepEqual(strictFlags, [false, true]);
  assert.equal(result.retried, true);
  assert.deepEqual(result.dntViolations, []);
  assert.equal(result.translatedText, 'Romaco bleibt Romaco.');
  // Usage is summed across both attempts.
  assert.equal(result.usage.prompt_tokens, 4);
});

test('translateTextWithGlossaryGuard: flags a violation when the retry also drops the placeholder', async () => {
  const glossary = { entries: [], doNotTranslate: ['Romaco'], personalTerms: [] };
  let calls = 0;
  const result = await translateTextWithGlossaryGuard({
    text: 'Romaco bleibt.',
    glossary,
    translate: async (masked) => {
      calls += 1;
      return { translatedText: masked.replace(DNT_TOKEN, 'GONE'), usage: {}, model: 'm' };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.retried, true);
  assert.deepEqual(result.dntViolations, [{ term: 'Romaco' }]);
  // Falls back to source so the protected term is never mistranslated.
  assert.equal(result.translatedText, 'Romaco bleibt.');
});

test('translateSegmentsWithGlossaryGuard: retries only the segment that lost a placeholder', async () => {
  const glossary = { entries: [], doNotTranslate: ['Romaco'], personalTerms: [] };
  const batchSizes = [];
  const result = await translateSegmentsWithGlossaryGuard({
    texts: ['Romaco eins.', 'Kein Fachbegriff hier.'],
    glossary,
    translateSegments: async (masked, { strict }) => {
      batchSizes.push({ size: masked.length, strict });
      const translations = masked.map((entry) => (strict ? entry : entry.replace(DNT_TOKEN, 'X')));
      return { translations, usage: { prompt_tokens: masked.length }, model: 'm' };
    },
  });
  // First call sees both segments; the stricter retry re-sends only segment 0.
  assert.deepEqual(batchSizes, [{ size: 2, strict: false }, { size: 1, strict: true }]);
  assert.equal(result.perSegment[0].retried, true);
  assert.equal(result.perSegment[1].retried, false);
  assert.deepEqual(result.perSegment[0].dntViolations, []);
  assert.equal(result.perSegment[0].masked.length, 1);
  assert.deepEqual(result.translations, ['Romaco eins.', 'Kein Fachbegriff hier.']);
});

test('aggregateSegmentMetadata dedupes applied/masked/violations and counts retries', () => {
  const aggregated = aggregateSegmentMetadata([
    {
      applied: [{ source: 'Granulator', target: 'granulator', tier: 'workspace' }],
      masked: [{ term: 'Romaco', tier: 'workspace' }],
      dntViolations: [],
      retried: false,
    },
    {
      applied: [{ source: 'Granulator', target: 'granulator', tier: 'workspace' }],
      masked: [{ term: 'Romaco', tier: 'workspace' }, { term: 'Kilian', tier: 'personal' }],
      dntViolations: [{ term: 'Kilian' }],
      retried: true,
    },
  ]);
  assert.equal(aggregated.applied.length, 1);
  assert.deepEqual(aggregated.masked.map((entry) => entry.term).sort(), ['Kilian', 'Romaco']);
  assert.deepEqual(aggregated.dntViolations, [{ term: 'Kilian' }]);
  assert.equal(aggregated.retriedSegments, 1);
});
