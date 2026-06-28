# Status: UI-Polish – Tabellen, Wake Lock, Upload-Limit, Textoptimierung, Dateiansicht

Last updated: 2026-06-18

## Current State

- OpenSpec proposal, design, spec, task list, and status exist for the change.
- Predefined table template UI is fully removed; `/datentabelle` remains as the free-form data table entry point.
- Screen Wake Lock is integrated into both browser recorders.
- Upload size limit is raised to 500 MB across transcription, OCR, and translation uploads.
- Text optimization no longer shows a model selector and always uses `deepseek-v4-flash`.
- File detail views (`/documents/[id]` and `/transcriptions/[id]`) use wider containers.
- Workspace knowledge bases show a "Geteilt im Workspace" / "Shared in workspace" indicator.

## Verified

- `npm run lint` passed.
- `npm test` passed (173 tests, 0 failures).
- `npm run build` passed.
- Local server started on `http://localhost:3000`; `/api/health` returned 200.

## Notes

- The committed change also includes pre-existing uncommitted modifications that were already in the working tree before this slice.
- iOS Safari wake-lock support is limited; full screen-off recording reliability on iOS requires a native app.
