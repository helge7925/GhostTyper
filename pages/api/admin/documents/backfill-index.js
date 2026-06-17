import crypto from 'crypto';
import { query } from '../../../../lib/db';
import { logApiError } from '../../../../lib/api-utils';
import { logAuditEvent } from '../../../../lib/audit-log';
import { resolveCortecsConfig } from '../../../../lib/settings-service';
import { indexDocument } from '../../../../lib/document-index';

/**
 * One-off / cron backfill: index existing documents that were created
 * before automatic indexing existed (or whose indexing never completed).
 *
 * Auto-indexing now covers new uploads/OCR/text/meetings, but the
 * pre-existing history still has documents with no chunks/embeddings.
 * This endpoint walks that backlog in bounded batches so it can be
 * called repeatedly (cron) without flooding the Cortecs embedding API.
 *
 * Shared-secret protected, mirroring the Vexa reconcile endpoint:
 *
 *   curl -X POST https://<host>/api/admin/documents/backfill-index \
 *        -H "X-BACKFILL-SECRET: $BACKFILL_API_SECRET"
 *
 * Optional JSON body:
 *   { "limit": 25, "organizationId": 3, "dryRun": true }
 *
 * A document is considered to need indexing when it has indexable
 * content (transcript text or segments) and has no `completed`
 * `document_index_jobs` row yet. `indexDocument` rebuilds chunks from
 * scratch, so re-running over a partially-indexed document is safe.
 * Translations are excluded by design — they store only a placeholder
 * status string, not the translated body.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function checkSecret(req) {
  const expected = process.env.BACKFILL_API_SECRET;
  if (!expected) return false;
  const provided = req.headers['x-backfill-secret'] || '';
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

async function loadDocumentsNeedingIndex({ limit, organizationId }) {
  const params = [limit];
  let orgFilter = '';
  if (organizationId) {
    params.push(organizationId);
    orgFilter = `AND d.organization_id = $${params.length}`;
  }
  const result = await query(
    `SELECT d.id, d.organization_id, d.owner_user_id
       FROM documents d
       JOIN transcriptions t
         ON t.id = d.transcription_id
        AND t.organization_id = d.organization_id
      WHERE d.source_type <> 'translation'
        AND ((t.text IS NOT NULL AND t.text <> '') OR t.segments IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM document_index_jobs j
           WHERE j.document_id = d.id AND j.status = 'completed'
        )
        ${orgFilter}
      ORDER BY d.created_at ASC
      LIMIT $1`,
    params,
  );
  return result.rows;
}

/**
 * Internal entry point shared between the HTTP endpoint and any future
 * in-process scheduler. No auth check — only call from trusted
 * server-side code.
 */
export async function runIndexBackfill({ limit = DEFAULT_LIMIT, organizationId = null, dryRun = false } = {}) {
  const documents = await loadDocumentsNeedingIndex({ limit, organizationId });

  // Cortecs config is resolved per (org, owner) and cached so a batch
  // spanning one workspace doesn't re-hit settings for every document.
  const cortecsCache = new Map();
  const getCortecs = async (orgId, userId) => {
    const key = `${orgId}:${userId}`;
    if (!cortecsCache.has(key)) {
      cortecsCache.set(key, await resolveCortecsConfig({ userId, organizationId: orgId }));
    }
    return cortecsCache.get(key);
  };

  const results = [];
  for (const row of documents) {
    if (dryRun) {
      results.push({ documentId: Number(row.id), action: 'would_index' });
      continue;
    }
    try {
      const cortecs = await getCortecs(row.organization_id, row.owner_user_id);
      if (!cortecs?.apiKey) {
        results.push({ documentId: Number(row.id), action: 'skipped_no_key' });
        continue;
      }
      const indexed = await indexDocument({
        documentId: Number(row.id),
        organizationId: row.organization_id,
        userId: row.owner_user_id,
        cortecs,
      });
      results.push({ documentId: Number(row.id), action: 'indexed', chunks: indexed.chunks, embeddings: indexed.embeddings });
    } catch (error) {
      logApiError(`Document backfill index failed for ${row.id}`, error);
      results.push({ documentId: Number(row.id), action: 'error', message: error.message });
    }
  }

  const indexedCount = results.filter((r) => r.action === 'indexed').length;
  if (!dryRun && results.length > 0) {
    await logAuditEvent({
      userId: null,
      organizationId: organizationId || null,
      action: 'document.backfill_index.run',
      targetType: 'system',
      targetId: 'document-backfill-index',
      metadata: { candidates: results.length, indexed: indexedCount, summary: results },
    });
  }

  return { processed: results.length, indexed: indexedCount, results };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!checkSecret(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const limit = clampLimit(body.limit);
  const organizationId = Number.isFinite(Number(body.organizationId)) && Number(body.organizationId) > 0
    ? Number(body.organizationId)
    : null;
  const dryRun = body.dryRun === true;

  try {
    const summary = await runIndexBackfill({ limit, organizationId, dryRun });
    return res.status(200).json({ ok: true, dryRun, ...summary });
  } catch (error) {
    logApiError('Document backfill index error', error);
    return res.status(500).json({ code: 'INTERNAL_ERROR' });
  }
}
