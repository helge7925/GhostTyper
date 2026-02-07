export default function handler(req, res) {
  const { id } = req.query;

  switch (req.method) {
    case 'GET':
      // Stub: return mock transcription detail
      return res.status(200).json({
        id,
        filename: `audio_${id}.mp3`,
        status: 'completed',
        createdAt: '2024-01-15T10:30:00Z',
        text: 'Dies ist ein Beispiel-Transkriptionstext.',
        analysis: 'Zusammenfassung: Beispiel-Analyse.',
      });

    case 'DELETE':
      // Stub: delete transcription
      return res.status(200).json({
        message: `Transcription ${id} deleted (stub)`,
      });

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
