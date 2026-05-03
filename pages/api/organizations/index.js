import { withOrgScope } from '../../../lib/api/with-org-scope';

/**
 * Lists every organisation the current user belongs to. Already encoded in
 * the JWT (req.memberships), so this is a pure passthrough — useful when
 * the client wants a fresh snapshot without forcing a session refresh.
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    return;
  }
  res.status(200).json({
    currentOrganizationId: req.org.id,
    organizations: req.memberships,
  });
}

export default withOrgScope(handler);
