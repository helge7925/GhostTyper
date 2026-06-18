import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { resolveCortecsConfig } from '../../../../lib/settings-service';
import { indexDocument } from '../../../../lib/document-index';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const documentId = Number.parseInt(String(req.query.id || ''), 10);
  if (!Number.isFinite(documentId)) {
    return res.status(400).json({ message: 'Ungültige Datei-ID' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'documents-reindex',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const cortecs = await resolveCortecsConfig({ userId, organizationId: orgId });
    if (!cortecs.apiKey) {
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }

    const result = await indexDocument({ documentId, organizationId: orgId, userId, cortecs });
    return res.status(200).json(result);
  } catch (error) {
    if (error?.code === 'DOCUMENT_NOT_FOUND') {
      return res.status(404).json({ message: 'Datei nicht gefunden' });
    }
    logApiError('Document reindex error', error);
    return serverError(res, 'Datei konnte nicht indexiert werden.');
  }
}

export default withOrgScope({ permission: 'document.write' }, handler);
