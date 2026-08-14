# Status: Port PDF Redaction And Font Coverage

Last updated: 2026-08-11

## Current State

- **Implemented locally.**
- PDF source text is removed from content streams before translated text is
  drawn. Editor exports also support bounded explicit term redaction.
- Application-owned Noto fonts cover Latin, Cyrillic, Arabic, Simplified
  Chinese and Traditional Chinese with fail-closed glyph checks.

## Verified

- Redaction, extraction, fallback and non-Latin font tests pass.
- `npm run lint`, `npm test` and `npm run build` pass.
- Font assets and the fail-closed boundary are documented in
  `docs/third-party-pdf-fonts.md`.
