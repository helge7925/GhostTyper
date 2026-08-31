import { withOrgScope } from '../../../../../lib/api/with-org-scope.js';
import { hasPermission } from '../../../../../lib/permissions.js';
import { logAuditEvent } from '../../../../../lib/audit-log.js';
import { getIntegration, upsertIntegration } from '../../../../../lib/integrations.js';
import {
  EDENAI_CAPABILITIES, EDENAI_HARDCODED_MODEL, EDENAI_TTS_DEFAULT_VOICE, normalizeEdenAiConfig,
} from '../../../../../lib/edenai.js';
import { probeEdenAiCapability } from '../../../../../lib/edenai-probes.js';
import { findMissingEdenAiPrices } from '../../../../../lib/edenai-pricing.js';
import { resolveEdenAiConfig } from '../../../../../lib/settings-service.js';
import { logApiError } from '../../../../../lib/api-utils.js';

// Only capabilities with a confirmed, fully self-contained probe payload
// are actually probed here — chat needs none (its "Reply with OK."
// message is built internally, and covers translation/OCR too now that
// neither has an EdenAI-native capability of its own — see
// lib/edenai.js's EDENAI_HARDCODED_MODEL comment), TTS's `{text}` input
// needs no external resource. transcription/liveTranscription have no
// confirmed `input` shape yet (would need a real audio resource this
// route has no honest way to fabricate) — see
// add-edenai-provider-foundation's status.md. Their own migration
// change builds the real probe input once it knows the confirmed shape;
// until then, activation for those capabilities here still enforces the
// pricing checks below, just not a live capability probe. (Moot for
// `liveTranscription` for now anyway — it has no hardcoded model yet,
// see EDENAI_HARDCODED_MODEL, so activation is rejected before reaching
// this check; `transcription` does have one and is genuinely
// probe-skipped for the reason above.)
// `voice` is included explicitly, not left to the provider default —
// live testing during the TTS model decision found the unconfigured
// default voice produces garbled/wrong output for most EdenAI TTS
// models (see lib/edenai.js's EDENAI_HARDCODED_MODEL.tts comment), so
// this probe would otherwise validate connectivity against a code path
// real usage never takes.
const STATIC_PROBE_INPUT = Object.freeze({
  tts: { text: 'EdenAI capability test.', voice: EDENAI_TTS_DEFAULT_VOICE },
});

function canProbeAtFoundationStage(capability) {
  return capability === 'chat' || Object.prototype.hasOwnProperty.call(STATIC_PROBE_INPUT, capability);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }
  if (!hasPermission(req.role, 'meeting.admin')) return res.status(403).json({ code: 'FORBIDDEN' });
  const capability = String(req.body?.capability || '');
  if (!EDENAI_CAPABILITIES.includes(capability)) {
    return res.status(400).json({ code: 'UNKNOWN_CAPABILITY', message: 'Unbekannte Fähigkeit.' });
  }
  const defaultModel = EDENAI_HARDCODED_MODEL[capability];
  if (!defaultModel) {
    return res.status(400).json({ code: 'MODEL_NOT_YET_CONFIGURED', capability, message: `Für "${capability}" ist noch kein Modell festgelegt.` });
  }
  try {
    const orgId = req.org.id;
    const integration = await getIntegration(orgId, 'edenai');
    const normalized = normalizeEdenAiConfig(integration.config || {});
    const effective = await resolveEdenAiConfig({ userId: req.userId, organizationId: orgId, includeDisabled: true });
    if (!effective.apiKey) return res.status(400).json({ code: 'NO_API_KEY' });

    const missingPrices = await findMissingEdenAiPrices({ capability, model: defaultModel, organizationId: orgId });
    if (missingPrices.length) {
      return res.status(400).json({ code: 'PRICE_OVERRIDE_REQUIRED', capability, missing: missingPrices, message: 'Für diese Fähigkeit fehlen manuell hinterlegte Preise.' });
    }

    let probed = false;
    if (canProbeAtFoundationStage(capability)) {
      await probeEdenAiCapability({
        apiKey: effective.apiKey,
        capability,
        model: defaultModel,
        input: STATIC_PROBE_INPUT[capability],
      });
      probed = true;
    }

    const activatedAt = new Date().toISOString();
    const activatedCapabilities = [...new Set([...normalized.activatedCapabilities, capability])];
    await upsertIntegration(orgId, 'edenai', { ...normalized, activatedCapabilities, activatedAt }, true);

    await logAuditEvent({
      userId: req.userId,
      organizationId: orgId,
      action: 'org.integration.edenai.activated',
      targetType: 'organization_integration',
      targetId: `${orgId}:edenai`,
      metadata: { capability, model: defaultModel, activatedAt, probed },
    });
    return res.status(200).json({ ok: true, capability, activatedAt, probed });
  } catch (error) {
    logApiError('EdenAI activation failed', error);
    const safeCodes = new Set(['CAPABILITY_PROBE_FAILED', 'MODEL_UNAVAILABLE', 'PROBE_INPUT_REQUIRED', 'NO_API_KEY']);
    if (safeCodes.has(error?.code)) {
      return res.status(400).json({
        code: error.code,
        capability: error.details?.capability || capability,
        model: error.details?.model || null,
        message: error.message,
      });
    }
    return res.status(502).json({ code: 'EDENAI_ACTIVATION_FAILED', message: 'EdenAI konnte für diese Fähigkeit nicht aktiviert werden. Details wurden serverseitig protokolliert.' });
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
