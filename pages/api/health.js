import { query } from '../../lib/db';
import { getObservabilitySnapshot, trackSecurityEvent } from '../../lib/observability';
import { ensureTranscriptionWorkerRunning } from '../../lib/transcription-worker';
import { ensureVexaReconcileWorkerRunning } from '../../lib/vexa-reconcile-worker';
import { enforceRateLimit } from '../../lib/api-utils';
import { isMaintenanceRequestAllowed } from '../../lib/network-guard';
import { normalizeSingleHeaderValue, timingSafeEqualString } from '../../lib/security';

function shouldIncludeDetailedHealth(req) {
  const requestSecret = normalizeSingleHeaderValue(req.headers['x-health-secret']);
  const detailAttempted = process.env.HEALTH_DETAILS_PUBLIC === 'true' || Boolean(requestSecret);

  if (!isMaintenanceRequestAllowed(req)) {
    if (detailAttempted) {
      trackSecurityEvent('health_details_denied', {
        route: '/api/health',
        reason: 'network_acl',
      });
    }
    return false;
  }

  if (process.env.HEALTH_DETAILS_PUBLIC === 'true') {
    return true;
  }

  const configuredSecret = process.env.HEALTH_DETAILS_SECRET;
  if (!configuredSecret) {
    return false;
  }

  if (!requestSecret) {
    return false;
  }

  const validSecret = timingSafeEqualString(requestSecret, configuredSecret);
  if (!validSecret) {
    trackSecurityEvent('health_details_denied', {
      route: '/api/health',
      reason: 'invalid_secret',
    });
  }
  return validSecret;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'health',
    limit: 180,
    windowMs: 60_000,
  }, 'Zu viele Healthchecks. Bitte später erneut versuchen.');
  if (!allowed) return;

  ensureTranscriptionWorkerRunning();
  ensureVexaReconcileWorkerRunning();

  let dbStatus = 'unknown';

  try {
    await query('SELECT 1');
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  const healthy = dbStatus === 'connected';
  const includeDetails = shouldIncludeDetailedHealth(req);
  const payload = {
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'transkription-webapp',
  };

  if (includeDetails) {
    const observability = getObservabilitySnapshot();
    payload.database = dbStatus;
    payload.observability = {
      counters: observability.counters,
      worker: observability.worker,
      db: observability.db,
    };
  }

  res.status(healthy ? 200 : 503).json(payload);
}
