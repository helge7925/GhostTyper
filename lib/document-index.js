import { query } from './db';
import { fetchWithTimeout } from './api-utils';
import { DEFAULT_EMBEDDING_MODEL } from './constants';
import { embeddingHash } from './documents';
import { logWarn } from './observability';
import { resolveCortecsConfig } from './settings-service';
import { buildDocumentChunks, buildRetrievalPrompt, cosineSimilarity, runAutoIndex } from './document-index-utils';
import { getKnowledgeRetrievalScope } from './knowledge';
import { partitionRetrievalModes } from './knowledge-utils';

const EMBEDDING_TIMEOUT_MS = Number.parseInt(process.env.EMBEDDING_HTTP_TIMEOUT_MS, 10) || 120_000;
const DEFAULT_RETRIEVAL_LIMIT = 8;
const DEFAULT_CANDIDATE_LIMIT = 200;
const DEFAULT_CONTEXT_CHAR_LIMIT = 20_000;

export function resolveEmbeddingModel(cortecs = {}) {
  return cortecs.embeddingModel || process.env.CORTECS_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value)) return null;
  const vector = value.map((entry) => Number(entry));
  return vector.every(Number.isFinite) && vector.length > 0 ? vector : null;
}

function normalizeStoredEmbedding(value) {
  if (Array.isArray(value)) return normalizeEmbedding(value);
  if (typeof value !== 'string') return null;
  const parts = value.replace(/^\{/, '').replace(/\}$/, '').split(',');
  return normalizeEmbedding(parts);
}

export async function createCortecsEmbeddings({ texts, cortecs, model = null }) {
  const input = Array.isArray(texts) ? texts : [texts];
  const cleanInput = input.map((text) => String(text || '').trim()).filter(Boolean);
  if (cleanInput.length === 0) return [];
  if (!cortecs?.apiKey) {
    const error = new Error('Kein Cortecs API-Key konfiguriert');
    error.code = 'NO_CORTECS_API_KEY';
    throw error;
  }

  const embeddingModel = model || resolveEmbeddingModel(cortecs);
  const response = await fetchWithTimeout(
    `${cortecs.baseUrl}/embeddings`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cortecs.apiKey}`,
      },
      body: JSON.stringify({ model: embeddingModel, input: cleanInput }),
    },
    EMBEDDING_TIMEOUT_MS,
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cortecs embedding API error: ${response.status} - ${errorText.slice(0, 300)}`);
  }

  const result = await response.json();
  if (Array.isArray(result.embeddings)) {
    return result.embeddings.map((entry) => normalizeEmbedding(entry));
  }

  const data = Array.isArray(result.data) ? result.data : [];
  return data
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((entry) => normalizeEmbedding(entry.embedding));
}

async function loadDocumentForIndex(documentId, organizationId, userId) {
  const result = await query(
    `SELECT d.id, d.organization_id, d.owner_user_id, d.visibility, d.source_type, d.title,
            d.summary, d.text_preview, d.transcription_id,
            t.text, t.segments, t.analysis, t.original_name
       FROM documents d
       LEFT JOIN transcriptions t
         ON t.id = d.transcription_id
        AND t.organization_id = d.organization_id
      WHERE d.id = $1
        AND d.organization_id = $2
        AND (d.visibility = 'workspace' OR d.owner_user_id = $3)`,
    [documentId, organizationId, userId],
  );
  return result.rows[0] || null;
}

async function createIndexJob(documentId) {
  const result = await query(
    `INSERT INTO document_index_jobs (document_id, status, started_at)
     VALUES ($1, 'processing', NOW())
     RETURNING id`,
    [documentId],
  );
  return result.rows[0]?.id || null;
}

async function finishIndexJob(jobId, status, error = null) {
  if (!jobId) return;
  await query(
    `UPDATE document_index_jobs
        SET status = $2, error = $3, finished_at = NOW()
      WHERE id = $1`,
    [jobId, status, error ? String(error).slice(0, 2000) : null],
  );
}

