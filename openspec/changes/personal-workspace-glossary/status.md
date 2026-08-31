# Status: Two-Tier Glossary (Upstream)

Last updated: 2026-07-17

## Current State

- **Implemented on branch `feat/translation-glossary`, 2026-07-17**, as
  part of `upstream-translation-glossary` (single pass — see that change's
  status.md for the full deviation list and verification results).

## Two-tier specifics that landed

- `translation_glossary.user_id NULL` = workspace, set = personal;
  partial unique indexes use `COALESCE(user_id, 0)` so each user's
  personal list and the shared workspace list are independently unique.
- Merge (`mergeGlossaryTiers` in `lib/translation-glossary.js`): workspace
  wins on conflict; do-not-translate is the union of both tiers and a
  personal entry can never un-mask a workspace DNT term.
- **TM leak guard**: `shouldSkipTMForText` prevents a segment shaped by a
  personal glossary entry from being written to the org-wide translation
  memory (enforced in `translate.js`, `translate/file.js`, `vexa-bridge.js`).
- Permissions: workspace CRUD gates on `org.settings`; personal CRUD is
  open to any member and SQL-scoped to `user_id = req.userId`.
- Settings UI exposes both tiers ("Mein Glossar" / "Workspace-Glossar")
  with per-tier CSV/TBX import/export.

## Open points

- Manual end-to-end verification needs a live environment (Postgres +
  Cortecs key). See `upstream-translation-glossary/status.md` → Open points.
