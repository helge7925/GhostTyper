import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SENTENCE_TERMINATORS,
  splitIntoSentenceUnits,
  fragmentCharLength,
} from '../lib/sentence-buffer.js';

// ---- SENTENCE_TERMINATORS regex ----

test('SENTENCE_TERMINATORS matches a single trailing period', () => {
  assert.equal(SENTENCE_TERMINATORS.test('Das war es.'), true);
});

test('SENTENCE_TERMINATORS matches exclamation, question, ellipsis', () => {
  assert.equal(SENTENCE_TERMINATORS.test('Hallo!'), true);
  assert.equal(SENTENCE_TERMINATORS.test('Wirklich?'), true);
  assert.equal(SENTENCE_TERMINATORS.test('Naja…'), true);
});

test('SENTENCE_TERMINATORS matches CJK fullstop + exclamation/question', () => {
  assert.equal(SENTENCE_TERMINATORS.test('こんにちは。'), true);
  assert.equal(SENTENCE_TERMINATORS.test('本当！'), true);
  assert.equal(SENTENCE_TERMINATORS.test('そうですか？'), true);
});

test('SENTENCE_TERMINATORS tolerates trailing quote/paren closers', () => {
  assert.equal(SENTENCE_TERMINATORS.test('"Bye."'), true);
  assert.equal(SENTENCE_TERMINATORS.test('(siehe oben.)'), true);
  assert.equal(SENTENCE_TERMINATORS.test('»Klar.«'), true);
});

test('SENTENCE_TERMINATORS rejects mid-sentence commas and dashes', () => {
  assert.equal(SENTENCE_TERMINATORS.test('und dann sagte er,'), false);
  assert.equal(SENTENCE_TERMINATORS.test('na ja —'), false);
  assert.equal(SENTENCE_TERMINATORS.test('moment mal'), false);
});

test('SENTENCE_TERMINATORS rejects empty / whitespace-only strings', () => {
  assert.equal(SENTENCE_TERMINATORS.test(''), false);
  assert.equal(SENTENCE_TERMINATORS.test('   '), false);
});

// ---- splitIntoSentenceUnits ----

const seg = (text) => ({ text });

test('splitIntoSentenceUnits returns empty/empty for no input', () => {
  const r = splitIntoSentenceUnits([]);
  assert.deepEqual(r.complete, []);
  assert.deepEqual(r.trailing, []);
});

test('splitIntoSentenceUnits puts a fragment-only run into trailing', () => {
  const segs = [seg('Hallo'), seg('zusammen')];
  const r = splitIntoSentenceUnits(segs);
  assert.equal(r.complete.length, 0);
  assert.deepEqual(r.trailing, segs);
});

test('splitIntoSentenceUnits groups consecutive fragments into ONE unit per sentence', () => {
  // STT chops "Hallo zusammen, wie geht es euch heute?" across 3 segments
  // — the unit closes only when the question mark arrives.
  const segs = [
    seg('Hallo zusammen,'),
    seg('wie geht es euch'),
    seg('heute?'),
  ];
  const r = splitIntoSentenceUnits(segs);
  assert.equal(r.complete.length, 1);
  assert.equal(r.complete[0].length, 3);
  assert.deepEqual(r.trailing, []);
});

test('splitIntoSentenceUnits splits into multiple units at each terminator', () => {
  const segs = [
    seg('Erster Satz.'),
    seg('Zweiter Satz!'),
    seg('Und dritter…'),
  ];
  const r = splitIntoSentenceUnits(segs);
  assert.equal(r.complete.length, 3);
  assert.equal(r.complete[0][0].text, 'Erster Satz.');
  assert.equal(r.complete[1][0].text, 'Zweiter Satz!');
  assert.equal(r.complete[2][0].text, 'Und dritter…');
  assert.deepEqual(r.trailing, []);
});

test('splitIntoSentenceUnits separates a completed sentence from a trailing fragment', () => {
  const segs = [
    seg('Das war kurz.'),
    seg('Aber jetzt'),
    seg('kommt noch'),
  ];
  const r = splitIntoSentenceUnits(segs);
  assert.equal(r.complete.length, 1);
  assert.equal(r.complete[0][0].text, 'Das war kurz.');
  assert.equal(r.trailing.length, 2);
  assert.equal(r.trailing[0].text, 'Aber jetzt');
  assert.equal(r.trailing[1].text, 'kommt noch');
});

test('splitIntoSentenceUnits tolerates segments without text field', () => {
  const segs = [{ text: 'Hi.' }, {}, { text: null }, { text: 'Da!' }];
  const r = splitIntoSentenceUnits(segs);
  // Two terminators → two units; the empty-text segments get attached
  // to the unit they fall inside (after the first period, before the
  // next terminator).
  assert.equal(r.complete.length, 2);
});

test('splitIntoSentenceUnits is stable: each segment object appears exactly once across complete+trailing', () => {
  const segs = [seg('A.'), seg('B'), seg('C.'), seg('D')];
  const r = splitIntoSentenceUnits(segs);
  const seen = new Set();
  for (const unit of r.complete) for (const s of unit) seen.add(s);
  for (const s of r.trailing) seen.add(s);
  assert.equal(seen.size, segs.length);
});

// ---- fragmentCharLength ----

test('fragmentCharLength sums text lengths', () => {
  assert.equal(fragmentCharLength([]), 0);
  assert.equal(fragmentCharLength([seg('abc')]), 3);
  assert.equal(fragmentCharLength([seg('abc'), seg('de')]), 5);
});

test('fragmentCharLength tolerates missing/null text fields', () => {
  assert.equal(fragmentCharLength([{ text: null }, seg('abc'), {}]), 3);
});
