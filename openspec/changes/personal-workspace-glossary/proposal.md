# Change: Two-Tier Glossary — Personal + Workspace (Upstream)

## Why

Same motivation as the romaco-scriptor spec of the same name: the
glossary must serve two audiences — an admin-curated workspace
glossary as binding terminology, plus a personal glossary every member
can maintain without polluting the shared list. GhostTyper currently
has no glossary at all; it arrives via `upstream-translation-glossary`.

## Approach

Romaco implements the two-tier system first (it already has the
single-tier foundation in production). The GhostTyper port then brings
over the FINISHED two-tier implementation in one pass — do not port
single-tier first and retrofit.

All design decisions live in the romaco-scriptor spec
(`openspec/changes/personal-workspace-glossary/proposal.md`) and apply
verbatim here. The load-bearing ones:

- `translation_glossary.user_id NULL` = workspace, set = personal;
  partial unique indexes use `COALESCE(user_id, 0)`.
- Merge: workspace wins on conflict; do-not-translate is the union and
  cannot be un-masked personally.
- **TM leak guard**: segments shaped by a personal glossary entry are
  never written to the org-wide translation memory.
- Permissions: workspace CRUD `org.settings`; personal CRUD any member,
  SQL-enforced ownership.

## Impact

- Folds into the `upstream-translation-glossary` execution (its task
  list references this spec); no separate implementation effort beyond
  the port.
