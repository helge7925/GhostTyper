/**
 * Pure, dependency-free helpers for Workspace Wissen (knowledge bases).
 * Kept import-free so they can be unit-tested without the DB layer.
 */

export const RETRIEVAL_MODES = ['focused', 'full_context', 'off'];
export const DEFAULT_RETRIEVAL_MODE = 'focused';

const MAX_NAME_LENGTH = 255;

/** Coerce an arbitrary input to a valid retrieval mode, defaulting to `focused`. */
export function normalizeRetrievalMode(value) {
  return RETRIEVAL_MODES.includes(value) ? value : DEFAULT_RETRIEVAL_MODE;
}

/** Trim + length-cap a knowledge-base / directory name. Returns '' if empty. */
export function sanitizeName(value) {
  return String(value || '').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Split knowledge items by retrieval mode into the document-id sets used by
 * retrieval: `off` items are dropped, `focused` items are chunk-ranked, and
 * `full_context` items have their whole document injected.
 *
 * @param {Array<{document_id: number, retrieval_mode: string}>} items
 */
export function partitionRetrievalModes(items) {
  const focusedDocumentIds = [];
  const fullContextDocumentIds = [];
  for (const item of items || []) {
    const docId = Number(item?.document_id);
    if (!Number.isFinite(docId)) continue;
    const mode = normalizeRetrievalMode(item?.retrieval_mode);
    if (mode === 'off') continue;
    if (mode === 'full_context') fullContextDocumentIds.push(docId);
    else focusedDocumentIds.push(docId);
  }
  return { focusedDocumentIds, fullContextDocumentIds };
}
