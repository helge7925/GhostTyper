/**
 * Self-registration is disabled.
 * Users can only be created by an admin via /api/admin/users.
 */
export default async function handler(req, res) {
  return res.status(403).json({
    message: 'Selbstregistrierung ist deaktiviert. Bitte wenden Sie sich an den Administrator.',
  });
}
