import { resolveOpenRouterConfig, resolveEdenAiConfig } from './settings-service.js';
import { EDENAI_HARDCODED_MODEL } from './edenai.js';

// The single per-capability routing decision every workload-migration
// change calls instead of inventing its own. Prefers EdenAI for a
// capability only once the integration is enabled, that specific
// capability has been through activate.js's probe/pricing gate, AND a
// hardcoded model has been chosen for it in code
// (EDENAI_HARDCODED_MODEL — see hardcode-edenai-models/design.md; models
// are no longer admin-configured). `enabled` alone is not sufficient —
// EdenAI activates one capability at a time (unlike OpenRouter's atomic
// all-5-at-once activation), so `activatedCapabilities` is the real
// per-capability gate; without it, activating one capability could
// silently make another capability's not-yet-vetted hardcoded model live
// too. Deliberately no automatic cross-provider fallback: a caller that
// gets `provider: 'edenai'` back and then fails to use it must fail
// closed (MODEL_UNAVAILABLE etc.), never silently retry against
// OpenRouter — see add-edenai-provider-foundation's design.md "Provider
// Routing" section.
//
// `resolveEdenAi`/`resolveOpenRouter` are injectable (default to the real
// DB-backed resolvers) so tests can exercise both branches without a
// database, mirroring this repo's existing queryFn-injection convention
// for DB-touching logic.
export async function resolveActiveProviderConfig({
  userId,
  organizationId,
  capability,
  resolveEdenAi = resolveEdenAiConfig,
  resolveOpenRouter = resolveOpenRouterConfig,
}) {
  const edenai = await resolveEdenAi({ userId, organizationId });
  if (
    edenai.enabled
    && edenai.activatedCapabilities?.includes(capability)
    && EDENAI_HARDCODED_MODEL[capability]
  ) {
    return { provider: 'edenai', ...edenai, model: EDENAI_HARDCODED_MODEL[capability] };
  }
  const openrouter = await resolveOpenRouter({ userId, organizationId });
  return { provider: 'openrouter', ...openrouter };
}
