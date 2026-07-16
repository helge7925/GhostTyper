# Status: Upstream Translation Glossary + TM

Last updated: 2026-07-16

## Current State

- **Proposed — approved by product owner (2026-07-16), not started.**
- Source of truth for the port: romaco-scriptor branch
  `codex/cortecs-provider-parity` (already includes the batched TM
  lookup and glossary cache TTL fixes).
- Should land before `pdf-inplace-translation` so the new PDF path can
  use glossary/TM from day one.
- Sequenced after romaco-scriptor `personal-workspace-glossary` — the
  port brings the finished two-tier system (see same-named spec here).
