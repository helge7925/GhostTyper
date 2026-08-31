import { withOrgScope } from '../../../../../lib/api/with-org-scope';

async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  return res.status(403).json({
    code: 'BUDGET_ENDPOINT_REQUIRED',
    message: 'Member budget limits are workspace-scoped and must be changed through /api/organizations/budgets.',
  });
}

export default withOrgScope({ permission: 'org.members.read' }, handler);
