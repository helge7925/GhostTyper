import { withOrgScope } from '../../lib/api/with-org-scope';
import { hasPermission } from '../../lib/permissions';
import { getOpenRouterCatalogue, modelsForCapability, OPENROUTER_CAPABILITIES } from '../../lib/openrouter';
import { resolveOpenRouterConfig } from '../../lib/settings-service';
import { normalizeCataloguePrice } from '../../lib/openrouter-pricing-core';

async function handleOpenRouter(req, res, { capability, scope }) {
  const config = await resolveOpenRouterConfig({
    userId: req.userId,
    organizationId: req.org.id,
    includeDisabled: scope === 'catalog',
  });
  if (!config.apiKey) return res.status(409).json({ code: 'OPENROUTER_NOT_CONFIGURED', models: [] });
  const catalogue = await getOpenRouterCatalogue({ apiKey: config.apiKey, organizationId: req.org.id, allowStale: true });
  let models = modelsForCapability(catalogue.models, capability);
  if (scope === 'allowed') {
    const allow = new Set(config.allowedModels[capability] || []);
    models = models.filter((model) => allow.has(model.id));
  }
  models = models.map((model) => ({
    ...model,
    priceAvailable: Boolean(normalizeCataloguePrice(model, capability)),
  }));
  return res.status(200).json({ capability, scope, models, defaultModel: config.defaultModels[capability] || null, fetchedAt: new Date(catalogue.fetchedAt).toISOString(), stale: catalogue.stale });
}

// EdenAI has no catalogue-browsing route (see hardcode-edenai-models) —
// its models are hardcoded per capability (lib/edenai.js's
// EDENAI_HARDCODED_MODEL), not admin-selected from a live list, so
// there's nothing for this endpoint to serve for provider=edenai.
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  const provider = String(req.query.provider || 'openrouter');
  if (provider !== 'openrouter') return res.status(400).json({ code: 'INVALID_PROVIDER' });
  const capability = String(req.query.capability || 'chat');
  const scope = String(req.query.scope || 'allowed');
  if (!OPENROUTER_CAPABILITIES.includes(capability)) return res.status(400).json({ code: 'INVALID_CAPABILITY' });
  if (!['allowed', 'catalog'].includes(scope)) return res.status(400).json({ code: 'INVALID_SCOPE' });
  if (scope === 'catalog' && !hasPermission(req.role, 'meeting.admin')) return res.status(403).json({ code: 'FORBIDDEN' });
  return handleOpenRouter(req, res, { capability, scope });
}

export default withOrgScope({ permission: 'org.read' }, handler);
