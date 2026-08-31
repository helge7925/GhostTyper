# Tasks: UI Sprezzatura Refresh

## 1. Tokens & primitives — PHASE 1 DONE (branch `feat/ui-sprezzatura-phase1`)
- [x] Accent decided 2026-07-16: keep black + orange; orange used
      sparingly (A/B the calmer #E84E0F vs. current #FF5917), dark
      theme softened to warm anthracite (#1E1E21 family).
- [x] Replace token values in `styles/globals.css` (light + dark);
      delete gradient tokens. `.gradient-accent`/`.gradient-accent-hover`
      utility classes kept (now solid) so no call sites needed edits.
      See `docs/ui/phase1-tokens.md` for the full old→new table.
- [x] Extract shared `Button`, `Card`, `Field` components; migrate
      gradient-accent call sites. `Button` extended in place
      (`components/ui/button.js` — see phase1-tokens.md for why a
      separate `Button.js` wasn't created); `Card`/`Field` are new
      (`components/ui/card.js`, `components/ui/field.js`). Migrated:
      nav/shell (`Sidebar.js` token-only, `TopBar.js` icon buttons,
      `BottomNav.js` token-only) + `pages/login.js` as the showcase.

## 2. Screen passes (each: declutter, defaults, one primary action,
      microcopy)
- [x] Nav/sidebar + top bar — removed the duplicate profile/logout
      block from the sidebar; account actions now have one home in the
      top-bar menu. Navigation retains the quiet active state and the
      existing responsive/collapsed behavior.
- [x] Upload (incl. microphone + tab-audio recorders) — source choice is
      neutral instead of CTA-colored, file selection has a clear state,
      output choices explain their consequences, presets keep their
      defaults folded, and the shared `Button`/`Card`/`Field` primitives
      replace bespoke gradients, shadows and scale motion.
- [x] Transcription detail / editor — title/status hierarchy moved out
      of the action rail; editor/save are the primary actions; exports,
      history, source text and deletion are visually subordinate.
      Editor typography now follows theme tokens instead of hardcoded
      dark colors.
- [x] Translate (text + file) — flagship screen. One primary translate
      action per mode; language stays visible, model choice folds under
      Details; source/result panels and file flow use quiet cards,
      hairlines, shared primitives and plain-language microcopy.
- [x] OCR, Textoptimierung — both use the same quiet input → choice →
      primary-action structure, neutral selectors and shared primitives;
      OCR analysis details remain folded until requested.
- [x] Settings — neutral responsive section navigation, quiet cards and
      tabular usage figures; technical choices remain separated by area,
      and template-generation/edit actions use the shared action hierarchy.
- [x] Meeting form (post retire-google-meet-bot) — meeting URL and consent
      stay visible; bot identity, analysis, GDPR notice and live-translation
      controls fold into one optional details section with sensible defaults.

## 3. Quality gates
- [x] WCAG AA contrast check on both themes; focus-ring audit —
      full-app phase-3 token and source audit complete. All text tokens
      clear 4.5:1 on canvas/surface/elevated in both themes; focus rings
      clear 3:1. Automated regression coverage lives in
      `tests/ui-accessibility.test.mjs`; results and browser matrix in
      `docs/ui/phase3-audit.md`.
- [x] Screenshot gallery before/after (docs/ui/) — desktop light/dark
      and mobile comparison rendered from clean `HEAD` versus the phase-3
      working tree. Authenticated screens use the same audited primitives
      and tokens; the local visual run had no seeded authenticated session.
- [x] Lint/tests green; no API changes — phase 1 and the completed phase-2
      passes. Phase 2 verification: 221 pass / 10 skipped / 0 fail,
      lint 0 errors (2 pre-existing hook warnings), production build
      compiles.

## 4. Port
- [x] Mirror change is present in the romaco-scriptor sibling checkout
      (verified on its current `main`).
