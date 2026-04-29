import bcrypt from 'bcryptjs';
import { requireAdmin } from '../../../../lib/admin';
import { query } from '../../../../lib/db';
import { validatePassword } from '../../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { isValidEmail, normalizeEmail } from '../../../../lib/email';
import { logAuditEvent } from '../../../../lib/audit-log';

function normalizeRole(role) {
  return ['admin', 'auditor', 'user'].includes(role) ? role : 'user';
}

export default async function handler(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'admin-users',
    identifier: `admin:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          `SELECT u.id, u.email, u.name, u.role, u.created_at,
                  (s.mistral_api_key IS NOT NULL OR s.mistral_api_key_encrypted IS NOT NULL) AS api_key_configured,
                  s.preferred_model, s.cost_limit
           FROM users u
           LEFT JOIN settings s ON s.user_id = u.id
           ORDER BY u.created_at DESC`
        );
        return res.status(200).json(result.rows);
      } catch (error) {
        logApiError('Admin users list error', error);
        return res.status(500).json({ message: 'Fehler beim Laden der User-Liste' });
      }
    }

    case 'POST': {
      const { email, name, password, role } = req.body;
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail || !password) {
        return res.status(400).json({ message: 'Email und Passwort sind erforderlich' });
      }
      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: 'Ungültige E-Mail-Adresse' });
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ message: passwordError });
      }

      try {
        const existing = await query('SELECT id FROM users WHERE lower(email) = $1', [normalizedEmail]);
        if (existing.rows.length > 0) {
          return res.status(409).json({ message: 'Ein Konto mit dieser Email existiert bereits' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const userRole = normalizeRole(role);

        const result = await query(
          'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
          [normalizedEmail, name || null, passwordHash, userRole]
        );

        await logAuditEvent({
          userId: session.user.id,
          action: 'admin.user.created',
          targetType: 'user',
          targetId: String(result.rows[0].id),
          metadata: { email: normalizedEmail, role: userRole },
        });

        return res.status(201).json(result.rows[0]);
      } catch (error) {
        logApiError('Admin create user error', error);
        return res.status(500).json({ message: 'User-Erstellung fehlgeschlagen' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
