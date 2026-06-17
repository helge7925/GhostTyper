import { query } from './db';
import { normalizeRetrievalMode, sanitizeName } from './knowledge-utils';

/** A typed error so API routes can map failures to HTTP status codes. */
export class KnowledgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function getKnowledgeBase(id, organizationId) {
  const result = await query(
    `SELECT id, organization_id, owner_user_id, name, description, created_at, updated_at
       FROM knowledge_bases
      WHERE id = $1 AND organization_id = $2`,
    [id, organizationId],
  );
  return result.rows[0] || null;
}

export async function listKnowledgeBases(organizationId) {
  const result = await query(
    `SELECT kb.id, kb.name, kb.description, kb.owner_user_id, kb.created_at, kb.updated_at,
            COUNT(ki.id)::int AS item_count
       FROM knowledge_bases kb
       LEFT JOIN knowledge_items ki ON ki.knowledge_base_id = kb.id
      WHERE kb.organization_id = $1
      GROUP BY kb.id
      ORDER BY kb.updated_at DESC`,
    [organizationId],
  );
  return result.rows;
}

export async function createKnowledgeBase({ organizationId, ownerUserId, name, description }) {
  const cleanName = sanitizeName(name);
  if (!cleanName) throw new KnowledgeError('INVALID_NAME', 'Name ist erforderlich');
  const result = await query(
    `INSERT INTO knowledge_bases (organization_id, owner_user_id, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, owner_user_id, created_at, updated_at`,
    [organizationId, ownerUserId, cleanName, description ? String(description).slice(0, 2000) : null],
  );
  return result.rows[0];
}

export async function updateKnowledgeBase(id, organizationId, { name, description }) {
  const updates = [];
  const values = [];
  let i = 1;
  if (name !== undefined) {
    const cleanName = sanitizeName(name);
    if (!cleanName) throw new KnowledgeError('INVALID_NAME', 'Name ist erforderlich');
    updates.push(`name = $${i++}`);
    values.push(cleanName);
  }
  if (description !== undefined) {
    updates.push(`description = $${i++}`);
    values.push(description === null ? null : String(description).slice(0, 2000));
  }
  if (updates.length === 0) return getKnowledgeBase(id, organizationId);
  updates.push('updated_at = NOW()');
  values.push(id, organizationId);
  const result = await query(
    `UPDATE knowledge_bases SET ${updates.join(', ')}
      WHERE id = $${i++} AND organization_id = $${i}
      RETURNING id, name, description, owner_user_id, created_at, updated_at`,
    values,
  );
  return result.rows[0] || null;
}

export async function deleteKnowledgeBase(id, organizationId) {
  const result = await query(
    'DELETE FROM knowledge_bases WHERE id = $1 AND organization_id = $2 RETURNING id',
    [id, organizationId],
  );
  return result.rowCount > 0;
}

export async function listKnowledgeItems(knowledgeBaseId, organizationId) {
  const result = await query(
    `SELECT ki.id, ki.document_id, ki.directory_id, ki.retrieval_mode, ki.created_at,
            d.title, d.source_type, d.transcription_id
       FROM knowledge_items ki
       JOIN documents d ON d.id = ki.document_id AND d.organization_id = ki.organization_id
      WHERE ki.knowledge_base_id = $1 AND ki.organization_id = $2
      ORDER BY ki.created_at ASC`,
    [knowledgeBaseId, organizationId],
  );
  return result.rows;
}

/**
 * Add a document to a knowledge base. Only workspace-visible documents may be
 * added — private documents (yours or others') stay out of shared knowledge.
 */
export async function addKnowledgeItem({ knowledgeBaseId, organizationId, documentId, directoryId = null, retrievalMode }) {
  const doc = await query(
    "SELECT id FROM documents WHERE id = $1 AND organization_id = $2 AND visibility = 'workspace'",
    [documentId, organizationId],
  );
  if (doc.rowCount === 0) {
    throw new KnowledgeError('DOCUMENT_NOT_ALLOWED', 'Nur Workspace-Dokumente können hinzugefügt werden');
  }
  if (directoryId != null) {
    const dir = await query(
      'SELECT id FROM knowledge_directories WHERE id = $1 AND knowledge_base_id = $2 AND organization_id = $3',
      [directoryId, knowledgeBaseId, organizationId],
    );
    if (dir.rowCount === 0) throw new KnowledgeError('INVALID_DIRECTORY', 'Verzeichnis nicht gefunden');
  }
  await query(
    `INSERT INTO knowledge_items (knowledge_base_id, organization_id, document_id, directory_id, retrieval_mode)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (knowledge_base_id, document_id) DO NOTHING`,
    [knowledgeBaseId, organizationId, documentId, directoryId, normalizeRetrievalMode(retrievalMode)],
  );
  await query('UPDATE knowledge_bases SET updated_at = NOW() WHERE id = $1', [knowledgeBaseId]);
}

