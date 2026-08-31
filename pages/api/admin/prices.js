import { requireAdmin } from '../../../lib/admin';
import { query } from '../../../lib/db';
import { createPriceVersion, withPricingTransaction } from '../../../lib/pricing-service';
import { logAuditEvent } from '../../../lib/audit-log';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';

export default async function handler(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'admin-prices', identifier: `admin:${session.user.id}`, limit: 60, windowMs: 60_000,
  });
  if (!allowed) return;
  try {
    if (req.method === 'GET') {
      const result = await query(
        `SELECT * FROM provider_price_versions
          ORDER BY provider, model, operation, effective_from DESC`,
      );
      return res.status(200).json({ prices: result.rows });
    }
    if (req.method === 'POST') {
      const reason = String(req.body?.reason || '').trim();
      if (!reason || reason.length > 500) {
        return res.status(400).json({ code: 'INVALID_PRICE', message: 'A change reason is required.' });
      }
      const price = await withPricingTransaction(async (client) => {
        const created = await createPriceVersion(req.body, session.user.id, { client });
        await logAuditEvent({
          userId: session.user.id,
          action: 'pricing.catalog.version_created',
          targetType: 'provider_price_version',
          targetId: String(created.id),
          reason,
          metadata: {
            provider: created.provider, model: created.model, operation: created.operation,
            effectiveFrom: created.effective_from,
          },
          client,
          required: true,
        });
        return created;
      });
      return res.status(201).json({ price });
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (['INVALID_PRICE', 'PRICE_VERSION_OVERLAP'].includes(error?.code)) {
      return res.status(400).json({ code: error.code, message: error.message });
    }
    logApiError('Platform pricing API failed', error);
    return res.status(500).json({ code: 'PRICING_API_FAILED', message: 'Pricing catalog could not be processed.' });
  }
}
