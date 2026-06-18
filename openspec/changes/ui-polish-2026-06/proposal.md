# Change: UI-Polish – Tabellen, Wake Lock, Upload-Limit, Textoptimierung, Dateiansicht

## Why

The product accumulated separate entry points and options that are no longer needed or should be simplified:

- Predefined table templates created a separate workflow next to the regular analysis mode.
- Mobile browser recordings stop when the screen locks because the app does not request a wake lock.
- The 50 MB upload limit is too restrictive now that Whisper V3 Large is used.
- Text optimization still exposes a model selector, but the product wants a single fast model.
- File detail pages waste horizontal space on wide screens.
- Workspace knowledge bases are already shared, but the UI does not make this obvious.

## Decisions Captured

- Table creation SHALL only be available as a regular analysis mode (`data_table`).
- Predefined table templates and the table-schema builder SHALL be removed from the UI (backend support for legacy rows remains).
- The upload size limit SHALL be raised to 500 MB for transcription, OCR, and translation file uploads.
- The audio recorder SHALL request a screen wake lock while recording to keep mobile browsers alive.
- Text optimization SHALL always use `deepseek-v4-flash` and no longer offer a model selector.
- File detail views (`/documents/[id]` and `/transcriptions/[id]`) SHALL use more horizontal space.
- Workspace knowledge bases SHALL show a "shared in workspace" indicator.

## What Changes

- Remove `/tabellen` wrapper, `/tabellen-transkription`, `components/TableSchemaBuilder`, `lib/table-template-generator`.
- Remove table-template settings tab and meeting table-analysis option.
- Add `lib/use-wake-lock.js` and integrate it into `AudioRecorder` and `SystemAudioRecorder`.
- Raise `MAX_FILE_SIZE` to 500 MB and update all user-facing size hints.
- Remove the model selector from `/textoptimierung` and hard-code `deepseek-v4-flash` in the API.
- Widen content containers on `/documents/[id]` and `/transcriptions/[id]`.
- Add a shared indicator to `/knowledge` detail header.

## Out Of Scope

- Native mobile app or background audio recording service.
- Configurable per-workspace upload limit.
- Fine-grained per-knowledge-base member access control.

## Success Criteria

- No UI entry point for predefined table templates remains.
- Mobile recordings stay alive when the screen turns off on supported browsers.
- Users can upload audio files up to 500 MB.
- Text optimization always uses DeepSeek V4 Flash without user choice.
- File detail pages use the available horizontal space better.
- Workspace knowledge bases visibly indicate that they are shared.
