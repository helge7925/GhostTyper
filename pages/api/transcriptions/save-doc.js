import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { query } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: 'Nicht authentifiziert' });
  }

  const { title, text, documentHtml, template } = req.body;

  if (!title || !documentHtml) {
    return res.status(400).json({ message: 'Titel und Inhalt sind erforderlich' });
  }

  try {
    const result = await query(
      `INSERT INTO transcriptions (
        user_id, filename, original_name, file_path, file_size, 
        mime_type, status, template, text, document_html
      )
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9)
       RETURNING id`,
      [
        session.user.id,
        'doc_' + Date.now(),
        title,
        'INTERNAL_DOC', // Placeholder for file_path
        0,
        'application/vnd.ghosttyper.doc',
        template || 'text-assistant',
        text || '',
        documentHtml
      ]
    );

    return res.status(201).json({ id: result.rows[0].id, message: 'Dokument gespeichert' });
  } catch (error) {
    console.error('Save doc error:', error);
    return res.status(500).json({ message: 'Fehler beim Speichern des Dokuments' });
  }
}
