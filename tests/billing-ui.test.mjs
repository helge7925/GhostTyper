import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetEurosToMicros, eurosToMicros, microsToEuros } from '../lib/billing-ui.js';

test('billing UI conversions preserve integer micro-euros', () => {
  assert.equal(eurosToMicros('1.553'), 1_553_000);
  assert.equal(microsToEuros(1_553_000), 1.553);
  assert.equal(eurosToMicros('', { nullable: true }), null);
});

test('budget input is rounded to whole cents for the budget contract', () => {
  assert.equal(budgetEurosToMicros('12.34'), 12_340_000);
  assert.equal(budgetEurosToMicros(''), null);
  assert.throws(() => budgetEurosToMicros('0'));
});
