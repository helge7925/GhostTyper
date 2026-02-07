export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // Stub: file upload handling will be implemented in Phase 3
  return res.status(200).json({
    id: 'stub-' + Date.now(),
    message: 'Upload stub - implementation pending',
    status: 'pending',
  });
}
