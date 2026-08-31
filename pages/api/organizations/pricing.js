import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { createOrganizationPriceOverride, withPricingTransaction } from '../../../lib/pricing-service';
import { logAuditEvent } from '../../../lib/audit-log';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';

async function listEffectivePrices(organizationId) {
  const [effective, overrides] = await Promise.all([
    query(
      `SELECT p.id AS price_version_id, p.provider, p.model, p.operation, p.currency,
            p.input_unit, p.output_unit, p.effective_from, p.effective_until,
            o.id AS price_override_id,
            COALESCE(o.input_price_per_million_micros, p.input_price_per_million_micros) AS input_price_per_million_micros,
            COALESCE(o.cached_input_price_per_million_micros, p.cached_input_price_per_million_micros) AS cached_input_price_per_million_micros,
            COALESCE(o.cache_write_price_per_million_micros, p.cache_write_price_per_million_micros) AS cache_write_price_per_million_micros,
            COALESCE(o.output_price_per_million_micros, p.output_price_per_million_micros) AS output_price_per_million_micros,
            o.reason AS override_reason, o.effective_from AS override_effective_from,
            o.effective_until AS override_effective_until
       FROM provider_price_versions p
       LEFT JOIN LATERAL (
         SELECT * FROM organization_price_overrides candidate
          WHERE candidate.organization_id = $1
            AND candidate.provider_price_version_id = p.id
            AND candidate.effective_from <= NOW()
            AND (candidate.effective_until IS NULL OR candidate.effective_until > NOW())
          ORDER BY candidate.effective_from DESC LIMIT 1
       ) o ON true
      WHERE p.effective_from <= NOW() AND (p.effective_until IS NULL OR p.effective_until > NOW())
       ORDER BY p.provider, p.model, p.operation`,
      [organizationId],
    ),
    query(
      `SELECT o.*, p.provider, p.model, p.operation, p.currency, p.input_unit, p.output_unit
         FROM organization_price_overrides o
         JOIN provider_price_versions p ON p.id = o.provider_price_version_id
        WHERE o.organization_id = $1
        ORDER BY o.effective_from DESC`,
      [organizationId],
    ),
  ]);
  return { prices: effective.rows, overrides: overrides.rows };
}

async function handler(req, res) {
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-pricing', identifier: `org:${req.org.id}:user:${req.userId}`,
    limit: 60, windowMs: 60_000,
  });
  if (!allowed) return;
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await listEffectivePrices(req.org.id));
    }
    if (req.method === 'POST') {
      if (!hasPermission(req.role, 'pricing.override')) {
        return res.status(403).json({ code: 'FORBIDDEN', permission: 'pricing.override' });
      }
      const override = await withPricingTransaction(async (client) => {
        const created = await createOrganizationPriceOverride(req.body || {}, req.userId, req.org.id, { client });
        await logAuditEvent({
          userId: req.userId,
          organizationId: req.org.id,
          action: 'pricing.organization_override_created',
          targetType: 'organization_price_override',
          targetId: String(created.id),
          reason: created.reason,
          metadata: { providerPriceVersionId: created.provider_price_version_id, effectiveFrom: created.effective_from },
          client,
          required: true,
        });
        return created;
      });
      return res.status(201).json({ override });
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (['INVALID_PRICE_OVERRIDE', 'PRICE_VERSION_NOT_FOUND', 'PRICE_OVERRIDE_OVERLAP'].includes(error?.code)) {
      return res.status(error.code === 'PRICE_VERSION_NOT_FOUND' ? 404 : 400).json({ code: error.code, message: error.message });
    }
    logApiError('Organization pricing API failed', error);
    return serverError(res, 'Workspace pricing could not be processed.');
  }
}

export default withOrgScope({ permission: 'budget.read.org' }, handler);
