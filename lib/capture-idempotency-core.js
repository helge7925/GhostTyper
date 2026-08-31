const CLIENT_CAPTURE_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function normalizeClientCaptureId(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === '') return null;
  const normalized = String(raw).trim().toLowerCase();
  if (!CLIENT_CAPTURE_ID_PATTERN.test(normalized)) {
    const error = new Error('Ungültige Client-Capture-ID');
    error.code = 'INVALID_CLIENT_CAPTURE_ID';
    throw error;
  }
  return normalized;
}

export function isCaptureUniqueViolation(error) {
  return error?.code === '23505'
    && error?.constraint === 'uq_transcriptions_org_user_client_capture_id';
}

export function assertClientCaptureScope({
  clientCaptureId,
  clientCaptureUserId,
  clientCaptureOrganizationId,
  requestUserId,
  requestOrganizationId,
}) {
  if (!clientCaptureId) return;
  const claimedUser = String(clientCaptureUserId ?? '').trim();
  const claimedOrganization = String(clientCaptureOrganizationId ?? '').trim();
  if (!claimedUser || !claimedOrganization) {
    const error = new Error('Capture-Scope fehlt');
    error.code = 'CAPTURE_SCOPE_REQUIRED';
    throw error;
  }
  if (claimedUser !== String(requestUserId) || claimedOrganization !== String(requestOrganizationId)) {
    const error = new Error('Capture gehört zu einem anderen Benutzer oder Workspace');
    error.code = 'CAPTURE_SCOPE_MISMATCH';
    throw error;
  }
}
