# Change: UI Refresh — Quiet Precision ("Sprezzatura")

## Why

The current look (orange fire gradient #FF5917→#FF8C00, heavy shadows,
rounded-2xl everywhere, gradient CTAs) reads as loud consumer SaaS. The
product owner wants the apps to feel modern, restrained, elegant —
Apple-like minimalism with Italian sprezzatura: complicated things made
to look effortless — while keeping a pharmaceutical machine-building
identity (precision, cleanroom, stainless steel). The token system in
`styles/globals.css` is already centralized, so a disciplined token +
component pass transforms both apps cheaply (Romaco inherits via port).

## Design Direction (details in design.md)

- **Color**: warm-neutral surfaces (paper/steel greys), ONE precise
  accent used sparingly (primary action + focus only). Gradient reserved
  for at most one brand moment (login), removed from buttons/badges.
- **Type**: tighter scale (display/heading/body/caption), tabular
  numerals for costs/durations, no uppercase-tracking labels except tiny
  section markers.
- **Shape/elevation**: one radius token (subtle), hairline borders over
  shadows; shadows only for genuinely floating layers (menus, dialogs).
- **Motion**: 120–160ms ease-out opacity/translate only; no scale-pop
  buttons.
- **UX simplification (sprezzatura)**: progressive disclosure — advanced
  options (model choice, preferences, schemas) fold behind "Details";
  defaults that are simply right; plain-language microcopy (the 2-3
  adjective model labels are the template); empty states that teach.

## Decisions Captured

- No framework change: Tailwind + Radix stay; changes flow through
  design tokens and shared components (`Button`, `Card`, `Field` get
  extracted where currently inlined).
- Both light and dark themes updated together.
- Accessibility floor: WCAG AA contrast, visible focus ring on the new
  accent, hit targets ≥ 40px.
- Runs AFTER `remove-chat-knowledge-tasks` (don't polish removed
  surfaces) and lands upstream first, then ports to Romaco.

## Impact

- Pure front-end; no API/data changes.
- Screens touched: nav/sidebar, dashboard, upload, transcription detail,
  translate, OCR, settings, meeting form, share/companion views.
