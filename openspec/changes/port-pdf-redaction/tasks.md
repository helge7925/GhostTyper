# Tasks: Port PDF Redaction Engine And Font Handling

## 1. Redaction Core

- [ ] Port `lib/pdf-redaction-engine.js`.
- [ ] Confirm redaction removes content-stream text, not just draws boxes.
- [ ] Keep redaction behind the existing `pdf-render-limiter` bounds.

## 2. Fonts

- [ ] Port `lib/pdf-fonts.js`.
- [ ] Wire font resolution into the existing PDF export path.
- [ ] Verify Latin-only output does not regress.

## 3. UI

- [ ] Expose redaction on the PDF export surface.
- [ ] Use current UI primitives (post-sprezzatura tokens/components).

## 4. i18n

- [ ] Add redaction strings to `messages/de.json`.
- [ ] Add the same keys to `messages/en.json`.

## 5. Verification

- [ ] Add `tests/pdf-redaction.test.mjs` asserting redacted text is **not
      extractable** from the output (not merely invisible).
- [ ] Add a font-coverage test for non-Latin script.
- [ ] `npm run lint`.
- [ ] `npm test`.
- [ ] `npm run build`.
