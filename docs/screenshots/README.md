# Screenshots

Screenshots used in the project README. Captured at **1440 × 900**, dark
theme, German UI. All eight stable filenames below are present; captured
2026-09-30 against a seeded local instance.

| File | Page | Notes |
| --- | --- | --- |
| `01-login.png` | `/login` | Public, no auth required. |
| `02-dashboard.png` | `/` (logged in) | Welcome dashboard with sidebar + quick-action grid. |
| `03-transcriptions.png` | `/transcriptions` | History grid with seeded entries (audio + remote-meeting). |
| `04-editor.png` | `/transcriptions/[id]` | A finalised transcription with summary block. |
| `05-table-extract.png` | `/transcriptions/[id]/table` | Editor table view with seeded transcription. |
| `06-workspace-admin.png` | `/settings/organization/integrations` | API keys + cost caps panel. |
| `07-remote-meeting.png` | Remote-meeting start dialog | Modal open via `/transcriptions?meeting=1`. |
| `08-usage.png` | `/settings/organization/usage` | Per-operation and per-member cost breakdown. |

## How to capture

The login screenshot can be regenerated automatically:

```bash
docker exec transkription-webapp chromium \
  --headless --disable-gpu --no-sandbox \
  --hide-scrollbars --window-size=1440,900 \
  --force-dark-mode --enable-features=WebUIDarkMode \
  --screenshot=/tmp/login.png http://localhost:3000/login
docker cp transkription-webapp:/tmp/login.png docs/screenshots/01-login.png
```

For authenticated views, capture manually:

1. Sign in at `http://localhost:3000`.
2. Open DevTools → Device toolbar → set viewport to **1440 × 900**.
3. Cmd+Shift+P → "Capture full size screenshot" (Chrome) or use a OS
   shortcut (`Cmd+Shift+4` on macOS).
4. Save under the file name in the table above, PNG, in this folder.

Replace any existing file. The README should embed only files that are
present.
