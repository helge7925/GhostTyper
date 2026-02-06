export default function handler(req, res) {
  switch (req.method) {
    case 'GET':
      // Stub: return mock transcription list
      return res.status(200).json([
        {
          id: '1',
          filename: 'interview_2024.mp3',
          status: 'completed',
          createdAt: '2024-01-15T10:30:00Z',
        },
        {
          id: '2',
          filename: 'meeting_notes.wav',
          status: 'processing',
          createdAt: '2024-01-16T14:00:00Z',
        },
        {
          id: '3',
          filename: 'podcast_episode.ogg',
          status: 'pending',
          createdAt: '2024-01-17T09:15:00Z',
        },
      ]);

    case 'POST':
      // Stub: create transcription
      return res.status(201).json({
        id: 'stub-' + Date.now(),
        message: 'Transcription created (stub)',
        status: 'pending',
      });

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
