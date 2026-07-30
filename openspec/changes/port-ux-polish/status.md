# Status: Port Empty States, Onboarding And Error Pages

Last updated: 2026-07-30

## Current State

- **Proposed — not started.**
- Upstream has no `pages/404.js` / `pages/500.js`, no shared empty-state
  component and no first-run introduction.

## Verified

- Not applicable yet (no implementation).

## Notes

- Smallest item of the port set (~172 LOC total).
- Must be ported to post-sprezzatura primitives, not copied verbatim, so
  the phase-3 accessibility gate keeps passing.
- `components/MatrixRain.js` is intentionally excluded.
