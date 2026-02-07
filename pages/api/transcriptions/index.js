import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  switch (req.method) {
    case 'GET': {
      const result = await query(
        `SELECT id, original_name, status, template, created_at, updated_at
         FROM transcriptions
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [session.user.id]
      );
      return res.status(200).json(result.rows);
    }

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
