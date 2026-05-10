import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import { validatePassword } from '../../../lib/constants';
import { enforceRateLimit, logApiError } from '../../../lib/api-utils';
import { isValidEmail, normalizeEmail } from '../../../lib/email';
import { hashPassword, verifyPassword } from '../../../lib/password-hash';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'user-profile',
    identifier: `user:${userId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!allowed) return;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          'SELECT id, email, name, avatar_url, role FROM users WHERE id = $1',
          [userId]
        );
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        logApiError('User profile fetch error', error);
        return res.status(500).json({ message: 'Fehler beim Laden des Profils' });
      }
    }

    case 'PUT': {
      const { name, email, avatarUrl, password, currentPassword } = req.body;
      const shouldUpdateEmail = email !== undefined;
      const normalizedEmail = shouldUpdateEmail ? normalizeEmail(email) : null;

      try {
        if (avatarUrl !== undefined && avatarUrl !== null) {
          const isAllowedAvatar =
            /^data:image\//.test(avatarUrl) ||
            /^https?:\/\//i.test(avatarUrl);
          if (!isAllowedAvatar || avatarUrl.length > 2_500_000) {
            return res.status(400).json({ message: 'Ungültiges Profilbild-Format' });
          }
        }

        if (shouldUpdateEmail && (!normalizedEmail || !isValidEmail(normalizedEmail))) {
          return res.status(400).json({ message: 'Ungültige E-Mail-Adresse' });
        }

        // Fetch current user data for password verification.
        // The session JWT can outlive the DB row (admin deletes a user, the
        // token is still valid until expiry). Without this guard the
        // verifyPassword call below would crash on `user.password_hash` of
        // undefined and return a 500 instead of a clean 401.
        const userResult = await query(
          'SELECT password_hash, password_hash_version FROM users WHERE id = $1',
          [userId]
        );
        const user = userResult.rows[0];
        if (!user) {
          return res.status(401).json({ message: 'Sitzung ungültig — Konto nicht mehr vorhanden.' });
        }

        // Update basic info
        if (name !== undefined || shouldUpdateEmail || avatarUrl !== undefined) {
          await query(
            'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), avatar_url = $3, updated_at = NOW() WHERE id = $4',
            [
              typeof name === 'string' ? name.trim().slice(0, 255) : name,
              shouldUpdateEmail ? normalizedEmail : null,
              avatarUrl,
              userId,
            ]
          );
        }

        // Update password if requested
        if (password) {
          if (!currentPassword) {
            return res.status(400).json({ message: 'Das aktuelle Passwort ist erforderlich, um ein neues zu setzen.' });
          }

          const isMatch = await verifyPassword(
            currentPassword,
            user.password_hash,
            user.password_hash_version
          );
          if (!isMatch) {
            return res.status(400).json({ message: 'Das aktuelle Passwort ist nicht korrekt.' });
          }

          const passwordError = validatePassword(password);
          if (passwordError) {
            return res.status(400).json({ message: passwordError });
          }

          const { hash: passwordHash, version: passwordHashVersion } = await hashPassword(password);
          await query(
            'UPDATE users SET password_hash = $1, password_hash_version = $2, updated_at = NOW() WHERE id = $3',
            [passwordHash, passwordHashVersion, userId]
          );
        }

        return res.status(200).json({ message: 'Profil erfolgreich aktualisiert' });
      } catch (error) {
        if (error.code === '23505') {
          return res.status(400).json({ message: 'Diese E-Mail-Adresse wird bereits verwendet' });
        }
        logApiError('Profile update error', error);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren des Profils' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
