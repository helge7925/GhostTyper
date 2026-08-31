import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetUsdToMicros, usdToMicros, microsToUsd } from '../lib/billing-ui.js';

test('billing UI conversions preserve integer micro-dollars', () => {
  assert.equal(usdToMicros('1.553'), 1_553_000);
  assert.equal(microsToUsd(1_553_000), 1.553);
  assert.equal(usdToMicros('', { nullable: true }), null);
});

test('budget input is rounded to whole cents for the budget contract', () => {
  assert.equal(budgetUsdToMicros('12.34'), 12_340_000);
  assert.equal(budgetUsdToMicros(''), null);
  assert.throws(() => budgetUsdToMicros('0'));
});
