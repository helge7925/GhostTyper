# Change: Port Empty States, Onboarding And Error Pages From Downstream

## Why

GhostTyper has no dedicated `404`/`500` pages, so routing and server
errors fall back to the framework default — an unstyled page that breaks
out of the design language the UI-sprezzatura refresh just established.
It also has no shared empty-state component, so screens with no content
render as blank areas, and no first-run introduction.

Downstream `romaco-scriptor` has all four, and they are tiny: 42, 72 and
2 × 29 LOC. This is the cheapest visible-quality item in the port set.

## Decisions Captured

- GhostTyper SHALL provide styled `404` and `500` pages consistent with
  the current design tokens.
- A shared empty-state component SHALL be used where lists render no
  content, instead of leaving the area blank.
- A first-run introduction SHALL be available for new users.
- All ported surfaces SHALL be localized de/en and meet the AA contrast
  bar set by the phase-3 accessibility pass.

## What Changes

- Port `pages/404.js` and `pages/500.js`.
- Port `components/EmptyState.js` and adopt it in list views that
  currently render nothing when empty.
- Port `components/OnboardingIntro.js`.
- Add de/en i18n strings.

## Out Of Scope

- `components/MatrixRain.js` — a downstream easter egg tied to that
  product's identity, deliberately not ported.
- Redesigning the list views themselves beyond adopting the empty state.
- Changing onboarding flow logic such as invitations or provisioning.

## Success Criteria

- An unknown route renders the styled 404 page.
- A server error renders the styled 500 page.
- List views with no content show a meaningful empty state.
- New users see the introduction on first run.
- All new strings exist in de and en, and the surfaces pass the existing
  accessibility test gate.
