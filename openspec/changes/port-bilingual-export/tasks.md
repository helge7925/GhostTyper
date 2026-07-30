# Tasks: Port Bilingual Side-by-Side Export

## 1. Core

- [ ] Port `lib/bilingual-export.js` from `romaco-scriptor` unchanged.
- [ ] Confirm no customer-specific references remain.

## 2. API

- [ ] Port `pages/api/translate/file-bilingual.js`.
- [ ] Wire it to GhostTyper's document read-permission check.
- [ ] Keep the downstream size/segment bounds and escaping.

## 3. UI

- [ ] Add the bilingual export action to `pages/translate.js`.
- [ ] Use current UI primitives (post-sprezzatura tokens/components).
- [ ] Port the settings surface if downstream exposes one.

## 4. i18n

- [ ] Add action + error strings to `messages/de.json`.
- [ ] Add the same keys to `messages/en.json`.

## 5. Verification

- [ ] Add `tests/bilingual-export.test.mjs` (alignment, escaping, bounds).
- [ ] `npm run lint`.
- [ ] `npm test`.
- [ ] `npm run build`.
