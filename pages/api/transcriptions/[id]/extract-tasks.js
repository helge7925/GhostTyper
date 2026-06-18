import { query } from '../../../../lib/db';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { logAuditEvent } from '../../../../lib/audit-log';
import { resolveCortecsConfig, getSettingsRow } from '../../../../lib/settings-service';
import { hasPermission } from '../../../../lib/permissions';
import {
  CostLimitCheckUnavailableError,
  CostLimitExceededError,
  checkCostLimit,
  withUserCostLock,
} from '../../../../lib/usage';
import { extractTasksFromTranscript, listTasks, listWorkspaceMembers, replaceProposedTranscriptTasks } from '../../../../lib/tasks';

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'task.write')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
  }

  const orgId = req.org.id;
  const userId = req.userId;
  const transcriptionId = Number(req.query.id);
  if (!Number.isFinite(transcriptionId)) return res.status(400).json({ message: 'Ungültige ID' });

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'task-extract',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const result = await query(
      `SELECT t.id, t.organization_id, t.user_id, t.status, t.text, t.segments, t.speakers,
              d.id AS document_id
         FROM transcriptions t
         LEFT JOIN documents d ON d.transcription_id = t.id AND d.organization_id = t.organization_id
        WHERE t.id = $1 AND t.organization_id = $2`,
      [transcriptionId, orgId],
    );
    const transcription = result.rows[0];
    if (!transcription) return res.status(404).json({ message: 'Transkription nicht gefunden' });
    if (!['transcribed', 'completed'].includes(transcription.status)) {
      return res.status(400).json({ message: 'Aufgaben können erst nach abgeschlossener Transkription extrahiert werden.' });
    }
    if (!String(transcription.text || '').trim()) {
      return res.status(400).json({ message: 'Kein Transkripttext vorhanden.' });
    }

    const cortecs = await resolveCortecsConfig({ userId, organizationId: orgId });
    if (!cortecs.apiKey) return res.status(400).json({ message: 'Kein Cortecs API-Key konfiguriert' });
    const settings = await getSettingsRow(userId);
    const members = await listWorkspaceMembers(orgId);

    const extraction = await withUserCostLock(userId, async () => {
      const costCheck = await checkCostLimit(userId, orgId);
      if (!costCheck.allowed) throw new CostLimitExceededError(costCheck.currentCost, costCheck.limit);
      return extractTasksFromTranscript({
        transcription,
        members,
        cortecs,
        userId,
        organizationId: orgId,
        language: settings?.language || 'de',
      });
    });

    const inserted = await replaceProposedTranscriptTasks({
      organizationId: orgId,
      transcriptionId,
      documentId: transcription.document_id || null,
      createdBy: userId,
      tasks: extraction.tasks,
    });

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'task.extracted',
      targetType: 'transcription',
      targetId: String(transcriptionId),
      metadata: { count: inserted.length, model: extraction.model },
    });

    const tasks = await listTasks({ organizationId: orgId, transcriptionId });
    return res.status(200).json({ tasks, extractedCount: inserted.length, model: extraction.model });
  } catch (error) {
    if (error?.code === 'COST_LIMIT_EXCEEDED' || error?.code === 'BUDGET_GUARDRAIL_EXCEEDED') {
      return res.status(429).json({ message: error.message });
    }
    if (error instanceof CostLimitCheckUnavailableError || error?.code === 'COST_CHECK_UNAVAILABLE') {
      return res.status(503).json({ message: error.message });
    }
    logApiError('Task extraction failed', error);
    return serverError(res, 'Aufgaben konnten nicht extrahiert werden.');
  }
}

export default withOrgScope({ permission: 'task.read' }, handler);
