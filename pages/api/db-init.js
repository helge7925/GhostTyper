import { initDatabase } from '../../lib/db-init';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const initSecret = req.headers['x-init-secret'];
  if (initSecret !== process.env.NEXTAUTH_SECRET) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  try {
    await initDatabase();
    return res.status(200).json({ message: 'Database initialized' });
  } catch (error) {
    console.error('DB init error:', error);
    return res.status(500).json({ message: 'Database initialization failed' });
  }
}
