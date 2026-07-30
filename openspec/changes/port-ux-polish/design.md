# Design: Port Empty States, Onboarding And Error Pages

## Source

Downstream `romaco-scriptor`:

- `pages/404.js` (29 LOC), `pages/500.js` (29 LOC)
- `components/EmptyState.js` (42 LOC)
- `components/OnboardingIntro.js` (72 LOC)

## Adaptation

These are the smallest items in the port set, but they are also the ones
most likely to arrive stale: they were written against the downstream
design language, while upstream has just completed the UI-sprezzatura
phases 1–3.

Port them to the **current** upstream primitives and tokens — `accent-ink`
for orange text, semantic status colors, the shared `Button` primitive —
rather than copying downstream markup verbatim. Anything ported must clear
the phase-3 AA contrast bar in both themes, since
`tests/ui-accessibility.test.mjs` now gates it.

## Explicitly Not Ported

`components/MatrixRain.js` is a downstream easter egg tied to that
product's identity. It is left behind deliberately, not by oversight.

## Empty State Adoption

Adopt `EmptyState` where a list currently renders nothing: transcriptions,
documents, audit and the settings sub-lists. Each call site supplies its
own copy and primary action; the component itself stays presentational.

## Onboarding Persistence

The introduction shows once per user. Persist the seen flag the way
upstream already persists per-user UI preferences rather than introducing
a new storage mechanism for it.

## Files Changed

- `pages/404.js`, `pages/500.js` (new, ported)
- `components/EmptyState.js`, `components/OnboardingIntro.js` (new, ported)
- list views adopting the empty state
- `messages/de.json`, `messages/en.json`

## Risks

- Low. The main risk is porting stale styling that regresses the
  just-completed accessibility work.
