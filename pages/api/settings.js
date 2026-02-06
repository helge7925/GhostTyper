export default function handler(req, res) {
  switch (req.method) {
    case 'GET':
      // Stub: return default settings
      return res.status(200).json({
        apiKeyConfigured: false,
        templates: [],
      });

    case 'PUT':
      // Stub: save settings
      return res.status(200).json({
        message: 'Settings saved (stub)',
      });

    default:
      return res.status(405).json({ message: 'Method not allowed' });
  }
}
