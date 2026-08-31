import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('normal-user surfaces use only the self-usage contract', () => {
  const dashboard = source('../pages/index.js');
  const settings = source('../pages/settings.js');
  const personalCard = source('../components/PersonalBudgetCard.js');
  assert.doesNotMatch(dashboard, /organizations\/usage|byOperation|byMember/);
  assert.doesNotMatch(settings, /costLimit|memberMonthlyBudgetLimit|PRICE_LIST/);
  assert.match(personalCard, /fetch\('\/api\/usage\/me'\)/);
  assert.doesNotMatch(personalCard, /memberLimitMicros|workspaceLimitMicros|byMember/);
});

test('legacy workspace preference and member editors no longer expose budgets or costs', () => {
  const preferences = source('../pages/settings/organization/preferences.js');
  const integrations = source('../pages/settings/organization/integrations.js');
  const members = source('../pages/settings/organization/members.js');
  assert.doesNotMatch(preferences, /costLimit|memberMonthlyBudget|cost_limit_cents/);
  assert.doesNotMatch(integrations, /costLimit|memberMonthlyBudget|costLimits/);
  assert.doesNotMatch(members, /month_cost|personal_cost_limit|personalMemberBudget/);
});

test('dedicated administration pages declare explicit permission gates', () => {
  const budgets = source('../pages/settings/organization/budgets.js');
  const pricing = source('../pages/settings/organization/pricing.js');
  const catalog = source('../pages/admin/prices.js');
  assert.match(budgets, /usePermission\('budget\.manage'\)/);
  assert.match(pricing, /usePermission\('budget\.read\.org'\)/);
  assert.match(pricing, /usePermission\('pricing\.override'\)/);
  assert.match(catalog, /session\?\.user\?\.role !== 'admin'/);
});
