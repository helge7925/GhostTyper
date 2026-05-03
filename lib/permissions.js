/**
 * Org-scoped role → permission matrix.
 *
 * Every authenticated request is associated with one active organization
 * (currentOrganizationId in the JWT) and a role within that org. Every
 * mutation is permission-checked against this matrix; the lookup is
 * O(1) and deterministic.
 *
 * Roles (least to most powerful):
 *   viewer    — read-only across the org
 *   auditor   — viewer + audit-log access (compliance staff)
 *   member    — can create/edit own work, can't manage org settings
 *   admin     — member + manage members, settings, org-wide templates
 *   owner     — admin + billing + transfer/delete the org
 *
 * UX-Konvention: missing permission → button is disabled with a tooltip
 * explaining the requirement. Don't hide actions silently.
 */

export const ROLES = ['viewer', 'auditor', 'member', 'admin', 'owner'];

export const PERMISSIONS = {
  // Transcriptions
  'transcription.read':   ['viewer', 'auditor', 'member', 'admin', 'owner'],
  'transcription.write':  ['member', 'admin', 'owner'],
  'transcription.delete': ['admin', 'owner'],

  // Remote-meeting bots (Vexa)
  'meeting.start':        ['member', 'admin', 'owner'],
  'meeting.admin':        ['admin', 'owner'],

  // Templates (text + table)
  'template.read':        ['viewer', 'auditor', 'member', 'admin', 'owner'],
  'template.write':       ['member', 'admin', 'owner'],
  'template.delete':      ['member', 'admin', 'owner'],
  'template.org':         ['admin', 'owner'], // mark a template as org-wide

  // Folders
  'folder.read':          ['viewer', 'auditor', 'member', 'admin', 'owner'],
  'folder.write':         ['member', 'admin', 'owner'],
  'folder.delete':        ['admin', 'owner'],

  // Org administration
  'org.read':             ['viewer', 'auditor', 'member', 'admin', 'owner'],
  'org.settings':         ['admin', 'owner'],
  'org.members.read':     ['member', 'admin', 'owner'],
  'org.members.write':    ['admin', 'owner'],
  'org.invites.create':   ['admin', 'owner'],
  'org.billing':          ['owner'],
  'org.delete':           ['owner'],

  // Audit log
  'audit.read':           ['auditor', 'admin', 'owner'],
  'audit.export':         ['auditor', 'admin', 'owner'],
};

/**
 * Returns true iff `role` grants `permission`.
 * Unknown permissions resolve to `false` (fail-closed).
 */
export function hasPermission(role, permission) {
  if (!role || !permission) return false;
  const allowed = PERMISSIONS[permission];
  return Array.isArray(allowed) ? allowed.includes(role) : false;
}

/**
 * Throw a structured error if the role doesn't carry the permission.
 * Use inside API handlers; pair with `with-org-scope.js`.
 */
export function assertPermission(role, permission) {
  if (!hasPermission(role, permission)) {
    const error = new Error(`Forbidden: ${permission} requires a higher role.`);
    error.status = 403;
    error.code = 'FORBIDDEN';
    error.permission = permission;
    throw error;
  }
}