export async function indexDocument({ documentId, organizationId, userId, cortecs }) {
  const document = await loadDocumentForIndex(documentId, organizationId, userId);
  if (!document) {
    const error = new Error('Datei nicht gefunden');
    error.code = 'DOCUMENT_NOT_FOUND';
    throw error;
  }

  const jobId = await createIndexJob(document.id);
  try {
    const chunks = buildDocumentChunks(document);
    const model = resolveEmbeddingModel(cortecs);

    await query('DELETE FROM document_chunks WHERE document_id = $1 AND organization_id = $2', [document.id, organizationId]);

    const indexedChunks = [];
    for (const chunk of chunks) {
      const inserted = await query(
        `INSERT INTO document_chunks (organization_id, document_id, chunk_index, content, content_tsv, metadata, token_estimate)
         VALUES ($1, $2, $3, $4, to_tsvector('simple', $4), $5, $6)
         RETURNING id, content`,
        [organizationId, document.id, chunk.chunkIndex, chunk.content, JSON.stringify(chunk.metadata || {}), chunk.tokenEstimate || 0],
      );
      indexedChunks.push(inserted.rows[0]);
    }

    const embeddings = await createCortecsEmbeddings({
      texts: indexedChunks.map((chunk) => chunk.content),
      cortecs,
      model,
    });

    for (let i = 0; i < indexedChunks.length; i += 1) {
      const vector = embeddings[i];
      if (!vector) continue;
      await query(
        `INSERT INTO document_chunk_embeddings (chunk_id, organization_id, provider, model, dimensions, embedding, embedding_hash)
         VALUES ($1, $2, 'cortecs', $3, $4, $5, $6)
         ON CONFLICT (chunk_id, provider, model) DO UPDATE SET
           dimensions = EXCLUDED.dimensions,
           embedding = EXCLUDED.embedding,
           embedding_hash = EXCLUDED.embedding_hash,
           created_at = NOW()`,
        [
          indexedChunks[i].id,
          organizationId,
          model,
          vector.length,
          vector,
          embeddingHash(indexedChunks[i].content, model),
        ],
      );
    }

    await finishIndexJob(jobId, 'completed');
    return { documentId: document.id, chunks: indexedChunks.length, embeddings: embeddings.filter(Boolean).length, model };
  } catch (error) {
    await finishIndexJob(jobId, 'error', error.message);
    throw error;
  }
}

