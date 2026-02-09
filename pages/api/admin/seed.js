import bcrypt from 'bcryptjs';
import { query } from '../../../lib/db';

/**
 * POST /api/admin/seed
 * Creates the initial admin user. Only works if no admin exists yet.
 * Body: { email, name, password }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const existing = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Admin-User existiert bereits' });
    }

    const { email, name, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email und Passwort sind erforderlich' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Passwort muss mindestens 8 Zeichen lang sein' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id, email, name, role",
      [email, name || null, passwordHash]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Admin seed error:', error);
    return res.status(500).json({ message: 'Admin-Erstellung fehlgeschlagen' });
  }
}
