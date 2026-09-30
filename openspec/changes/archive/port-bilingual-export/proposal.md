# Change: Port Bilingual Side-by-Side Export From Downstream

## Why

GhostTyper already ported the two-tier glossary and translation memory
from `romaco-scriptor` (`4058340 feat(glossary): port two-tier glossary +
TM core from downstream`), but stopped short of the bilingual export that
the downstream variant built on top of it. Users who translate a document
can only get the target text, not an aligned source/target view — which
is what reviewers actually need to check an approved term in context.

Downstream `lib/bilingual-export.js` is ~135 LOC with **zero imports** and
no customer-specific references, so this completes a feature GhostTyper
already half-owns at the lowest possible porting cost.

## Decisions Captured

- GhostTyper SHALL offer a bilingual export that aligns source and target
  text for translated documents.
- The export SHALL be reachable from the translation result UI.
- The export SHALL be bounded (size/segment limits), HTML-escaped, and
  permission-checked, matching the downstream hardening.

## What Changes

- Port `lib/bilingual-export.js` from `romaco-scriptor` unchanged.
- Port the `pages/api/translate/file-bilingual.js` endpoint.
- Wire the export action into `pages/translate.js`.
- Add the settings surface for the export option in `pages/settings.js`
  if the downstream variant exposes one.
- Add de/en i18n strings for the new action.

## Out Of Scope

- Fuzzy translation-memory matching (tracked separately downstream).
- Changing the existing single-language export formats.
- PDF in-place translation behaviour (already shipped separately).

## Success Criteria

- A translated document can be exported with source and target aligned.
- The export is available from the translation result UI.
- Output is escaped and bounded; oversized inputs fail with a clear error.
- A user without permission on the document cannot export it.
