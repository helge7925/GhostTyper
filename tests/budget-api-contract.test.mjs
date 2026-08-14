import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('personal settings reject budget writes and organization usage is admin scoped', () => {
  const settings = source('../pages/api/settings.js');
  const orgUsage = source('../pages/api/organizations/usage.js');
  assert.match(settings, /BUDGET_MANAGED_BY_WORKSPACE/);
  assert.doesNotMatch(settings, /addUpdate\([^\n]+['"]cost_limit['"]/);
  assert.match(orgUsage, /permission: 'budget\.read\.org'/);
});

test('budget and pricing mutations use dedicated authority checks', () => {
  const budgets = source('../pages/api/organizations/budgets.js');
  const organizationPricing = source('../pages/api/organizations/pricing.js');
  const globalPricing = source('../pages/api/admin/prices.js');
  assert.match(budgets, /hasPermission\(req\.role, 'budget\.manage'\)/);
  assert.match(organizationPricing, /hasPermission\(req\.role, 'pricing\.override'\)/);
  assert.match(globalPricing, /requireAdmin\(req, res\)/);
  assert.match(budgets, /requestEmergencyBudgetStop/);
  assert.match(budgets, /req\.method === 'POST'/);
});

test('pricing mutations commit only with their required audit event', () => {
  const organizationPricing = source('../pages/api/organizations/pricing.js');
  const globalPricing = source('../pages/api/admin/prices.js');
  for (const body of [organizationPricing, globalPricing]) {
    assert.match(body, /withPricingTransaction\(async \(client\) =>/);
    assert.match(body, /logAuditEvent\(\{/);
    assert.match(body, /client,/);
    assert.match(body, /required: true/);
  }
  const audit = source('../lib/audit-log.js');
  assert.match(audit, /if \(required && auditError\) throw auditError/);
});

test('Cortecs connectivity test uses a non-billable model listing request', () => {
  const integrationTest = source('../pages/api/organizations/integrations/cortecs/test.js');
  assert.match(integrationTest, /`\$\{config\.baseUrl\}\/models`/);
  assert.match(integrationTest, /method: 'GET'/);
  assert.doesNotMatch(integrationTest, /chat\/completions|messages\s*:|Healthcheck/);
});

test('budget stop is durable, visible, and distinguishes member from workspace blocking', () => {
  const service = source('../lib/budget-service.js');
  const status = source('../components/StatusBadge.js');
  const detail = source('../pages/transcriptions/[id].js');
  assert.match(service, /period\?\.state === 'blocked'/);
  assert.match(service, /export async function requestEmergencyBudgetStop/);
  assert.match(service, /status = 'budget_stopped'/);
  assert.match(status, /STATUS\.BUDGET_STOPPED/);
  assert.match(detail, /budgetStoppedTitle/);
});

test('self usage endpoint delegates to the privacy-preserving self service', () => {
  const selfUsage = source('../pages/api/usage/me.js');
  assert.match(selfUsage, /getSelfUsage\(req\.org\.id, req\.userId\)/);
  assert.match(selfUsage, /permission: 'budget\.read\.self'/);
});
