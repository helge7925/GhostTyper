import path from 'path';
import { statfs } from 'fs/promises';
import { query } from '../../lib/db';
import { getObservabilitySnapshot, trackSecurityEvent } from '../../lib/observability';
import { ensureTranscriptionWorkerRunning } from '../../lib/transcription-worker';
import { ensureVexaReconcileWorkerRunning } from '../../lib/vexa-reconcile-worker';
import { enforceRateLimit } from '../../lib/api-utils';
import { isMaintenanceRequestAllowed } from '../../lib/network-guard';
import { normalizeSingleHeaderValue, timingSafeEqualString } from '../../lib/security';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
// Uploads are capped at MAX_FILE_SIZE (500 MB) each, and a transcription
// writes converted and chunked copies alongside the original, so "a few
// hundred MB free" is already the danger zone rather than a comfortable
// margin. Tunable because a deployment that keeps uploads on a large
// dedicated volume will want a different line.
const LOW_DISK_BYTES = Number.parseInt(process.env.HEALTH_LOW_DISK_BYTES, 10) || 5 * 1024 * 1024 * 1024;

/**
 * Free space on the volume that holds uploads.
 *
 * A full disk does not look like an outage from the database's point of view —
 * the app keeps answering, and transcriptions fail one by one as ffmpeg and
 * the temp writer run out of room. Checking only `SELECT 1` meant that state
 * was invisible until users reported it.
 */
async function inspectUploadStorage() {
  try {
    const stats = await statfs(UPLOADS_DIR);
    const availableBytes = stats.bavail * stats.bsize;
    return {
      path: UPLOADS_DIR,
      availableBytes,
      totalBytes: stats.blocks * stats.bsize,
      state: availableBytes < LOW_DISK_BYTES ? 'low' : 'ok',
    };
  } catch (error) {
    // Reported rather than thrown: the directory being absent on a fresh
    // install is not a reason for the health endpoint itself to fail.
    return {
      path: UPLOADS_DIR,
      state: error?.code === 'ENOENT' ? 'missing' : 'unavailable',
    };
  }
}

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
    // Detail-gated like everything else here: free space is operational
    // information, and the same secret/ACL that guards the counters guards it.
    // It deliberately does not flip the HTTP status — a full disk is a real
    // problem, but taking the instance out of a load balancer for it would
    // stop requests the app can still serve. Monitors alert on `state`.
    payload.storage = await inspectUploadStorage();
    payload.observability = {
      counters: observability.counters,
      worker: observability.worker,
      db: observability.db,
    };
  }

  res.status(healthy ? 200 : 503).json(payload);
}
