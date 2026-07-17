# Status: UI Sprezzatura Refresh

Last updated: 2026-07-17

## Current State

- **Proposed — direction approved 2026-07-16. Colors final: black +
  orange stays (orange quieter, anthracite instead of deep black);
  Romaco port keeps romaco-blue.**
- **Phase 1 implemented on branch `feat/ui-sprezzatura-phase1`,
  2026-07-17** (base: `feat/pdf-inplace-translation` @ `3331aa8`):
  tokens (`styles/globals.css`, light + dark), gradient deletion
  (`.gradient-accent` kept as a solid-fill utility, zero call-site
  edits), `Button`/`Card`/`Field` primitives, nav/shell migration
  (`Sidebar.js`, `TopBar.js`, `BottomNav.js`) + `pages/login.js` as
  the showcase, and a hardcoded-hex consistency sweep (3 literals
  fixed in `pages/share/[token]/overlay.js` and
  `components/DocumentEditor.js`). Full old→new token table + computed
  WCAG AA results in `docs/ui/phase1-tokens.md`.
  **A/B note:** `#E84E0F` replaces `#FF5917` as the `--accent` value
  everywhere (both themes — same value, not theme-specific); large
  solid-fill CTAs with white text route through `--accent-strong`
  (`#C94509`) instead, because white-on-`#E84E0F` is 3.80:1, short of
  the 4.5:1 normal-text AA floor (the old `#FF5917` was worse at
  3.14:1, so this isn't a regression — see phase1-tokens.md for the
  full reasoning). Product owner should eyeball both themes on that
  branch before phase 2 screen passes lock the palette in.
  Screen-by-screen redesign passes (upload, translate, transcription
  detail, settings, OCR/Textoptimierung, meeting form) are explicitly
  **pending with the product owner** — phase 1 deliberately did not
  touch them beyond automatic token inheritance.
- Ordered after `remove-chat-knowledge-tasks`.
- Ports to romaco-scriptor after upstream phases 1–3.
