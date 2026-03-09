import { randomUUID } from 'crypto';
import pool, { query } from './db';
import {
  appendRealtimeTranscript,
  buildLiveDocumentMarkdown,
  updateKnowledgeGraph,
} from './realtime-knowledge';

const SESSION_STATUS = new Set(['active', 'paused', 'completed']);
const MEMBER_ROLE = new Set(['owner', 'editor', 'viewer']);
const BUILTIN_TEMPLATES = new Set(['generic', 'meeting', 'aufmass', 'knowledge_graph', 'mindmap']);

function normalizeChunkForCompare(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/\s+/g, ' ');
}

function isLikelyDuplicateChunk(existingTranscript, chunkText) {
  const normalizedChunk = normalizeChunkForCompare(chunkText);
  if (!normalizedChunk || normalizedChunk.length < 8) return false;

  const tail = String(existingTranscript || '')
    .split('\n')
    .slice(-5)
    .join('\n');
  const normalizedTail = normalizeChunkForCompare(tail);
  return normalizedTail.includes(normalizedChunk);
}

function normalizeRole(role) {
  if (!role || typeof role !== 'string') return 'viewer';
  const normalized = role.trim().toLowerCase();
  return MEMBER_ROLE.has(normalized) ? normalized : 'viewer';
}

function normalizeStatus(status) {
  if (!status || typeof status !== 'string') return 'active';
  const normalized = status.trim().toLowerCase();
  return SESSION_STATUS.has(normalized) ? normalized : null;
}

function normalizeRealtimeTemplate(template) {
  const raw = String(template || '').trim();
  if (!raw) return null;
  if (BUILTIN_TEMPLATES.has(raw)) return raw;
  const customMatch = raw.match(/^custom-(\d{1,10})$/);
  if (customMatch) return `custom-${customMatch[1]}`;
  return null;
}

export async function listRealtimeSessionsForUser(userId) {
  const result = await query(
    `SELECT s.id, s.owner_user_id, s.title, s.language, s.model, s.document_template, s.status, s.finalization_state, s.created_at, s.updated_at,
            s.last_chunk_at,
            m.role AS my_role,
            (SELECT COUNT(*) FROM realtime_session_members rm WHERE rm.session_id = s.id) AS member_count
     FROM realtime_sessions s
     INNER JOIN realtime_session_members m
       ON m.session_id = s.id
      AND m.user_id = $1
     ORDER BY s.updated_at DESC
     LIMIT 200`,
    [userId]
  );
  return result.rows;
}

