import bcrypt from 'bcryptjs';
import { query } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { email, name, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email und Passwort sind erforderlich' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Ein Konto mit dieser Email existiert bereits' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, role',
      [email, name || null, passwordHash]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Registrierung fehlgeschlagen' });
  }
}
