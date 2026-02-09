import bcrypt from 'bcryptjs';
import { requireAdmin } from '../../../../lib/admin';
import { query } from '../../../../lib/db';

export default async function handler(req, res) {
  const session = await requireAdmin(req, res);
  if (!session) return;

  const { id } = req.query;
  const userId = parseInt(id, 10);

  if (isNaN(userId)) {
    return res.status(400).json({ message: 'Ungültige User-ID' });
  }

  switch (req.method) {
    case 'PUT': {
      const { email, name, password, role, mistralApiKey, costLimit } = req.body;

      try {
        const existing = await query('SELECT id FROM users WHERE id = $1', [userId]);
        if (existing.rows.length === 0) {
          return res.status(404).json({ message: 'User nicht gefunden' });
        }

        // Prevent admin from removing their own admin role
        if (userId === session.user.id && role && role !== 'admin') {
          return res.status(400).json({ message: 'Sie können Ihre eigene Admin-Rolle nicht entfernen' });
        }

        // Update user fields
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (email !== undefined) {
          // Check email uniqueness
          const emailCheck = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
          if (emailCheck.rows.length > 0) {
            return res.status(409).json({ message: 'Diese Email wird bereits verwendet' });
          }
          updates.push(`email = $${paramIndex++}`);
          values.push(email);
        }

        if (name !== undefined) {
          updates.push(`name = $${paramIndex++}`);
          values.push(name || null);
        }

        if (password) {
          if (password.length < 8) {
            return res.status(400).json({ message: 'Passwort muss mindestens 8 Zeichen lang sein' });
          }
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
          await query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
          );
        }

        // Update settings (API key + cost limit) — F8
        if (mistralApiKey !== undefined || costLimit !== undefined) {
          const settingsExists = await query('SELECT id FROM settings WHERE user_id = $1', [userId]);

          if (settingsExists.rows.length === 0) {
            await query(
              'INSERT INTO settings (user_id, mistral_api_key, cost_limit) VALUES ($1, $2, $3)',
              [userId, mistralApiKey || null, costLimit ?? null]
            );
          } else {
            const sUpdates = [];
            const sValues = [];
            let sIdx = 1;

            if (mistralApiKey !== undefined) {
              sUpdates.push(`mistral_api_key = $${sIdx++}`);
              sValues.push(mistralApiKey || null);
            }

            if (costLimit !== undefined) {
              sUpdates.push(`cost_limit = $${sIdx++}`);
              sValues.push(costLimit === null || costLimit === '' ? null : costLimit);
            }

            if (sUpdates.length > 0) {
              sUpdates.push('updated_at = NOW()');
              sValues.push(userId);
              await query(
                `UPDATE settings SET ${sUpdates.join(', ')} WHERE user_id = $${sIdx}`,
                sValues
              );
            }
          }
        }

        // Return updated user
        const result = await query(
          `SELECT u.id, u.email, u.name, u.role, u.created_at,
                  s.mistral_api_key IS NOT NULL AS api_key_configured,
                  s.preferred_model, s.cost_limit
           FROM users u
           LEFT JOIN settings s ON s.user_id = u.id
           WHERE u.id = $1`,
          [userId]
        );

        return res.status(200).json(result.rows[0]);
      } catch (error) {
        console.error('Admin update user error:', error);
        return res.status(500).json({ message: 'User-Aktualisierung fehlgeschlagen' });
      }
    }

    case 'DELETE': {
      // Prevent admin from deleting themselves
      if (userId === session.user.id) {
        return res.status(400).json({ message: 'Sie können Ihr eigenes Konto nicht löschen' });
      }

      try {
        const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
        if (result.rows.length === 0) {
          return res.status(404).json({ message: 'User nicht gefunden' });
        }
        return res.status(200).json({ message: 'User gelöscht' });
      } catch (error) {
        console.error('Admin delete user error:', error);
        return res.status(500).json({ message: 'User-Löschung fehlgeschlagen' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
