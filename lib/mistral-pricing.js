import { resolveProviderPrice as resolveProviderPriceReal } from './pricing-service.js';
import { PricingConfigurationError } from './pricing-core.js';
import { MISTRAL_LIVE_TRANSCRIPTION_MODEL } from './mistral.js';

// Mirrors lib/edenai-pricing.js's findMissingEdenAiPrices, scaled down to
// Mistral's single consumer so far. Only one operation exists today
// (meeting_transcription, billed by lib/budget-runtime.js's
// checkpointMeetingStt) — this list grows the same way EDENAI_OPERATIONS
// does if a second direct-Mistral feature (e.g. live-meeting translation,
// see lib/mistral.js's comment) is ever added.
export const MISTRAL_OPERATIONS = Object.freeze({
  liveTranscription: ['meeting_transcription'],
});

// Unlike EdenAI, Mistral has no per-capability activation step — saving
// an API key is the only "go live" moment (see
// pages/api/organizations/integrations/mistral.js). This gate is called
// from that same PUT handler so a key can't be saved (and therefore
// can't start being used by a real meeting) until every operation it
// would bill has a manually-created price row in provider_price_versions
// — closing the gap flagged in
// migrate-live-meeting-stt-to-edenai/status.md's Outstanding section:
// previously a saved key went live immediately with no pricing
// pre-flight, unlike every EdenAI capability's activate.js check.
export async function findMissingMistralPrices({
  organizationId,
  resolveProviderPrice = resolveProviderPriceReal,
}) {
  const model = MISTRAL_LIVE_TRANSCRIPTION_MODEL;
  const missing = [];
  for (const operation of MISTRAL_OPERATIONS.liveTranscription) {
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
