import { query } from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';
import { hasPermission } from '../../../lib/permissions';

async function loadTranscriptSnapshot(contextRefId, organizationId) {
  if (!contextRefId) return null;
  const result = await query(
    'SELECT text, original_name, template, status FROM transcriptions WHERE id = $1 AND organization_id = $2',
    [contextRefId, organizationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return JSON.stringify({ text: row.text, name: row.original_name, template: row.template, status: row.status });
}

async function handler(req, res) {
  const orgId = req.org.id;
  const userId = req.userId;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'chat-conversations',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const list = await query(
          `SELECT id, title, context_source, context_ref_id, message_count, created_at, updated_at
             FROM chat_conversations
            WHERE organization_id = $1 AND user_id = $2
            ORDER BY updated_at DESC`,
          [orgId, userId],
        );
        return res.status(200).json({ conversations: list.rows });
      } catch (error) {
        logApiError('Chat conversations GET failed', error);
        return serverError(res, 'Chat-Liste konnte nicht geladen werden.');
      }
    }
    case 'POST': {
      if (!hasPermission(req.role, 'chat.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }

      try {
        const { title, contextSource, contextRefId, _contextSnapshotText } = req.body && typeof req.body === 'object' ? req.body : {};
        let contextSnapshot = null;
        if (contextRefId) {
          contextSnapshot = await loadTranscriptSnapshot(Number(contextRefId), orgId);
        } else if (_contextSnapshotText && typeof _contextSnapshotText === 'string') {
          contextSnapshot = JSON.stringify({ text: _contextSnapshotText, name: title || null, template: null, status: null });
        }
        const defaultTitle = title
          || (contextSnapshot ? 'Chat zu Transkription' : 'Neuer Chat');

        const result = await query(
          `INSERT INTO chat_conversations (organization_id, user_id, title, context_source, context_ref_id, context_snapshot)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, title, context_source, context_ref_id, message_count, created_at, updated_at`,
          [
            orgId,
            userId,
            String(defaultTitle).slice(0, 255),
            contextSource || null,
            contextRefId ? Number(contextRefId) : null,
            contextSnapshot,
          ],
        );

        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'chat.conversation.created',
          targetType: 'chat_conversation',
          targetId: String(result.rows[0].id),
        });

        return res.status(201).json({ conversation: result.rows[0] });
      } catch (error) {
        logApiError('Chat conversation POST failed', error);
        return serverError(res, 'Chat konnte nicht erstellt werden.');
      }
    }
    case 'DELETE': {
      if (!hasPermission(req.role, 'chat.write')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Keine Berechtigung.' });
      }

      try {
        const id = Number(req.query?.id || req.body?.id);
        if (!Number.isFinite(id)) {
          return res.status(400).json({ message: 'Ungültige ID' });
        }

        const del = await query(
          'DELETE FROM chat_conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3 RETURNING id',
          [id, orgId, userId],
        );
        if (del.rowCount === 0) {
          return res.status(404).json({ message: 'Chat nicht gefunden' });
        }

        await logAuditEvent({
          userId,
          organizationId: orgId,
          action: 'chat.conversation.deleted',
          targetType: 'chat_conversation',
          targetId: String(id),
        });

        return res.status(200).json({ ok: true });
      } catch (error) {
        logApiError('Chat conversation DELETE failed', error);
        return serverError(res, 'Chat konnte nicht gelöscht werden.');
      }
    }
    default:
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}

export default withOrgScope({ permission: 'chat.read' }, handler);
