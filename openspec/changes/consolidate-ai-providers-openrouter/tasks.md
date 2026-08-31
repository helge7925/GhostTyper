# Tasks: Consolidate AI Providers On OpenRouter

## 1. Foundation

- [x] Add the encrypted OpenRouter integration, resolver and redacted API.
- [x] Add the model catalogue, cache, capability filters and model policy.
- [x] Add admin allowlists, defaults, TTS voices, tests and activation gate.

## 2. Workloads

- [x] Route chat transformations through OpenRouter.
- [x] Route batch STT and the Vexa bridge through OpenRouter.
- [x] Route TTS through OpenRouter and normalize PCM.
- [x] Route PDF/image OCR through OpenRouter.

## 3. Pricing And Data

- [x] Widen model identifiers to 255 characters.
- [x] Switch pricing, budgets, usage APIs and UI from EUR to USD without FX.
- [x] Sync prices for allowed models and reconcile actual OpenRouter cost.

## 4. Cutover And Cleanup

- [x] Add activation probes and atomic per-workspace cutover.
- [x] Clear legacy secrets and remove direct Cortecs/Mistral runtime calls.
- [x] Replace environment, Docker, privacy and operations documentation.

## 5. Verification

- [x] Add catalogue, governance, provider-contract and migration tests.
- [x] Run `npm run lint`, `npm test` and `npm run build`.
- [x] Run idempotent PostgreSQL migration tests.
- [x] Build and smoke-test production Compose through OrbStack.
- [x] Confirm no production model IDs or legacy inference hosts remain.

## 6. Operational Gates

- [ ] Configure an organization key, allowlists, five defaults and any manual
  audio-price/voice overrides in the target environment.
- [ ] Run the paid activation probes and the real workload smoke matrix.
- [ ] Complete seven error-free operating days before the separately approved
  legacy-column cleanup migration.
