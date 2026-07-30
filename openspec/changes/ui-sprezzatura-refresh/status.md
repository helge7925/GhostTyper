# Status: UI Sprezzatura Refresh

Last updated: 2026-07-25

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
  sequenced after the primitives.
- **Phase 2 implemented, 2026-07-25:** the navigation declutter pass,
  upload flow (including microphone and tab/system-audio recorders), and
  the text/file translation flagship pass are implemented. Account
  actions now live only in the top-bar profile menu; upload presets use
  sensible folded defaults; non-action mode selectors are neutral; model
  choices and other technical controls use progressive disclosure; heavy
  shadows, pill CTAs, scale motion and remaining gradient call sites were
  removed from the touched screens. New microcopy is localized de/en.
  Verification: `npm test` 221 pass / 10 skipped / 0 fail; lint 0 errors
  with the same 2 pre-existing hook warnings; `npm run build` compiles.
  Transcription detail/editor, OCR/Textoptimierung, Settings and the
  meeting form now follow the same hierarchy. Editor prose colors use
  theme tokens; advanced OCR and meeting-bot controls use progressive
  disclosure; usage figures use tabular numerals. All phase-2 screen
  passes are complete.
- **Phase 3 implemented, 2026-07-25:** full-app light/dark semantic
  colors now meet AA on every core surface; orange text has a dedicated
  `accent-ink` token, semantic status colors and muted copy were raised,
  and the dark theme has a dedicated focus-ring color. The shell exposes
  a localized skip link, loading state is announced, decorative SVGs are
  hidden from assistive technology, and remaining raw accent text/control
  combinations were removed across `pages/` and `components/`. Public
  routes were browser-checked in both themes and at 390 × 844 with zero
  unnamed controls, computed contrast failures or horizontal overflow.
  Automated gates and the clean-HEAD before/after gallery are documented
  in `docs/ui/phase3-audit.md`. Phases 1–3 are complete.
- Ordered after `remove-chat-knowledge-tasks`.
- Ports to romaco-scriptor after upstream phases 1–3.
