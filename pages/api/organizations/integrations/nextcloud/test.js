import { enforceRateLimit, logApiError, serverError } from '../../../../../lib/api-utils';
import { withOrgScope } from '../../../../../lib/api/with-org-scope';
import { hasPermission } from '../../../../../lib/permissions';
import { resolveNextcloudConfig } from '../../../../../lib/integrations';
import { testConnection } from '../../../../../lib/api/nextcloud';

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
    keyPrefix: 'org-integrations-nextcloud-test',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const cfg = await resolveNextcloudConfig(orgId);
    if (!cfg.baseUrl || !cfg.username || !cfg.appPassword) {
      return res.status(400).json({ ok: false, message: 'Bitte URL, Benutzer und App-Passwort speichern, bevor du testest.' });
    }
    await testConnection(cfg);
    return res.status(200).json({ ok: true });
  } catch (error) {
    logApiError('Nextcloud test failed', error);
    const status = error?.status;
    const message = status === 401
      ? 'Anmeldung fehlgeschlagen (Benutzer oder App-Passwort falsch).'
      : 'Verbindung zu Nextcloud fehlgeschlagen. Bitte URL und Zugangsdaten prüfen.';
    return res.status(200).json({ ok: false, message });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
