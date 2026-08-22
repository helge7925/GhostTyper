# Status: Consolidate AI Providers On OpenRouter

Last updated: 2026-08-22

## Current State

- **Implemented; awaiting organization activation and operational soak.**
- Application runtime, administration, provider adapters, USD accounting and
  deployment configuration now use OpenRouter as the sole AI provider.

## Verified

- `npm run lint` and the 376-test unit/contract suite pass.
- The PostgreSQL 16 DB suite passes 10/10 and initializes the schema twice.
- `npm run build` and the OrbStack production image build pass.
- The OrbStack Webapp, PostgreSQL and OpenRouter Vexa bridge are healthy;
  `/api/health`, `/login` and unauthenticated model-API denial were smoked.
- Production source contains no fixed model IDs or direct Cortecs/Mistral
  inference hosts.

## Outstanding

- A workspace admin must provide a real OpenRouter key, capability allowlists,
  defaults and required voice/manual-price overrides.
- Paid activation probes and the real upload/OCR/chat/TTS/Vexa workload matrix
  require that configuration; Vexa intentionally fails closed before it.
- The seven-day soak and separately approved legacy-column cleanup remain
  operational rollout gates.