export async function updateKnowledgeItem({ itemId, knowledgeBaseId, organizationId, retrievalMode, directoryId }) {
  const updates = [];
  const values = [];
  let i = 1;
  if (retrievalMode !== undefined) {
    updates.push(`retrieval_mode = $${i++}`);
    values.push(normalizeRetrievalMode(retrievalMode));
  }
  if (directoryId !== undefined) {
    if (directoryId != null) {
      const dir = await query(
        'SELECT id FROM knowledge_directories WHERE id = $1 AND knowledge_base_id = $2 AND organization_id = $3',
        [directoryId, knowledgeBaseId, organizationId],
      );
      if (dir.rowCount === 0) throw new KnowledgeError('INVALID_DIRECTORY', 'Verzeichnis nicht gefunden');
    }
    updates.push(`directory_id = $${i++}`);
    values.push(directoryId);
  }
  if (updates.length === 0) return false;
  values.push(itemId, knowledgeBaseId, organizationId);
  const result = await query(
    `UPDATE knowledge_items SET ${updates.join(', ')}
      WHERE id = $${i++} AND knowledge_base_id = $${i++} AND organization_id = $${i}`,
    values,
  );
  return result.rowCount > 0;
}

export async function removeKnowledgeItem({ itemId, knowledgeBaseId, organizationId }) {
  const result = await query(
    'DELETE FROM knowledge_items WHERE id = $1 AND knowledge_base_id = $2 AND organization_id = $3',
    [itemId, knowledgeBaseId, organizationId],
  );
  return result.rowCount > 0;
}

export async function listKnowledgeDirectories(knowledgeBaseId, organizationId) {
  const result = await query(
    `SELECT id, parent_id, name, created_at
       FROM knowledge_directories
      WHERE knowledge_base_id = $1 AND organization_id = $2
      ORDER BY name ASC`,
    [knowledgeBaseId, organizationId],
  );
  return result.rows;
}

export async function createKnowledgeDirectory({ knowledgeBaseId, organizationId, name, parentId = null }) {
  const cleanName = sanitizeName(name);
  if (!cleanName) throw new KnowledgeError('INVALID_NAME', 'Name ist erforderlich');
  if (parentId != null) {
    const parent = await query(
      'SELECT id FROM knowledge_directories WHERE id = $1 AND knowledge_base_id = $2 AND organization_id = $3',
      [parentId, knowledgeBaseId, organizationId],
    );
    if (parent.rowCount === 0) throw new KnowledgeError('INVALID_DIRECTORY', 'Übergeordnetes Verzeichnis nicht gefunden');
  }
  const result = await query(
    `INSERT INTO knowledge_directories (knowledge_base_id, organization_id, parent_id, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, parent_id, name, created_at`,
    [knowledgeBaseId, organizationId, parentId, cleanName],
  );
  return result.rows[0];
}

export async function updateKnowledgeDirectory({ directoryId, knowledgeBaseId, organizationId, name }) {
  const cleanName = sanitizeName(name);
  if (!cleanName) throw new KnowledgeError('INVALID_NAME', 'Name ist erforderlich');
  const result = await query(
    `UPDATE knowledge_directories SET name = $1
      WHERE id = $2 AND knowledge_base_id = $3 AND organization_id = $4
      RETURNING id, parent_id, name, created_at`,
    [cleanName, directoryId, knowledgeBaseId, organizationId],
  );
  return result.rows[0] || null;
}

export async function deleteKnowledgeDirectory({ directoryId, knowledgeBaseId, organizationId }) {
  const result = await query(
    'DELETE FROM knowledge_directories WHERE id = $1 AND knowledge_base_id = $2 AND organization_id = $3',
    [directoryId, knowledgeBaseId, organizationId],
  );
  return result.rowCount > 0;
}
