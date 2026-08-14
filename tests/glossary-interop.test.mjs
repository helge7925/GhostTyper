import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOSSARY_CSV_COLUMNS,
  glossaryToCsv,
  glossaryToTbx,
  parseGlossaryCsv,
} from '../lib/glossary-interop.js';
import { normalizeGlossaryPayload } from '../lib/translation-glossary-validation.js';

test('glossaryToCsv emits the fixed header and blanks target fields for DNT rows', () => {
  const csv = glossaryToCsv([
    { source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', do_not_translate: false, notes: 'Maschine' },
    { source_term: 'Romaco', target_lang: null, target_term: null, do_not_translate: true, notes: '' },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], GLOSSARY_CSV_COLUMNS.join(','));
  assert.equal(lines[1], 'Granulator,en,granulator,false,Maschine');
  assert.equal(lines[2], 'Romaco,,,true,');
});

test('CSV round-trips values containing commas, quotes and newlines', () => {
  const entries = [
    { source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', do_not_translate: false, notes: 'Maschine' },
    { source_term: 'Romaco', target_lang: null, target_term: null, do_not_translate: true, notes: '' },
    { source_term: 'Wert, mit Komma', target_lang: 'en', target_term: 'value "quoted"', do_not_translate: false, notes: 'Zeile1\nZeile2' },
  ];
  const { rows } = parseGlossaryCsv(glossaryToCsv(entries));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].data, {
    source_term: 'Granulator', target_lang: 'en', target_term: 'granulator', do_not_translate: false, notes: 'Maschine',
  });
  assert.deepEqual(rows[1].data, {
    source_term: 'Romaco', target_lang: '', target_term: '', do_not_translate: true, notes: '',
  });
  assert.deepEqual(rows[2].data, {
    source_term: 'Wert, mit Komma', target_lang: 'en', target_term: 'value "quoted"', do_not_translate: false, notes: 'Zeile1\nZeile2',
  });
  // Line numbers point past the header row (header = line 1).
  assert.deepEqual(rows.map((row) => row.line), [2, 3, 4]);
});

test('parseGlossaryCsv maps by header name regardless of column order', () => {
  const { rows } = parseGlossaryCsv('notes,source_term,do_not_translate,target_term,target_lang\nHinweis,Bar,false,bar,en');
  assert.deepEqual(rows[0].data, {
    source_term: 'Bar', target_lang: 'en', target_term: 'bar', do_not_translate: false, notes: 'Hinweis',
  });
});

test('parseGlossaryCsv assumes the fixed column order when no header is present', () => {
  const { rows } = parseGlossaryCsv('Foo,en,foo,false,note');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line, 1);
  assert.equal(rows[0].data.source_term, 'Foo');
  assert.equal(rows[0].data.target_term, 'foo');
});

test('parseGlossaryCsv reads common truthy spellings of do_not_translate and skips blank lines', () => {
  const { rows } = parseGlossaryCsv('source_term,target_lang,target_term,do_not_translate,notes\nRomaco,,,JA,\n\nKilian,,,1,\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].data.do_not_translate, true);
  assert.equal(rows[1].data.do_not_translate, true);
});

test('parsed rows feed straight into normalizeGlossaryPayload for per-row validation', () => {
  const { rows } = parseGlossaryCsv('source_term,target_lang,target_term,do_not_translate,notes\nGranulator,en,granulator,false,\n,,,false,orphan');
  const first = normalizeGlossaryPayload(rows[0].data);
  assert.equal(first.error, undefined);
  assert.equal(first.value.sourceTerm, 'Granulator');
  // Second row has no source term -> validation error, import would skip it.
  const second = normalizeGlossaryPayload(rows[1].data);
  assert.match(second.error, /Ausgangsbegriff/);
});

test('glossaryToTbx emits well-formed TBX-Basic with escaping and DNT termNotes', () => {
  const xml = glossaryToTbx([
    { source_term: 'A & B <x>', target_lang: 'en', target_term: 'a and b', do_not_translate: false, notes: '' },
    { source_term: 'Romaco', target_lang: null, target_term: null, do_not_translate: true, notes: 'Marke' },
  ], { sourceLang: 'de', scopeLabel: 'workspace' });

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<martif type="TBX-Basic"/);
  assert.equal((xml.match(/<termEntry /g) || []).length, 2);
  assert.equal((xml.match(/<\/termEntry>/g) || []).length, 2);
  // XML special characters are escaped.
  assert.match(xml, /A &amp; B &lt;x&gt;/);
  assert.ok(!/A & B <x>/.test(xml));
  // Fixed entry has two langSets; DNT entry carries a doNotTranslate termNote.
  assert.match(xml, /xml:lang="de"[\s\S]*?xml:lang="en"/);
  assert.match(xml, /<termNote type="termType">doNotTranslate<\/termNote>/);
  // Balanced langSet tags overall (2 for the fixed entry + 1 for the DNT entry).
  assert.equal((xml.match(/<langSet /g) || []).length, 3);
  assert.equal((xml.match(/<\/langSet>/g) || []).length, 3);
});
