import { query } from '../../../../lib/db';
import { withOrgScope } from '../../../../lib/api/with-org-scope';
import { enforceRateLimit, logApiError, serverError } from '../../../../lib/api-utils';
import { logAuditEvent } from '../../../../lib/audit-log';
import { resolveNextcloudConfig } from '../../../../lib/integrations';
import { ensureFolder, uploadFile } from '../../../../lib/api/nextcloud';

function sanitizeFilenamePart(value, fallback) {
  const clean = String(value || '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

function renderValueMarkdown(value, depth = 0) {
  const indent = '  '.repeat(depth);
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') {
        const parts = Object.entries(item)
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        return `${indent}- ${parts.join(' · ')}`;
      }
      return `${indent}- ${item}`;
    }).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${indent}- **${k}:** ${typeof v === 'object' ? '\n' + renderValueMarkdown(v, depth + 1) : v}`)
      .join('\n');
  }
  return `${indent}${value}`;
}

function analysisToMarkdown(analysis) {
  if (!analysis || typeof analysis !== 'object') return '';
  const sections = [];
  for (const [key, value] of Object.entries(analysis)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    const heading = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    sections.push(`## ${heading}\n\n${renderValueMarkdown(value)}`);
  }
  return sections.join('\n\n');
}

function buildMarkdown(row) {
  const title = row.original_name || `Transkription ${row.id}`;
  const lines = [`# ${title}`, ''];
  if (row.created_at) {
    lines.push(`*${new Date(row.created_at).toLocaleString('de-DE')}*`, '');
  }
  const analysisMd = analysisToMarkdown(row.analysis);
  if (analysisMd) {
    lines.push(analysisMd, '');
  }
  if (row.text && String(row.text).trim()) {
    lines.push('## Transkript', '', String(row.text).trim(), '');
  }
  return lines.join('\n');
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const orgId = req.org.id;
  const userId = req.userId;
  const transId = Number(req.query.id);
  if (!Number.isFinite(transId)) {
    return res.status(400).json({ message: 'Ungültige ID' });
  }

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'export-nextcloud',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  try {
    const cfg = await resolveNextcloudConfig(orgId);
    if (!cfg.enabled || !cfg.baseUrl || !cfg.username || !cfg.appPassword) {
      return res.status(400).json({ message: 'Nextcloud ist nicht konfiguriert oder deaktiviert.' });
    }

    const result = await query(
      'SELECT id, original_name, text, analysis, created_at FROM transcriptions WHERE id = $1 AND organization_id = $2',
      [transId, orgId],
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ message: 'Eintrag nicht gefunden' });
    }

    const markdown = buildMarkdown(row);
    const filename = `${sanitizeFilenamePart(row.original_name, `transkription-${row.id}`)}-${row.id}.md`;
    const folder = cfg.targetFolder || 'GhostTyper';

    await ensureFolder(cfg, folder);
    const remotePath = await uploadFile(cfg, `${folder}/${filename}`, Buffer.from(markdown, 'utf8'), 'text/markdown; charset=utf-8');

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: 'transcription.export.nextcloud',
      targetType: 'transcription',
      targetId: String(transId),
      metadata: { remotePath },
    });

    return res.status(200).json({ ok: true, remotePath });
  } catch (error) {
    logApiError('Nextcloud export failed', error);
    if (error?.status === 401) {
      return res.status(502).json({ message: 'Nextcloud-Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.' });
    }
    return serverError(res, 'Export nach Nextcloud fehlgeschlagen.');
  }
}

export default withOrgScope({ permission: 'transcription.read' }, handler);
