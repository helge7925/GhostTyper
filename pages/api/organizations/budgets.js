import pool from '../../../lib/db';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { normalizeBudgetPatch } from '../../../lib/budget-core';
import { hasPermission } from '../../../lib/permissions';
import { logAuditEvent } from '../../../lib/audit-log';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { requestEmergencyBudgetStop } from '../../../lib/budget-service';

const usageMicros = `COALESCE(SUM(COALESCE(l.estimated_cost_micros,
  ROUND(COALESCE(l.estimated_cost, 0) * 1000000)::bigint)), 0)::bigint`;

function limitWasRaisedOrRemoved(previous, next) {
  return previous !== null && (next === null || next > previous);
}

async function listBudgets(orgId) {
  const [settings, members, reserved] = await Promise.all([
    pool.query(
      `SELECT cost_limit_cents, member_monthly_budget_limit_cents, updated_at
         FROM organization_settings WHERE organization_id = $1`,
      [orgId],
    ),
    pool.query(
      `SELECT u.id AS user_id, u.email, u.name, m.role,
              mb.monthly_limit_micros, mb.migrated_from_legacy, mb.updated_at,
              ${usageMicros} AS committed_micros
         FROM organization_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN organization_member_budgets mb
           ON mb.organization_id = m.organization_id AND mb.user_id = m.user_id
         LEFT JOIN usage_log l
           ON l.organization_id = m.organization_id AND l.user_id = m.user_id
          AND l.created_at >= date_trunc('month', NOW())
        WHERE m.organization_id = $1
        GROUP BY u.id, u.email, u.name, m.role, mb.monthly_limit_micros,
                 mb.migrated_from_legacy, mb.updated_at
        ORDER BY u.email`,
      [orgId],
    ),
    pool.query(
      `SELECT user_id, COALESCE(SUM(amount_micros), 0)::bigint AS reserved_micros
         FROM budget_reservations
        WHERE organization_id = $1 AND period_start = date_trunc('month', NOW())::date
          AND state = 'reserved' GROUP BY user_id`,
      [orgId],
    ),
  ]);
  const row = settings.rows[0] || {};
  const reservedByUser = new Map(reserved.rows.map((item) => [String(item.user_id), Number(item.reserved_micros)]));
  return {
    month: new Date().toISOString().slice(0, 7),
    workspaceLimitMicros: row.cost_limit_cents > 0 ? Number(row.cost_limit_cents) * 10_000 : null,
    defaultMemberLimitMicros: row.member_monthly_budget_limit_cents > 0
      ? Number(row.member_monthly_budget_limit_cents) * 10_000 : null,
    updatedAt: row.updated_at || null,
    members: members.rows.map((member) => ({
      userId: member.user_id,
      email: member.email,
      name: member.name,
      role: member.role,
      monthlyLimitMicros: member.monthly_limit_micros === null ? null : Number(member.monthly_limit_micros),
      migratedFromLegacy: member.migrated_from_legacy === true,
      committedMicros: Number(member.committed_micros),
      reservedMicros: reservedByUser.get(String(member.user_id)) || 0,
      updatedAt: member.updated_at || null,
    })),
  };
}

