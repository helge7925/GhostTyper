# Design: Port Bilingual Side-by-Side Export

## Source

Downstream `romaco-scriptor`:

- `lib/bilingual-export.js` (~135 LOC, no imports, no customer coupling)
- `pages/api/translate/file-bilingual.js`
- Call sites in `pages/translate.js` and `pages/settings.js`

## Approach

Straight port. `lib/bilingual-export.js` has no imports and no
Romaco-specific references, so it copies over unchanged. The API route and
UI wiring are adapted only where GhostTyper's surrounding code differs
(auth/permission helpers, i18n keys, component primitives after the
UI-sprezzatura refresh).

## Permissions

The endpoint resolves the document and reuses GhostTyper's existing
document read-permission check before rendering. No new permission type.

## Bounds

Keep the downstream limits (segment count / total size) so a pathological
document cannot produce unbounded HTML. Exceeding the bound is an error,
not a truncation, so the reviewer never sees a silently partial document.

## i18n

Add the export action label and error strings to `messages/de.json` and
`messages/en.json`.

## Files Changed

- `lib/bilingual-export.js` (new, ported)
- `pages/api/translate/file-bilingual.js` (new, ported)
- `pages/translate.js`
- `pages/settings.js` (only if downstream exposes an option there)
- `messages/de.json`, `messages/en.json`
- `tests/bilingual-export.test.mjs` (new)
