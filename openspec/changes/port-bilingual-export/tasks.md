# Tasks: Port Bilingual Side-by-Side Export

## 1. Core

- [x] Port `lib/bilingual-export.js` from `romaco-scriptor` unchanged.
- [x] Confirm no customer-specific references remain.

## 2. API

- [x] Port `pages/api/translate/file-bilingual.js`.
- [x] Wire it to GhostTyper's document read-permission check.
- [x] Keep the downstream size/segment bounds and escaping.

## 3. UI

- [x] Add the bilingual export action to `pages/translate.js`.
- [x] Use current UI primitives (post-sprezzatura tokens/components).
- [x] Port the settings surface if downstream exposes one.

## 4. i18n

- [x] Add action + error strings to `messages/de.json`.
- [x] Add the same keys to `messages/en.json`.

## 5. Verification

- [x] Add `tests/bilingual-export.test.mjs` (alignment, escaping, bounds).
- [x] `npm run lint`.
- [x] `npm test`.
- [x] `npm run build`.
