import { requireAdmin } from '../../../lib/admin';
import pool, { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { logAuditEvent } from '../../../lib/audit-log';

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
}

export default async function handler(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;

  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'admin-organizations',
    identifier: `admin:${session.user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT o.id, o.name, o.slug, o.is_personal, o.created_at,
                  COUNT(m.user_id)::int AS member_count
             FROM organizations o
        LEFT JOIN organization_members m ON m.organization_id = o.id
            GROUP BY o.id
            ORDER BY o.is_personal DESC, o.created_at ASC`,
        );
        return res.status(200).json({ organizations: result.rows });
      } catch (error) {
        logApiError('Admin orgs list failed', error);
        return serverError(res, 'Workspaces konnten nicht geladen werden.');
      }
    }
    case 'POST': {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const rawName = typeof body.name === 'string' ? body.name.trim() : '';
      const rawSlug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      if (!rawName) return res.status(400).json({ message: 'Name ist erforderlich.' });
      if (rawName.length > 160) return res.status(400).json({ message: 'Name ist zu lang.' });

      let slug = rawSlug || slugify(rawName);
      if (!SLUG_REGEX.test(slug)) slug = slugify(rawName);

      const ownerEmail = typeof body.ownerEmail === 'string' ? body.ownerEmail.trim().toLowerCase() : '';
      const adminUserId = Number(session.user.id);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Resolve target owner: admin themself by default, or a named user.
        let ownerUserId = adminUserId;
        if (ownerEmail) {
          const userRes = await client.query(
            'SELECT id FROM users WHERE LOWER(email) = $1',
            [ownerEmail],
          );
          if (userRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Kein User mit E-Mail ${ownerEmail} gefunden.` });
          }
          ownerUserId = userRes.rows[0].id;
        }

        // Ensure unique slug — collision-tolerant suffix.
        let candidate = slug;
        for (let i = 0; i < 5; i++) {
          const exists = await client.query('SELECT 1 FROM organizations WHERE slug = $1', [candidate]);
          if (exists.rowCount === 0) break;
          candidate = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
        }

        const insertRes = await client.query(
          `INSERT INTO organizations (name, slug, plan, is_personal)
           VALUES ($1, $2, 'free', false)
           RETURNING id, name, slug, is_personal`,
          [rawName, candidate],
        );
        const orgId = insertRes.rows[0].id;

        await client.query(
          `INSERT INTO organization_members (organization_id, user_id, role, invited_by)
           VALUES ($1, $2, 'owner', $3)
           ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [orgId, ownerUserId, adminUserId],
        );

        await client.query('COMMIT');

        await logAuditEvent({
          userId: adminUserId,
          organizationId: orgId,
          action: 'admin.organization.created',
          targetType: 'organization',
          targetId: String(orgId),
          metadata: { name: rawName, slug: candidate, ownerUserId },
        });

        return res.status(201).json({
          id: orgId,
          name: rawName,
          slug: candidate,
          ownerUserId,
        });
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* noop */ }
        logApiError('Admin orgs create failed', error);
        return serverError(res, 'Workspace konnte nicht angelegt werden.');
      } finally {
        client.release();
      }
    }
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
}
