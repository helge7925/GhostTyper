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
- [ ] Nav/sidebar + top bar — phase 1 gave this a *primitives-only*
      pass (icon buttons → `Button`, tokens, glow removed); the
      declutter/defaults/microcopy pass is still pending.
- [ ] Upload (incl. tab-audio recorder)
- [ ] Transcription detail / editor
- [ ] Translate (text + file) — flagship screen
- [ ] OCR, Textoptimierung
- [ ] Settings (progressive disclosure of advanced options)
- [ ] Meeting form (post retire-google-meet-bot)

## 3. Quality gates
- [x] WCAG AA contrast check on both themes; focus-ring audit —
      phase 1 scope (tokens + nav/shell + login), computed results in
      `docs/ui/phase1-tokens.md`. Full-app audit still pending phase 3.
- [ ] Screenshot gallery before/after per screen (docs/ui/) — phase 1
      substituted `docs/ui/phase1-tokens.md` (a token table) since a
      headless screenshot gallery isn't feasible here; a real
      before/after gallery is still owed once screen passes exist.
- [x] Lint/tests green; no API changes — phase 1 scope, see commit.

## 4. Port
- [ ] Open mirror change in romaco-scriptor once phases 1–3 land.
