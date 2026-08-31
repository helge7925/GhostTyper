# Tasks: Migrate Chat, Analysis And TTS To EdenAI, Decommission OpenRouter

## 1. EdenAI Chat/TTS Adapters

- [x] 1.1 **Done in `migrate-chat-to-edenai`, not here** —
  `lib/edenai-service.js`'s `analyzeTranscriptionEdenAi` and
  `generateTemplateEdenAi`. `optimizeTextEdenAi` was already done even
  earlier, during `hardcode-edenai-models` (needed immediately for the
  `spelling_grammar` preset decision).
- [x] 1.2 **Done in `migrate-tts-to-edenai`, not here** —
  `lib/edenai-service.js`'s `synthesizeSpeechEdenAi` (not `edenAiTts` as
  originally named here), same `Buffer`-with-`providerRequestId`/`usage`
  contract `openRouterTts` does.
- [x] 1.3 EdenAI `OPERATIONS` map: the `chat` →
  `['analysis', 'text_optimization', 'template_generation',
  'knowledge_prep', ...]` entry was already present from the foundation
  phase and confirmed correct by `migrate-chat-to-edenai` — no change
  needed. The `tts` half was likewise already correct, confirmed by
  `migrate-tts-to-edenai`.

## 2. Pre-Cutover Probe

- [x] 2.1 **Done in `migrate-chat-to-edenai`, not here** —
  `probeEdenAiChatStructuredOutput` in `lib/edenai-probes.js`
  (structural JSON-object shape assertion, not an exact-array-length
  check as originally envisioned here — see that change's design.md for
  why a structural check was chosen).
- [x] 2.2 **Done in `migrate-chat-to-edenai`, not here** — wired into
  `probeEdenAiChat` (called automatically for `chat` activation, not a
  separate allowlist path). Prototyped against the real hardcoded model
  early as this note demanded — see that change's status.md for what
  the live verification found (and fixed).

## 3. Call Sites

- [x] 3.1 **Done in `migrate-chat-to-edenai`, not here** —
  `pages/api/ocr.js` (analysis block), `lib/transcription-worker.js`
  (analysis block), `pages/api/templates/generate.js`,
  `pages/api/knowledge-prep/text.js`, `lib/manual-analysis.js`.
  `pages/api/text-optimization.js` was already done even earlier, during
  `hardcode-edenai-models`.
- [x] 3.2 **Done in `migrate-tts-to-edenai`, not here** — all three call
  sites now resolve via `resolveActiveProviderConfig({capability:'tts'})`.

## 4. Pricing

- [x] 4.1 No separate runbook task remains here — `chat`'s price row
  requirement was already established by whichever capability activated
  it first (`translation`/OCR/`spelling_grammar`, all routed through
  `chat`), and covers analysis/template-generation/knowledge-prep too
  since they're the same operation list. TTS's price rows are tracked in
  `migrate-tts-to-edenai/tasks.md` instead.

## 5. Full Decommission (only after every capability is confirmed on EdenAI)

- [ ] 5.1 One transaction: confirm all capabilities' `defaultModels` are
  set on EdenAI for the workspace, then `disableAndClearIntegration(orgId,
  'openrouter', {client})`.
- [ ] 5.2 Delete `lib/openrouter.js`, `lib/openrouter-pricing.js`,
  `lib/openrouter-pricing-core.js`, `lib/openrouter-probes.js`,
  `components/settings/OpenRouterIntegrationPanel.js`,
  `pages/api/organizations/integrations/openrouter.js` (+`test.js`/
  `activate.js`).
- [ ] 5.3 Remove the OpenRouter branch from
  `services/voxtral-bridge/main.py` (now EdenAI-only).
- [ ] 5.4 Remove `openRouterSortForGoal`/`GOAL_SORT` from
  `lib/model-assistant.js`; confirm the model picker UI degrades cleanly
  (no goal-based sort control) rather than erroring.
- [ ] 5.5 Remove `OPENROUTER_*` variables from `.env.example`.
- [ ] 5.6 Update `openspec/project.md`'s architecture bullet, `README.md`,
  `README.de.md`, and `docs/ai-integration.md`, `docs/architecture.md`,
  `docs/gdpr-setup.md`, `docs/vexa-integration.md`,
  `docs/api-specification.md`, `docs/docker-setup.md`,
  `docs/vps-deployment-guide.md` to describe EdenAI as the sole provider.

## 6. Tests

- [x] 6.1 `tests/edenai-chat.test.mjs` and `tests/edenai-tts.test.mjs`:
  **both done, but not here** — chat in `migrate-chat-to-edenai`, TTS in
  `migrate-tts-to-edenai`.
- [x] 6.2 **Done in `migrate-chat-to-edenai`, not here** — structured-
  output probe tests live in `tests/edenai-probes.test.mjs` (4 new
  tests: well-formed response passes, non-JSON response fails,
  wrong-shape JSON fails, plus the request-shape assertion), not a
  separate `edenai-probe.test.mjs` file as originally envisioned here.
- [ ] 6.3 Remove or update every test in `tests/openrouter.test.mjs` and
  `harden-openrouter-workload-test-coverage`'s suites that asserts
  OpenRouter-specific behavior no longer reachable after decommission —
  do not leave dead tests asserting on deleted code paths.

## 7. Verification

- [ ] 7.1 Manual: activate EdenAI for `chat` on a test workspace (probe
  passed, pricing satisfied), run a template-driven analysis and a
  table-schema extraction, confirm both produce correctly structured
  JSON. **Partially covered already**: `migrate-chat-to-edenai` did the
  underlying live model-behavior verification directly against the
  adapter functions (found and fixed a real defect — see its status.md)
  — what's still open is the same check running through the actual UI/
  workspace-activation flow end-to-end, tracked as that change's own
  task 6.5.
- [ ] 7.2 Manual: activate EdenAI for `tts`, confirm in-meeting audio
  injection and read-aloud both still produce correctly normalized
  audio. **Partially covered already**: `migrate-tts-to-edenai` did the
  underlying live model comparison (6 real EdenAI TTS models, round-trip
  intelligibility check, human listening test for the final choice) —
  the UI/workspace-activation end-to-end check is tracked as that
  change's own tasks 7.3/7.4.
- [ ] 7.3 Manual: run the full decommission transaction on a workspace
  that has completed migration for every capability; confirm OpenRouter
  is disabled and every subsequent operation still succeeds via EdenAI.
- [ ] 7.4 `npm run lint`, `npm test`, and `pytest
  services/voxtral-bridge/tests` all pass with the OpenRouter branch
  removed.
- [ ] 7.5 `grep -ri openrouter` over `lib/`, `pages/`, `components/`,
  `services/` returns no hits outside historical comments/changelog text.
- [ ] 7.6 `openspec validate
  migrate-chat-tts-and-decommission-openrouter --strict` passes.