async function resolveDocumentIdForTranscription(transcriptionId, organizationId) {
  const result = await query(
    'SELECT id FROM documents WHERE transcription_id = $1 AND organization_id = $2',
    [transcriptionId, organizationId],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Best-effort auto-indexing used by upload/OCR/text/meeting flows. Never throws:
 * any failure (missing Cortecs key, embedding API error, …) is swallowed and
 * logged so the user-facing flow is never blocked by indexing.
 *
 * Accepts either a `documentId` or a `transcriptionId` (the document is resolved
 * from the latter). `cortecs` may be passed if already resolved (e.g. in the
 * worker); otherwise it is resolved here.
 */
export async function autoIndexDocument({ documentId, transcriptionId, organizationId, userId, cortecs = null }) {
  return runAutoIndex(
    { documentId, transcriptionId, organizationId, userId, cortecs },
    { resolveDocumentIdForTranscription, resolveCortecsConfig, indexDocument, logWarn },
  );
}

async function resolveConversationDocumentIds(conversation, organizationId, userId) {
  const ids = new Set();

  // 1) The conversation's origin document (context_ref_id).
  const refId = Number(conversation?.context_ref_id);
  if (Number.isFinite(refId)) {
    const result = await query(
      `SELECT id
         FROM documents
        WHERE organization_id = $1
          AND (visibility = 'workspace' OR owner_user_id = $2)
          AND (id = $3 OR transcription_id = $3)
        LIMIT 5`,
      [organizationId, userId, refId],
    );
    result.rows.forEach((row) => ids.add(Number(row.id)));
  }

  // 2) Documents explicitly attached via chat_context_items (access-filtered).
  const convId = Number(conversation?.id);
  if (Number.isFinite(convId)) {
    const attached = await query(
      `SELECT d.id
         FROM chat_context_items ci
         JOIN documents d
           ON d.id = ci.document_id
          AND d.organization_id = ci.organization_id
        WHERE ci.conversation_id = $1
          AND ci.organization_id = $2
          AND (d.visibility = 'workspace' OR d.owner_user_id = $3)`,
      [convId, organizationId, userId],
    );
    attached.rows.forEach((row) => ids.add(Number(row.id)));
  }

  return Array.from(ids).filter(Number.isFinite);
}

async function loadCandidateChunks(documentIds, organizationId, model, limit) {
  if (!documentIds.length) return [];
  const result = await query(
    `SELECT c.id AS chunk_id, c.document_id, c.content, c.metadata, c.chunk_index,
            d.title, d.transcription_id, e.embedding
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id AND d.organization_id = c.organization_id
       LEFT JOIN document_chunk_embeddings e
         ON e.chunk_id = c.id
        AND e.organization_id = c.organization_id
        AND e.provider = 'cortecs'
        AND e.model = $3
      WHERE c.organization_id = $1
        AND c.document_id = ANY($2::bigint[])
      ORDER BY c.chunk_index ASC
      LIMIT $4`,
    [organizationId, documentIds, model, limit],
  );
  return result.rows;
}

/**
 * Resolve which of the requested documents the user may actually read, or —
 * when no ids are given — all documents in the org the user can access
 * (workspace-visible or owned), capped to keep the candidate set bounded.
 */
async function loadAccessibleDocumentIds({ documentIds, organizationId, userId, limit = DEFAULT_CANDIDATE_LIMIT }) {
  if (Array.isArray(documentIds) && documentIds.length > 0) {
    const ids = documentIds.map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];
    const result = await query(
      `SELECT id FROM documents
        WHERE organization_id = $1
          AND id = ANY($2::bigint[])
          AND (visibility = 'workspace' OR owner_user_id = $3)`,
      [organizationId, ids, userId],
    );
    return result.rows.map((row) => Number(row.id));
  }
  const result = await query(
    `SELECT id FROM documents
      WHERE organization_id = $1
        AND (visibility = 'workspace' OR owner_user_id = $2)
      ORDER BY updated_at DESC
      LIMIT $3`,
    [organizationId, userId, limit],
  );
  return result.rows.map((row) => Number(row.id));
}

function toSource(candidate, score) {
  return {
    id: candidate.chunk_id,
    documentId: candidate.document_id,
    transcriptionId: candidate.transcription_id,
    title: candidate.title,
    chunkIndex: candidate.chunk_index,
    score,
    metadata: candidate.metadata || {},
    content: String(candidate.content || '').trim(),
  };
}

/**
 * Core retrieval: rank the chunks of the given documents against the query
 * embedding and select the top-K within a character budget. Shared by the
 * conversation-scoped and the general retrieval entry points.
 *
 * Documents in `fullContextDocumentIds` are injected in full (all their chunks
 * in order, bypassing the top-K cap) ahead of the chunk-ranked focused
 * documents — this implements the knowledge-item `full_context` retrieval mode.
 */
async function rankDocumentChunks({
  documentIds,
  message,
  organizationId,
  cortecs,
  topK = DEFAULT_RETRIEVAL_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  contextCharLimit = DEFAULT_CONTEXT_CHAR_LIMIT,
  fullContextDocumentIds = [],
}) {
  if (!documentIds || documentIds.length === 0) return { sources: [], prompt: '' };

  const model = resolveEmbeddingModel(cortecs);
  const candidates = await loadCandidateChunks(documentIds, organizationId, model, candidateLimit);
  if (candidates.length === 0) return { sources: [], prompt: '' };

  const fullSet = new Set((fullContextDocumentIds || []).map(Number));
  const fullCandidates = candidates
    .filter((c) => fullSet.has(Number(c.document_id)))
    .sort((a, b) => Number(a.document_id) - Number(b.document_id) || a.chunk_index - b.chunk_index);
  const focusedCandidates = candidates.filter((c) => !fullSet.has(Number(c.document_id)));

  let queryEmbedding = null;
  if (focusedCandidates.length > 0) {
    try {
      const embeddings = await createCortecsEmbeddings({ texts: [message], cortecs, model });
      queryEmbedding = embeddings[0] || null;
    } catch (error) {
      logWarn('document.retrieval_embedding_failed', { message: error.message });
    }
  }

  const rankedFocused = focusedCandidates
    .map((candidate) => ({
      candidate,
      score: queryEmbedding && candidate.embedding ? cosineSimilarity(queryEmbedding, normalizeStoredEmbedding(candidate.embedding)) : 0,
    }))
    .sort((a, b) => b.score - a.score || a.candidate.chunk_index - b.candidate.chunk_index);

  const sources = [];
  let totalChars = 0;

  // 1) full_context documents — whole content, no top-K limit (budget only).
  for (const candidate of fullCandidates) {
    const content = String(candidate.content || '').trim();
    if (!content || totalChars + content.length > contextCharLimit) continue;
    totalChars += content.length;
    sources.push(toSource(candidate, 1));
  }

  // 2) focused documents — chunk-ranked, capped at top-K.
  let focusedAdded = 0;
  for (const { candidate, score } of rankedFocused) {
    if (focusedAdded >= topK) break;
    const content = String(candidate.content || '').trim();
    if (!content || totalChars + content.length > contextCharLimit) continue;
    totalChars += content.length;
    focusedAdded += 1;
    sources.push(toSource(candidate, score));
  }

  return { sources, prompt: buildRetrievalPrompt(sources) };
}

export async function retrieveConversationSources({
  conversation,
  message,
  organizationId,
  userId,
  cortecs,
  topK = DEFAULT_RETRIEVAL_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  contextCharLimit = DEFAULT_CONTEXT_CHAR_LIMIT,
}) {
  const documentIds = await resolveConversationDocumentIds(conversation, organizationId, userId);
  return rankDocumentChunks({ documentIds, message, organizationId, cortecs, topK, candidateLimit, contextCharLimit });
}

/**
 * General document retrieval for `POST /api/retrieval/query`. Access-filters
 * the requested documents (or all accessible documents when none are given)
 * before ranking, so callers can never retrieve chunks they may not read.
 */
export async function retrieveDocumentSources({
  documentIds = null,
  message,
  organizationId,
  userId,
  cortecs,
  topK = DEFAULT_RETRIEVAL_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  contextCharLimit = DEFAULT_CONTEXT_CHAR_LIMIT,
}) {
  const accessibleIds = await loadAccessibleDocumentIds({ documentIds, organizationId, userId, limit: candidateLimit });
  const result = await rankDocumentChunks({ documentIds: accessibleIds, message, organizationId, cortecs, topK, candidateLimit, contextCharLimit });
  return { ...result, documentIds: accessibleIds };
}

/**
 * Retrieval scoped to a single knowledge base, honouring per-item retrieval
 * modes: `off` items are skipped, `focused` items are chunk-ranked, and
 * `full_context` items have their whole document injected.
 */
export async function retrieveKnowledgeSources({
  knowledgeBaseId,
  message,
  organizationId,
  userId,
  cortecs,
  topK = DEFAULT_RETRIEVAL_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  contextCharLimit = DEFAULT_CONTEXT_CHAR_LIMIT,
}) {
  const items = await getKnowledgeRetrievalScope(knowledgeBaseId, organizationId, userId);
  const { focusedDocumentIds, fullContextDocumentIds } = partitionRetrievalModes(items);
  const documentIds = [...focusedDocumentIds, ...fullContextDocumentIds];
  const result = await rankDocumentChunks({
    documentIds,
    message,
    organizationId,
    cortecs,
    topK,
    candidateLimit,
    contextCharLimit,
    fullContextDocumentIds,
  });
  return { ...result, documentIds };
}
