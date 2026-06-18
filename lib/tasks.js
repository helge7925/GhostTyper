import { fetchWithTimeout } from './api-utils';
import { query } from './db';
import { DEFAULT_CHAT_MODEL } from './constants';
import { estimateCost, logUsage } from './usage';
import { buildTaskExtractionMessages, assignTasksToMembers, normalizeExtractedTasks, normalizeTaskPriority, normalizeTaskStatus } from './task-utils';

const TASK_EXTRACTION_TIMEOUT_MS = Number.parseInt(process.env.TASK_EXTRACTION_HTTP_TIMEOUT_MS, 10) || 120_000;

function parseJsonObject(content) {
  const text = String(content || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }
  }
  return {};
}

export async function listWorkspaceMembers(organizationId) {
  const result = await query(
    `SELECT u.id, u.name, u.email, om.role
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
      WHERE om.organization_id = $1
      ORDER BY u.name NULLS LAST, u.email ASC`,
    [organizationId],
  );
  return result.rows;
}

export async function listTasks({ organizationId, transcriptionId = null, status = null, assigneeUserId = null }) {
  const conditions = ['t.organization_id = $1'];
  const values = [organizationId];
  let i = 2;
  if (transcriptionId) {
    conditions.push(`t.transcription_id = $${i++}`);
    values.push(transcriptionId);
  }
  if (status) {
    conditions.push(`t.status = $${i++}`);
    values.push(normalizeTaskStatus(status));
  }
  if (assigneeUserId) {
    conditions.push(`t.assignee_user_id = $${i++}`);
    values.push(assigneeUserId);
  }
  const result = await query(
    `SELECT t.id, t.organization_id, t.document_id, t.transcription_id, t.source_chunk_id,
            t.title, t.description, t.assignee_text, t.assignee_user_id, u.name AS assignee_name,
            u.email AS assignee_email, t.due_date, t.priority, t.status, t.confidence,
            t.evidence, t.source_segment_ids, t.created_by, t.created_at, t.updated_at,
            d.title AS document_title, tr.original_name AS transcription_title
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_user_id
       LEFT JOIN documents d ON d.id = t.document_id AND d.organization_id = t.organization_id
       LEFT JOIN transcriptions tr ON tr.id = t.transcription_id AND tr.organization_id = t.organization_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.status = 'proposed' DESC, t.updated_at DESC, t.created_at DESC
      LIMIT 200`,
    values,
  );
  return result.rows;
}

export async function createTask({ organizationId, createdBy, documentId = null, transcriptionId = null, task }) {
  const title = String(task?.title || '').trim().slice(0, 255);
  if (!title) {
    const error = new Error('Titel ist erforderlich');
    error.status = 400;
    throw error;
  }
  const result = await query(
    `INSERT INTO tasks (
       organization_id, document_id, transcription_id, title, description,
       assignee_text, assignee_user_id, due_date, priority, status, confidence,
       evidence, source_segment_ids, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      organizationId,
      documentId,
      transcriptionId,
      title,
      task.description || null,
      task.assigneeText || task.assignee_text || null,
      task.assigneeUserId || task.assignee_user_id || null,
      task.dueDate || task.due_date || null,
      normalizeTaskPriority(task.priority),
      normalizeTaskStatus(task.status),
      task.confidence ?? null,
      task.evidence || null,
      JSON.stringify(task.sourceSegmentIds || task.source_segment_ids || []),
      createdBy,
    ],
  );
  return result.rows[0];
}

export async function updateTask({ id, organizationId, patch }) {
  const updates = [];
  const values = [];
  let i = 1;
  if (patch.title !== undefined) {
    const title = String(patch.title || '').trim().slice(0, 255);
    if (!title) {
      const error = new Error('Titel ist erforderlich');
      error.status = 400;
      throw error;
    }
    updates.push(`title = $${i++}`);
    values.push(title);
  }
  if (patch.description !== undefined) {
    updates.push(`description = $${i++}`);
    values.push(patch.description ? String(patch.description).slice(0, 4000) : null);
  }
  if (patch.status !== undefined) {
    updates.push(`status = $${i++}`);
    values.push(normalizeTaskStatus(patch.status));
  }
  if (patch.priority !== undefined) {
    updates.push(`priority = $${i++}`);
    values.push(normalizeTaskPriority(patch.priority));
  }
  if (patch.assigneeUserId !== undefined || patch.assignee_user_id !== undefined) {
    updates.push(`assignee_user_id = $${i++}`);
    values.push(patch.assigneeUserId ?? patch.assignee_user_id ?? null);
  }
  if (patch.assigneeText !== undefined || patch.assignee_text !== undefined) {
    updates.push(`assignee_text = $${i++}`);
    values.push(patch.assigneeText ?? patch.assignee_text ?? null);
  }
  if (patch.dueDate !== undefined || patch.due_date !== undefined) {
    updates.push(`due_date = $${i++}`);
    values.push(patch.dueDate ?? patch.due_date ?? null);
  }
  if (updates.length === 0) return null;
  updates.push('updated_at = NOW()');
  values.push(id, organizationId);
  const result = await query(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${i++} AND organization_id = $${i} RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

export async function deleteTask({ id, organizationId }) {
  const result = await query('DELETE FROM tasks WHERE id = $1 AND organization_id = $2 RETURNING id', [id, organizationId]);
  return result.rowCount > 0;
}

export async function extractTasksFromTranscript({ transcription, members, cortecs, userId, organizationId, language = 'de' }) {
  const messages = buildTaskExtractionMessages({ transcriptText: transcription.text, segments: transcription.segments, members, language });
  const model = cortecs.chatModel || DEFAULT_CHAT_MODEL;
  const response = await fetchWithTimeout(
    `${cortecs.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cortecs.apiKey}`,
      },
      body: JSON.stringify({
        model,
        preference: cortecs.preference || 'balanced',
        messages,
        response_format: { type: 'json_object' },
      }),
    },
    TASK_EXTRACTION_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cortecs API error: ${response.status} - ${text.slice(0, 300)}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '{}';
  const extracted = normalizeExtractedTasks(parseJsonObject(content));
  const tasks = assignTasksToMembers(extracted, members);
  const usage = result.usage || {};
  const usedModel = result.model || model;
  if (usage.prompt_tokens || usage.completion_tokens) {
    await logUsage(userId, usedModel, 'task_extraction', usage, organizationId);
  }
  return { tasks, usage, model: usedModel, estimatedCost: estimateCost(usedModel, usage.prompt_tokens || 0, usage.completion_tokens || 0) };
}

export async function replaceProposedTranscriptTasks({ organizationId, transcriptionId, documentId, createdBy, tasks }) {
  await query(
    "DELETE FROM tasks WHERE organization_id = $1 AND transcription_id = $2 AND status = 'proposed'",
    [organizationId, transcriptionId],
  );
  const inserted = [];
  for (const task of tasks) {
    inserted.push(await createTask({ organizationId, createdBy, documentId, transcriptionId, task: { ...task, status: 'proposed' } }));
  }
  return inserted;
}
