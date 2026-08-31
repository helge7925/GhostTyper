import { resolveProviderPrice as resolveProviderPriceReal } from './pricing-service.js';
import { PricingConfigurationError } from './pricing-core.js';

// Lives next to lib/openrouter-pricing.js's OPERATIONS map, not merged
// into it — same shape, different provider, and a genuinely different
// grouping: on OpenRouter, `ocr` is its own independently-configurable
// capability/model (see resolveConfiguredModel(openrouter, 'ocr', ...)
// call sites), but on EdenAI it has no capability or hardcoded model of
// its own — like `translation`, it routes through `chat`'s one hardcoded
// vision-capable model (see lib/edenai.js's EDENAI_HARDCODED_MODEL
// comment for why). The `ocr` *operation* name stays distinct here for
// billing/audit granularity even though the provider/model resolution is
// unified. Reflects the operation lists already decided in each workload
// migration change's own design (migrate-translation-to-edenai,
// migrate-batch-transcription-to-edenai, migrate-ocr-extraction-to-edenai,
// migrate-live-meeting-stt-to-edenai, migrate-chat-tts-and-decommission-openrouter).
export const EDENAI_OPERATIONS = Object.freeze({
  chat: ['analysis', 'text_optimization', 'template_generation', 'knowledge_prep', 'translation', 'office_translation', 'live_translation', 'ocr'],
  transcription: ['transcription'],
  liveTranscription: ['meeting_transcription'],
  tts: ['tts', 'live_tts', 'live_tts_share', 'in_meeting_tts'],
});

// Unlike syncAllowedOpenRouterPrices, this never creates a price row —
// EdenAI has no live pricing-rate catalogue to derive one from (see
// add-edenai-provider-foundation's design.md). It only reports what is
// missing so an admin can create it manually via the existing
// /admin/prices UI before activation is allowed to proceed.
export async function findMissingEdenAiPrices({
  capability,
  model,
  organizationId,
  resolveProviderPrice = resolveProviderPriceReal,
}) {
  const operations = EDENAI_OPERATIONS[capability] || [];
  const missing = [];
  for (const operation of operations) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await resolveProviderPrice({ provider: 'edenai', model, operation, organizationId });
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