async function updateBudgets(req) {
  const patch = normalizeBudgetPatch(req.body || {});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO organization_settings (organization_id, updated_at) VALUES ($1, NOW())
       ON CONFLICT (organization_id) DO NOTHING`,
      [req.org.id],
    );
    const oldSettings = await client.query(
      `SELECT cost_limit_cents, member_monthly_budget_limit_cents
         FROM organization_settings WHERE organization_id = $1 FOR UPDATE`,
      [req.org.id],
    );
    const oldValues = {
      workspaceLimitMicros: oldSettings.rows[0]?.cost_limit_cents > 0
        ? Number(oldSettings.rows[0].cost_limit_cents) * 10_000 : null,
      defaultMemberLimitMicros: oldSettings.rows[0]?.member_monthly_budget_limit_cents > 0
        ? Number(oldSettings.rows[0].member_monthly_budget_limit_cents) * 10_000 : null,
    };
    const newValues = {};
    const hasWorkspacePatch = Object.prototype.hasOwnProperty.call(patch, 'workspaceLimitMicros');
    const hasDefaultPatch = Object.prototype.hasOwnProperty.call(patch, 'defaultMemberLimitMicros');
    const nextDefaultLimit = hasDefaultPatch
      ? patch.defaultMemberLimitMicros
      : oldValues.defaultMemberLimitMicros;
    const supersedeWorkspaceAbort = hasWorkspacePatch
      && limitWasRaisedOrRemoved(oldValues.workspaceLimitMicros, patch.workspaceLimitMicros);
    const supersedeDefaultMemberAborts = hasDefaultPatch
      && limitWasRaisedOrRemoved(oldValues.defaultMemberLimitMicros, patch.defaultMemberLimitMicros);
    const supersededMemberIds = [];
    if (hasWorkspacePatch) {
      await client.query(
        `UPDATE organization_settings SET cost_limit_cents = $2, updated_at = NOW() WHERE organization_id = $1`,
        [req.org.id, patch.workspaceLimitMicros === null ? null : patch.workspaceLimitMicros / 10_000],
      );
      newValues.workspaceLimitMicros = patch.workspaceLimitMicros;
      if (supersedeWorkspaceAbort) {
        await client.query(
          `UPDATE organization_budget_periods
              SET state = 'open', blocked_at = NULL, version = version + 1, updated_at = NOW()
            WHERE organization_id = $1 AND period_start = date_trunc('month', NOW())::date`,
          [req.org.id],
        );
      }
    }
    if (hasDefaultPatch) {
      await client.query(
        `UPDATE organization_settings SET member_monthly_budget_limit_cents = $2, updated_at = NOW() WHERE organization_id = $1`,
        [req.org.id, patch.defaultMemberLimitMicros === null ? null : patch.defaultMemberLimitMicros / 10_000],
      );
      newValues.defaultMemberLimitMicros = patch.defaultMemberLimitMicros;
    }
    let memberOldValue;
    if (patch.member) {
      const membership = await client.query(
        `SELECT mb.monthly_limit_micros
           FROM organization_members m
           LEFT JOIN organization_member_budgets mb
             ON mb.organization_id = m.organization_id AND mb.user_id = m.user_id
          WHERE m.organization_id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
        [req.org.id, patch.member.userId],
      );
      if (!membership.rowCount) throw Object.assign(new Error('Workspace member not found.'), { code: 'MEMBER_NOT_FOUND' });
      memberOldValue = membership.rows[0].monthly_limit_micros === null
        ? null : Number(membership.rows[0].monthly_limit_micros);
      const oldEffectiveMemberLimit = memberOldValue ?? oldValues.defaultMemberLimitMicros;
      const newEffectiveMemberLimit = patch.member.monthlyLimitMicros ?? nextDefaultLimit;
      if (limitWasRaisedOrRemoved(oldEffectiveMemberLimit, newEffectiveMemberLimit)) {
        supersededMemberIds.push(Number(patch.member.userId));
      }
      if (patch.member.monthlyLimitMicros === null) {
        await client.query(
          `DELETE FROM organization_member_budgets WHERE organization_id = $1 AND user_id = $2`,
          [req.org.id, patch.member.userId],
        );
      } else {
        await client.query(
          `INSERT INTO organization_member_budgets
             (organization_id, user_id, monthly_limit_micros, migrated_from_legacy, updated_by)
           VALUES ($1,$2,$3,false,$4)
           ON CONFLICT (organization_id, user_id) DO UPDATE SET
             monthly_limit_micros = EXCLUDED.monthly_limit_micros,
             migrated_from_legacy = false, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [req.org.id, patch.member.userId, patch.member.monthlyLimitMicros, req.userId],
        );
      }
      newValues.member = patch.member;
    }
    if (supersedeWorkspaceAbort || supersedeDefaultMemberAborts || supersededMemberIds.length) {
      await client.query(
        `UPDATE budget_stop_outbox o
            SET payload = jsonb_set(COALESCE(o.payload, '{}'::jsonb),
                                    '{scopeAbortSuperseded}', 'true'::jsonb, true),
                revision = o.revision + 1,
                updated_at = NOW()
          WHERE o.organization_id = $1
            AND o.period_start = date_trunc('month', NOW())::date
            AND o.state IN ('pending', 'processing')
            AND (
              ($2::boolean AND COALESCE(o.payload->>'scope', '') = 'workspace')
              OR (
                COALESCE(o.payload->>'scope', '') = 'member'
                AND (
                  o.user_id = ANY($3::integer[])
                  OR ($4::boolean AND NOT EXISTS (
                    SELECT 1 FROM organization_member_budgets mb
                     WHERE mb.organization_id = o.organization_id
                       AND mb.user_id = o.user_id
                  ))
                )
              )
            )`,
        [req.org.id, supersedeWorkspaceAbort, supersededMemberIds, supersedeDefaultMemberAborts],
      );
    }
    await logAuditEvent({
      userId: req.userId,
      organizationId: req.org.id,
      action: 'budget.updated',
      targetType: patch.member ? 'organization_member_budget' : 'organization_budget',
      targetId: patch.member ? String(patch.member.userId) : String(req.org.id),
      reason: patch.reason,
      metadata: {
        old: {
          ...oldValues,
          ...(patch.member ? { member: { userId: patch.member.userId, monthlyLimitMicros: memberOldValue } } : {}),
        },
        new: newValues,
      },
      client,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function handler(req, res) {
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'org-budgets', identifier: `org:${req.org.id}:user:${req.userId}`,
    limit: 60, windowMs: 60_000,
  });
  if (!allowed) return;
  try {
    if (req.method === 'GET') return res.status(200).json(await listBudgets(req.org.id));
    if (req.method === 'PATCH') {
      if (!hasPermission(req.role, 'budget.manage')) {
        return res.status(403).json({ code: 'FORBIDDEN', permission: 'budget.manage' });
      }
      await updateBudgets(req);
      return res.status(200).json(await listBudgets(req.org.id));
    }
    if (req.method === 'POST') {
      if (!hasPermission(req.role, 'budget.manage')) {
        return res.status(403).json({ code: 'FORBIDDEN', permission: 'budget.manage' });
      }
      await requestEmergencyBudgetStop({
        organizationId: req.org.id,
        requestedBy: req.userId,
        reason: req.body?.reason,
      });
      return res.status(202).json({ ok: true, state: 'blocked' });
    }
    res.setHeader('Allow', ['GET', 'PATCH', 'POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (error?.code === 'INVALID_BUDGET_INPUT') return res.status(400).json({ code: error.code, message: error.message });
    if (error?.code === 'MEMBER_NOT_FOUND') return res.status(404).json({ code: error.code, message: error.message });
    logApiError('Organization budgets API failed', error);
    return serverError(res, 'Workspace budgets could not be processed.');
  }
}

export default withOrgScope({ permission: 'budget.read.org' }, handler);
