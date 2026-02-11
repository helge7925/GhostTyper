import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { validatePassword } from '../../../lib/constants';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const userId = session.user.id;

  switch (req.method) {
    case 'GET': {
      try {
        const result = await query(
          'SELECT id, email, name, avatar_url, role FROM users WHERE id = $1',
          [userId]
        );
        return res.status(200).json(result.rows[0]);
      } catch (error) {
        return res.status(500).json({ message: 'Fehler beim Laden des Profils' });
      }
    }

    case 'PUT': {
      const { name, email, avatarUrl, password, currentPassword } = req.body;

      try {
        if (avatarUrl !== undefined && avatarUrl !== null) {
          const isAllowedAvatar =
            /^data:image\//.test(avatarUrl) ||
            /^https?:\/\//i.test(avatarUrl);
          if (!isAllowedAvatar || avatarUrl.length > 2_500_000) {
            return res.status(400).json({ message: 'Ungültiges Profilbild-Format' });
          }
        }

        // Fetch current user data for password verification
        const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        // Update basic info
        if (name || email || avatarUrl !== undefined) {
          await query(
            'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), avatar_url = $3, updated_at = NOW() WHERE id = $4',
            [name, email, avatarUrl, userId]
          );
        }

        // Update password if requested
        if (password) {
          if (!currentPassword) {
            return res.status(400).json({ message: 'Das aktuelle Passwort ist erforderlich, um ein neues zu setzen.' });
          }

          const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
          if (!isMatch) {
            return res.status(400).json({ message: 'Das aktuelle Passwort ist nicht korrekt.' });
          }

          const passwordError = validatePassword(password);
          if (passwordError) {
            return res.status(400).json({ message: passwordError });
          }

          const passwordHash = await bcrypt.hash(password, 12);
          await query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [passwordHash, userId]
          );
        }

        return res.status(200).json({ message: 'Profil erfolgreich aktualisiert' });
      } catch (error) {
        if (error.code === '23505') {
          return res.status(400).json({ message: 'Diese E-Mail-Adresse wird bereits verwendet' });
        }
        console.error('Profile update error:', error);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren des Profils' });
      }
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
