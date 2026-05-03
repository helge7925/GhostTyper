import { enforceRateLimit, logApiError, serverError } from '../../../../../lib/api-utils';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { logAuditEvent } from '../../../../../lib/audit-log';
import { resolveVexaConfig } from '../../../../../lib/integrations';
import { adminHealthCheck } from '../../../../../lib/api/vexa';

const PROVIDER = 'vexa';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.admin')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-integrations-vexa-test',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    // resolveVexaConfig pulls from DB first, then falls back to operator
    // ENV (VEXA_BASE_URL, VEXA_ADMIN_API_TOKEN) — same logic the actual
    // bot-start path uses, so the test reflects production behaviour.
    const integration = await resolveVexaConfig(orgId);
    const baseUrl = integration.config?.baseUrl;
    const adminToken = integration.config?.adminToken;
    if (!baseUrl || !adminToken) {
      return res.status(400).json({
        code: 'INTEGRATION_INCOMPLETE',
        message: 'Bitte erst Base-URL und Admin-Token speichern, bevor der Verbindungstest läuft.',
      });
    }
    const result = await adminHealthCheck({ baseUrl, adminToken });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.vexa.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      metadata: { ok: true },
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'org.integration.vexa.tested',
      targetType: 'organization_integration',
      targetId: `${orgId}:${PROVIDER}`,
      severity: 'warn',
      metadata: { ok: false, message: error.message },
    });
    logApiError('Vexa health check failed', error);
    return res.status(502).json({ code: 'VEXA_UNREACHABLE', message: error.message || 'Verbindungstest fehlgeschlagen.' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
