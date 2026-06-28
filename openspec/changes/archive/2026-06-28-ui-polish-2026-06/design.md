# Design: UI-Polish – Tabellen, Wake Lock, Upload-Limit, Textoptimierung, Dateiansicht

## Table Mode Cleanup

### Removed UI

- `pages/tabellen.js` and `pages/tabellen-transkription.js` are deleted.
- `components/TableSchemaBuilder.js` and `lib/table-template-generator.js` are deleted.
- The `table-templates` tab is removed from `pages/settings.js`.
- The table-template selector is removed from `components/MeetingStartForm.js`.
- The upload page no longer advertises table transcription.
- Dashboard and command-palette links point to `/datentabelle` instead of `/tabellen?mode=template`.

### Kept

- `data_table` remains a built-in analysis template available in the upload form and on `/datentabelle`.
- `lib/table-calculations.js`, `lib/table-schema.js`, `TableRenderer`, `TableEditor`, and the table analysis pipeline remain for existing and future free-form data tables.
- The `/api/templates` endpoints still accept `template_type: 'table'` so legacy rows stay analysable.

## Mobile Wake Lock

A small hook `lib/use-wake-lock.js` wraps the Screen Wake Lock API:

- `request()` calls `navigator.wakeLock.request('screen')` if available.
- `release()` releases the held lock.
- A `visibilitychange` listener re-acquires the lock when the tab becomes visible again while recording is still active.

Both `AudioRecorder` and `SystemAudioRecorder` call `requestWakeLock()` on recording start and `releaseWakeLock()` on stop/error/cleanup.

**Limitation:** iOS Safari has limited Wake Lock support. There is no reliable web-only fallback for screen-off recording on iOS.

## Upload Limit

`MAX_FILE_SIZE` in `lib/constants.js` is raised from `50 * 1024 * 1024` to `500 * 1024 * 1024`. All user-facing strings, client-side validation, and server error messages are updated to "500 MB".

No infrastructure change is required beyond the existing `formidable` max file size configuration because the app is self-hosted and disk space is controlled by the operator.

## Text Optimization Model

- The model dropdown is removed from `pages/textoptimierung.js`.
- `pages/api/text-optimization.js` ignores any `model` from the request body and always resolves `deepseek-v4-flash`.

## File View Width

- `pages/documents/[id].js`: outer container changed from `max-w-4xl` to `max-w-6xl`.
- `pages/transcriptions/[id].js`: outer container changed from `max-w-5xl` to `max-w-6xl`.

## Workspace Knowledge Sharing Indicator

`pages/knowledge.js` shows a small inline indicator below the knowledge-base title:

- Icon: `Users` from `lucide-react`.
- Label: translated `sharedInWorkspace` key.
- Tooltip via the `title` attribute.

This makes the existing org-scoped sharing behaviour visible to users.

## Files Changed

- `components/AudioRecorder.js`
- `components/AudioUploadForm.js`
- `components/CommandPalette.js`
- `components/MeetingStartForm.js`
- `components/SystemAudioRecorder.js`
- `components/TableSchemaBuilder.js` (deleted)
- `docs/api-specification.md`
- `docs/audio-upload.md`
- `lib/constants.js`
- `lib/table-template-generator.js` (deleted)
- `lib/use-wake-lock.js` (new)
- `messages/de.json`
- `messages/en.json`
- `pages/api/text-optimization.js`
- `pages/api/translate/file.js`
- `pages/api/upload.js`
- `pages/datentabelle.js` (kept, link target updated)
- `pages/documents/[id].js`
- `pages/index.js`
- `pages/knowledge.js`
- `pages/ocr.js`
- `pages/settings.js`
- `pages/tabellen-transkription.js` (deleted)
- `pages/tabellen.js` (deleted)
- `pages/textoptimierung.js`
- `pages/transcriptions/[id].js`
- `pages/upload.js`
