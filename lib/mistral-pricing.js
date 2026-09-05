import { resolveProviderPrice as resolveProviderPriceReal } from './pricing-service.js';
import { PricingConfigurationError } from './pricing-core.js';
import { MISTRAL_LIVE_TRANSCRIPTION_MODEL, MISTRAL_TRANSLATION_MODEL } from './mistral.js';

// Mirrors lib/edenai-pricing.js's findMissingEdenAiPrices, but shaped as a
// flat operation → model map rather than EdenAI's capability → operations
// grouping. That difference is deliberate: EdenAI groups by capability
// because activation is per-capability, whereas Mistral has no activation
// step at all (a saved key switches on every direct-Mistral consumer at
// once — see pages/api/organizations/integrations/mistral.js), so the
// only thing the gate needs is "which model bills which operation".
//
// Two consumers today, on two different models:
//   - meeting_transcription: the realtime STT model, billed per audio
//     second by lib/budget-runtime.js's checkpointMeetingStt.
//   - live_translation: the chat model, billed per token by
//     lib/vexa-bridge.js's runTranslationDelta.
export const MISTRAL_OPERATION_MODELS = Object.freeze({
  meeting_transcription: MISTRAL_LIVE_TRANSCRIPTION_MODEL,
  live_translation: MISTRAL_TRANSLATION_MODEL,
});

// Unlike EdenAI, Mistral has no per-capability activation step — saving
// an API key is the only "go live" moment (see
// pages/api/organizations/integrations/mistral.js). This gate is called
// from that same PUT handler so a key can't be saved (and therefore
// can't start being used by a real meeting) until every operation it
// would bill has a price row in provider_price_versions — closing the gap
// flagged in migrate-live-meeting-stt-to-edenai/status.md's Outstanding
// section: previously a saved key went live immediately with no pricing
// pre-flight, unlike every EdenAI capability's activate.js check.
//
// Because a saved key switches on BOTH consumers at once, this checks
// both models' rows — a key must not go live for translation while its
// translation pricing is missing, even if STT pricing is present.
export async function findMissingMistralPrices({
  organizationId,
  resolveProviderPrice = resolveProviderPriceReal,
}) {
  const missing = [];
  for (const [operation, model] of Object.entries(MISTRAL_OPERATION_MODELS)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await resolveProviderPrice({ provider: 'mistral', model, operation, organizationId });
    } catch (error) {
      if (error instanceof PricingConfigurationError) {
        missing.push({ model, operation });
      } else {
        throw error;
      }
    }
  }
  return missing;
}
