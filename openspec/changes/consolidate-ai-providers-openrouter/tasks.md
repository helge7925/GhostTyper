# Tasks: Consolidate AI Providers On OpenRouter

## 1. Foundation

- [ ] Add the encrypted OpenRouter integration, resolver and redacted API.
- [ ] Add the model catalogue, cache, capability filters and model policy.
- [ ] Add admin allowlists, defaults, TTS voices, tests and activation gate.

## 2. Workloads

- [ ] Route chat transformations through OpenRouter.
- [ ] Route batch STT and the Vexa bridge through OpenRouter.
- [ ] Route TTS through OpenRouter and normalize PCM.
- [ ] Route PDF/image OCR through OpenRouter.

## 3. Pricing And Data

- [ ] Widen model identifiers to 255 characters.
- [ ] Switch pricing, budgets, usage APIs and UI from EUR to USD without FX.
- [ ] Sync prices for allowed models and reconcile actual OpenRouter cost.

## 4. Cutover And Cleanup

- [ ] Add activation probes and atomic per-workspace cutover.
- [ ] Clear legacy secrets and remove direct Cortecs/Mistral runtime calls.
- [ ] Replace environment, Docker, privacy and operations documentation.

## 5. Verification

- [ ] Add catalogue, governance, provider-contract and migration tests.
- [ ] Run `npm run lint`, `npm test` and `npm run build`.
- [ ] Run idempotent PostgreSQL migration tests.
- [ ] Build and smoke-test production Compose through OrbStack.
- [ ] Confirm no production model IDs or legacy inference hosts remain.