export async function createRealtimeSession({
  ownerUserId,
  title,
  language = 'de',
  model = null,
  documentTemplate = 'generic',
}) {
  const normalizedTitle = String(title || '').trim() || 'Team-Live-Session';
  const normalizedTemplate = normalizeRealtimeTemplate(documentTemplate) || 'generic';
  const sessionKey = randomUUID();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertSession = await client.query(
      `INSERT INTO realtime_sessions (owner_user_id, session_key, title, language, model, document_template, status, transcript_text, document_markdown, graph_json)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', '', '', '{"nodes":[],"edges":[]}'::jsonb)
       RETURNING id, owner_user_id, session_key, title, language, model, document_template, status, transcript_text, document_markdown, graph_json,
                 finalization_state, finalization_error, finalized_at, created_at, updated_at`,
      [
        ownerUserId,
        sessionKey,
        normalizedTitle.slice(0, 160),
        String(language || 'de').slice(0, 20),
        model || null,
        normalizedTemplate,
      ]
    );

    const session = insertSession.rows[0];
    await client.query(
      `INSERT INTO realtime_session_members (session_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (session_id, user_id) DO UPDATE SET role = 'owner'`,
      [session.id, ownerUserId]
    );

    await client.query('COMMIT');
    return session;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getRealtimeSessionForUser(sessionId, userId) {
  const result = await query(
    `SELECT s.id, s.owner_user_id, s.session_key, s.title, s.language, s.model, s.document_template, s.status,
            s.transcript_text, s.document_markdown, s.graph_json, s.last_chunk_at, s.finalization_state,
            s.finalization_error, s.finalized_at, s.created_at, s.updated_at,
            m.role AS my_role
     FROM realtime_sessions s
     INNER JOIN realtime_session_members m
       ON m.session_id = s.id
      AND m.user_id = $2
     WHERE s.id = $1`,
    [sessionId, userId]
  );

  if (result.rowCount === 0) return null;
  const session = result.rows[0];
  const memberResult = await query(
    `SELECT rm.user_id, rm.role, rm.created_at, u.email, u.name
     FROM realtime_session_members rm
     INNER JOIN users u ON u.id = rm.user_id
     WHERE rm.session_id = $1
     ORDER BY rm.created_at ASC`,
    [sessionId]
  );
  return {
    ...session,
    members: memberResult.rows,
  };
}

export async function updateRealtimeSessionMeta({ sessionId, userId, title, status, documentTemplate }) {
  const nextStatus = status !== undefined ? normalizeStatus(status) : undefined;
  if (status !== undefined && !nextStatus) {
    throw new Error('INVALID_STATUS');
  }
  const nextTemplate = documentTemplate !== undefined ? normalizeRealtimeTemplate(documentTemplate) : undefined;
  if (documentTemplate !== undefined && !nextTemplate) {
    throw new Error('INVALID_TEMPLATE');
  }

  const updates = [];
  const values = [];
  let index = 1;

  if (title !== undefined) {
    updates.push(`title = $${index++}`);
    values.push(String(title || '').trim().slice(0, 160) || 'Team-Live-Session');
  }

  if (status !== undefined) {
    updates.push(`status = $${index++}`);
    values.push(nextStatus);
    if (nextStatus === 'completed') {
      updates.push(`finalization_state = 'idle'`);
      updates.push(`finalization_error = NULL`);
    }
  }

  if (documentTemplate !== undefined) {
    updates.push(`document_template = $${index++}`);
    values.push(nextTemplate);
    updates.push(`finalization_state = 'idle'`);
    updates.push(`finalization_error = NULL`);
  }

  if (updates.length === 0) return null;

  updates.push('updated_at = NOW()');
  values.push(sessionId, userId);

  const result = await query(
    `UPDATE realtime_sessions s
     SET ${updates.join(', ')}
     FROM realtime_session_members m
     WHERE s.id = $${index++}
       AND m.session_id = s.id
       AND m.user_id = $${index}
       AND m.role IN ('owner', 'editor')
     RETURNING s.id`,
    values
  );
  return result.rowCount > 0;
}

export async function addRealtimeMemberByEmail({ sessionId, actorUserId, email, role = 'viewer' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('INVALID_EMAIL');
  }

  const userResult = await query(
    `SELECT id, email, name FROM users WHERE lower(email) = $1`,
    [normalizedEmail]
  );
  if (userResult.rowCount === 0) {
    throw new Error('USER_NOT_FOUND');
  }
  const targetUser = userResult.rows[0];

  const actorAccess = await query(
    `SELECT role
     FROM realtime_session_members
     WHERE session_id = $1 AND user_id = $2`,
    [sessionId, actorUserId]
  );
  if (actorAccess.rowCount === 0 || actorAccess.rows[0].role !== 'owner') {
    throw new Error('FORBIDDEN');
  }

  const finalRole = normalizeRole(role);
  await query(
    `INSERT INTO realtime_session_members (session_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, user_id)
     DO UPDATE SET role = EXCLUDED.role`,
    [sessionId, targetUser.id, finalRole]
  );
  return { ...targetUser, role: finalRole };
}

export async function removeRealtimeMember({ sessionId, actorUserId, memberUserId }) {
  const actorAccess = await query(
    `SELECT role
     FROM realtime_session_members
     WHERE session_id = $1 AND user_id = $2`,
    [sessionId, actorUserId]
  );
  if (actorAccess.rowCount === 0 || actorAccess.rows[0].role !== 'owner') {
    throw new Error('FORBIDDEN');
  }

  const memberId = Number.parseInt(memberUserId, 10);
  if (!Number.isFinite(memberId)) {
    throw new Error('INVALID_MEMBER_ID');
  }

  const targetAccess = await query(
    `SELECT role
     FROM realtime_session_members
     WHERE session_id = $1 AND user_id = $2`,
    [sessionId, memberId]
  );
  if (targetAccess.rowCount === 0) return false;
  if (targetAccess.rows[0].role === 'owner') {
    throw new Error('CANNOT_REMOVE_OWNER');
  }

  await query(
    `DELETE FROM realtime_session_members WHERE session_id = $1 AND user_id = $2`,
    [sessionId, memberId]
  );
  return true;
}

export async function getRealtimeSessionRole({ sessionId, userId }) {
  const access = await query(
    `SELECT role
     FROM realtime_session_members
     WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return access.rows[0]?.role || null;
}

export async function ingestRealtimeChunk({
  sessionId,
  userId,
  chunkText,
  transcriptSource = 'text',
  usage = null,
}) {
  const normalizedChunk = String(chunkText || '').trim();
  if (!normalizedChunk) {
    throw new Error('EMPTY_CHUNK');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accessResult = await client.query(
      `SELECT m.role,
              s.title,
              s.status,
              s.document_template,
              s.transcript_text,
              s.graph_json
       FROM realtime_sessions s
       INNER JOIN realtime_session_members m
         ON m.session_id = s.id
        AND m.user_id = $2
       WHERE s.id = $1
       FOR UPDATE`,
      [sessionId, userId]
    );

    if (accessResult.rowCount === 0) {
      throw new Error('FORBIDDEN');
    }

    const role = accessResult.rows[0].role;
    if (!['owner', 'editor'].includes(role)) {
      throw new Error('READ_ONLY');
    }

    const sessionRow = accessResult.rows[0];
    if (sessionRow.status === 'completed') {
      throw new Error('SESSION_COMPLETED');
    }

    const duplicateChunk = isLikelyDuplicateChunk(sessionRow.transcript_text || '', normalizedChunk);
    if (!duplicateChunk) {
      const transcriptText = appendRealtimeTranscript(sessionRow.transcript_text || '', normalizedChunk);
      const graph = updateKnowledgeGraph(sessionRow.graph_json, normalizedChunk);
      const documentMarkdown = buildLiveDocumentMarkdown({
        title: sessionRow.title,
        template: sessionRow.document_template || 'generic',
        transcript: transcriptText,
        graph,
      });

      await client.query(
        `UPDATE realtime_sessions
         SET transcript_text = $1,
             document_markdown = $2,
             graph_json = $3::jsonb,
             last_chunk_at = NOW(),
             updated_at = NOW()
         WHERE id = $4`,
        [transcriptText, documentMarkdown, JSON.stringify(graph), sessionId]
      );
    } else {
      await client.query(
        `UPDATE realtime_sessions
         SET last_chunk_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [sessionId]
      );
    }

    await client.query(
      `INSERT INTO realtime_session_events (session_id, user_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        sessionId,
        userId,
        duplicateChunk ? 'chunk_duplicate_ignored' : 'chunk',
        JSON.stringify({
          source: transcriptSource,
          chunk: normalizedChunk.slice(0, 600),
          usage,
          duplicateIgnored: duplicateChunk,
        }),
      ]
    );

    const snapshotResult = await client.query(
      `SELECT s.id, s.owner_user_id, s.session_key, s.title, s.language, s.model, s.status,
              s.document_template,
              s.transcript_text, s.document_markdown, s.graph_json, s.last_chunk_at, s.finalization_state,
              s.finalization_error, s.finalized_at, s.created_at, s.updated_at,
              m.role AS my_role
       FROM realtime_sessions s
       INNER JOIN realtime_session_members m
         ON m.session_id = s.id
        AND m.user_id = $2
       WHERE s.id = $1`,
      [sessionId, userId]
    );

    await client.query('COMMIT');
    return snapshotResult.rows[0] || null;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}
