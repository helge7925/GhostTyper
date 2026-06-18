# Tasks: UI-Polish – Tabellen, Wake Lock, Upload-Limit, Textoptimierung, Dateiansicht

## 1. Table Mode Cleanup

- [x] Delete `pages/tabellen.js` and `pages/tabellen-transkription.js`.
- [x] Delete `components/TableSchemaBuilder.js` and `lib/table-template-generator.js`.
- [x] Remove table-templates tab and editor from `pages/settings.js`.
- [x] Remove table-analysis option from `components/MeetingStartForm.js`.
- [x] Remove table-transcription promo from `pages/upload.js`.
- [x] Update dashboard and command-palette links to `/datentabelle`.
- [x] Remove unused i18n keys for table templates.

## 2. Mobile Wake Lock

- [x] Create `lib/use-wake-lock.js`.
- [x] Integrate wake lock into `components/AudioRecorder.js`.
- [x] Integrate wake lock into `components/SystemAudioRecorder.js`.

## 3. Upload Limit

- [x] Raise `MAX_FILE_SIZE` to 500 MB in `lib/constants.js`.
- [x] Update client-side validation messages.
- [x] Update server-side error messages.
- [x] Update i18n strings and docs.

## 4. Text Optimization Model

- [x] Remove model selector from `pages/textoptimierung.js`.
- [x] Hard-code `deepseek-v4-flash` in `pages/api/text-optimization.js`.

## 5. File View Width

- [x] Widen `pages/documents/[id].js` container.
- [x] Widen `pages/transcriptions/[id].js` container.

## 6. Workspace Knowledge Sharing Indicator

- [x] Add shared indicator to `pages/knowledge.js`.
- [x] Add `sharedInWorkspace` i18n key.

## 7. Verification

- [x] Run `npm run lint`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Start app on localhost and verify health endpoint.
