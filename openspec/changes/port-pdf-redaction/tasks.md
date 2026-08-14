# Tasks: Port PDF Redaction Engine And Font Handling

## 1. Redaction Core

- [x] Port `lib/pdf-redaction-engine.js`.
- [x] Confirm redaction removes content-stream text, not just draws boxes.
- [x] Keep redaction behind the existing `pdf-render-limiter` bounds.

## 2. Fonts

- [x] Port `lib/pdf-fonts.js`.
- [x] Wire font resolution into the existing PDF export path.
- [x] Verify Latin-only output does not regress.

## 3. UI

- [x] Expose redaction on the PDF export surface.
- [x] Use current UI primitives (post-sprezzatura tokens/components).

## 4. i18n

- [x] Add redaction strings to `messages/de.json`.
- [x] Add the same keys to `messages/en.json`.

## 5. Verification

- [x] Add `tests/pdf-redaction.test.mjs` asserting redacted text is **not
      extractable** from the output (not merely invisible).
- [x] Add a font-coverage test for non-Latin script.
- [x] `npm run lint`.
- [x] `npm test`.
- [x] `npm run build`.
