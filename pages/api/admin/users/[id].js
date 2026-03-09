import bcrypt from 'bcryptjs';
import { requireAdmin } from '../../../../lib/admin';
import pool, { query } from '../../../../lib/db';
import { validatePassword } from '../../../../lib/constants';
import { serializeApiKeyForStorage } from '../../../../lib/settings-service';
import { enforceRateLimit, logApiError } from '../../../../lib/api-utils';
import { isValidEmail, normalizeEmail } from '../../../../lib/email';

export default async function handler(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'admin-user-item',
    identifier: `admin:${session.user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const { id } = req.query;
  const userId = parseInt(id, 10);
  const sessionUserId = Number(session.user.id);

  if (isNaN(userId)) {
    return res.status(400).json({ message: 'Ungültige User-ID' });
  }

  switch (req.method) {
    case 'PUT': {
      const { email, name, password, role, mistralApiKey, googleApiKey, costLimit } = req.body;
      const shouldUpdateEmail = email !== undefined;
      const normalizedEmail = shouldUpdateEmail ? normalizeEmail(email) : null;
      if (password) {
        const passwordError = validatePassword(password);
        if (passwordError) return res.status(400).json({ message: passwordError });
      }
      if (shouldUpdateEmail && (!normalizedEmail || !isValidEmail(normalizedEmail))) {
        return res.status(400).json({ message: 'Ungültige E-Mail-Adresse' });
      }
      const shouldUpdateCostLimit = costLimit !== undefined;
      const shouldUpdateApiKey = mistralApiKey !== undefined;
      const shouldClearApiKey = shouldUpdateApiKey && (mistralApiKey === null || mistralApiKey === '');
      const shouldUpdateGoogleApiKey = googleApiKey !== undefined;
      const shouldClearGoogleApiKey = shouldUpdateGoogleApiKey && (googleApiKey === null || googleApiKey === '');

      let normalizedCostLimit = null;
      if (shouldUpdateCostLimit && costLimit !== null && costLimit !== '') {
        const parsedLimit = Number(costLimit);
        if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
          return res.status(400).json({ message: 'Ungültiges Kostenlimit' });
        }
        normalizedCostLimit = parsedLimit;
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const apiKeyPayload = shouldUpdateApiKey && !shouldClearApiKey
          ? serializeApiKeyForStorage(String(mistralApiKey).trim())
          : { plainApiKey: null, encryptedApiKey: null };
        const googleApiKeyPayload = shouldUpdateGoogleApiKey && !shouldClearGoogleApiKey
          ? serializeApiKeyForStorage(String(googleApiKey).trim())
          : { plainApiKey: null, encryptedApiKey: null };

        const existing = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        if (existing.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'User nicht gefunden' });
        }

        // Prevent admin from removing their own admin role
        if (userId === sessionUserId && role && role !== 'admin') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Sie können Ihre eigene Admin-Rolle nicht entfernen' });
        }

        // Update user fields
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (shouldUpdateEmail) {
          // Check email uniqueness
          const emailCheck = await client.query(
            'SELECT id FROM users WHERE lower(email) = $1 AND id != $2',
            [normalizedEmail, userId]
          );
          if (emailCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'Diese Email wird bereits verwendet' });
          }
          updates.push(`email = $${paramIndex++}`);
          values.push(normalizedEmail);
        }

        if (name !== undefined) {
          updates.push(`name = $${paramIndex++}`);
          values.push(name || null);
        }

        if (password) {
          const passwordHash = await bcrypt.hash(password, 12);
          updates.push(`password_hash = $${paramIndex++}`);
          values.push(passwordHash);
        }

        if (role !== undefined) {
          updates.push(`role = $${paramIndex++}`);
          values.push(role === 'admin' ? 'admin' : 'user');
        }

        if (updates.length > 0) {
          updates.push(`updated_at = NOW()`);
          values.push(userId);
          await client.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
          );
        }

        if (shouldUpdateApiKey || shouldUpdateGoogleApiKey || shouldUpdateCostLimit) {
          await client.query(
            `INSERT INTO settings (
               user_id,
               mistral_api_key,
               mistral_api_key_encrypted,
               google_api_key,
               google_api_key_encrypted,
               cost_limit,
               updated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
               mistral_api_key = CASE
                 WHEN $7 THEN NULL
                 WHEN $8 THEN $2
                 ELSE settings.mistral_api_key
               END,
               mistral_api_key_encrypted = CASE
                 WHEN $7 THEN NULL
                 WHEN $8 THEN $3
                 ELSE settings.mistral_api_key_encrypted
               END,
               google_api_key = CASE
                 WHEN $9 THEN NULL
                 WHEN $10 THEN $4
                 ELSE settings.google_api_key
               END,
               google_api_key_encrypted = CASE
                 WHEN $9 THEN NULL
                 WHEN $10 THEN $5
                 ELSE settings.google_api_key_encrypted
               END,
               cost_limit = CASE
                 WHEN $11 THEN $6
                 ELSE settings.cost_limit
               END,
               updated_at = NOW()`,
            [
              userId,
              apiKeyPayload.plainApiKey,
              apiKeyPayload.encryptedApiKey,
              googleApiKeyPayload.plainApiKey,
              googleApiKeyPayload.encryptedApiKey,
              normalizedCostLimit,
              shouldClearApiKey,
              shouldUpdateApiKey,
              shouldClearGoogleApiKey,
              shouldUpdateGoogleApiKey,
              shouldUpdateCostLimit,
            ]
          );
        }

        // Return updated user
        const result = await client.query(
          `SELECT u.id, u.email, u.name, u.role, u.created_at,
                  (s.mistral_api_key IS NOT NULL OR s.mistral_api_key_encrypted IS NOT NULL) AS api_key_configured,
                  (s.google_api_key IS NOT NULL OR s.google_api_key_encrypted IS NOT NULL) AS google_api_key_configured,
                  s.preferred_model, s.cost_limit
           FROM users u
           LEFT JOIN settings s ON s.user_id = u.id
           WHERE u.id = $1`,
          [userId]
        );

        await client.query('COMMIT');
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback errors
        }
        logApiError('Admin update user error', error);
        return res.status(500).json({ message: 'User-Aktualisierung fehlgeschlagen' });
      } finally {
        client.release();
      }
    }

    case 'DELETE': {
      // Prevent admin from deleting themselves
      if (userId === sessionUserId) {
        return res.status(400).json({ message: 'Sie können Ihr eigenes Konto nicht löschen' });
      }

      try {
        const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'User nicht gefunden' });
        }
        return res.status(200).json({ message: 'User gelöscht' });
      } catch (error) {
        logApiError('Admin delete user error', error);
        return res.status(500).json({ message: 'User-Löschung fehlgeschlagen' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
