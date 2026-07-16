# Tasks: UI Sprezzatura Refresh

## 1. Tokens & primitives
- [x] Accent decided 2026-07-16: keep black + orange; orange used
      sparingly (A/B the calmer #E84E0F vs. current #FF5917), dark
      theme softened to warm anthracite (#1E1E21 family).
- [ ] Replace token values in `styles/globals.css` (light + dark);
      delete gradient tokens.
- [ ] Extract shared `Button`, `Card`, `Field` components; migrate
      gradient-accent call sites.

## 2. Screen passes (each: declutter, defaults, one primary action,
      microcopy)
- [ ] Nav/sidebar + top bar
- [ ] Upload (incl. tab-audio recorder)
- [ ] Transcription detail / editor
- [ ] Translate (text + file) — flagship screen
- [ ] OCR, Textoptimierung
- [ ] Settings (progressive disclosure of advanced options)
- [ ] Meeting form (post retire-google-meet-bot)

## 3. Quality gates
- [ ] WCAG AA contrast check on both themes; focus-ring audit.
- [ ] Screenshot gallery before/after per screen (docs/ui/).
- [ ] Lint/tests green; no API changes.

## 4. Port
- [ ] Open mirror change in romaco-scriptor once phases 1–3 land.
