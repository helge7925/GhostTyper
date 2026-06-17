import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { resolveCortecsConfig } from '../../../lib/settings-service';
import { retrieveDocumentSources, retrieveKnowledgeSources } from '../../../lib/document-index';
import { getKnowledgeBase } from '../../../lib/knowledge';

const MAX_QUERY_LENGTH = 2000;
const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 20;
const MAX_DOCUMENT_IDS = 100;

function clampTopK(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TOP_K;
  return Math.min(parsed, MAX_TOP_K);
}

/**
 * General semantic retrieval over the workspace document index. Access is
 * enforced inside `retrieveDocumentSources` (workspace-visible or owned docs
 * only), so an explicit `documentIds` list can never widen the caller's reach.
 *
 * Body: { query: string, documentIds?: number[], topK?: number }
 * Returns: { sources: [...], documentIds: [...] }  (documentIds = scope used)
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const userId = req.userId;
  const orgId = req.org.id;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'retrieval-query',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const queryText = String(body.query || '').trim();
  if (!queryText) {
    return res.status(400).json({ message: 'Suchanfrage ist erforderlich' });
  }
  if (queryText.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ message: `Suchanfrage ist zu lang (max. ${MAX_QUERY_LENGTH} Zeichen)` });
  }

  let documentIds = null;
  if (body.documentIds !== undefined) {
    if (!Array.isArray(body.documentIds)) {
      return res.status(400).json({ message: 'documentIds muss ein Array sein' });
    }
    documentIds = body.documentIds.map(Number).filter(Number.isFinite).slice(0, MAX_DOCUMENT_IDS);
  }

  const topK = clampTopK(body.topK);
  const knowledgeBaseId = Number.isFinite(Number(body.knowledgeBaseId)) && Number(body.knowledgeBaseId) > 0
    ? Number(body.knowledgeBaseId)
    : null;

  try {
    const cortecs = await resolveCortecsConfig({ userId, organizationId: orgId });
    if (!cortecs.apiKey) {
      return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    }

    let result;
    if (knowledgeBaseId) {
      const kb = await getKnowledgeBase(knowledgeBaseId, orgId);
      if (!kb) return res.status(404).json({ message: 'Wissensbasis nicht gefunden' });
      result = await retrieveKnowledgeSources({
        knowledgeBaseId,
        message: queryText,
        organizationId: orgId,
        userId,
        cortecs,
        topK,
      });
    } else {
      result = await retrieveDocumentSources({
        documentIds,
        message: queryText,
        organizationId: orgId,
        userId,
        cortecs,
        topK,
      });
    }

    return res.status(200).json({ sources: result.sources, documentIds: result.documentIds });
  } catch (error) {
    logApiError('Retrieval query failed', error);
    return serverError(res, 'Suche konnte nicht ausgeführt werden.');
  }
}

export default withOrgScope({ permission: 'document.read' }, handler);
