// Two guards for the localisation the app already has.
//
// The audit found whole pages and settings panels written in hardcoded German
// while the components beside them use useTranslations properly — including the
// public share and overlay pages, which are opened by external meeting
// participants and are exactly where localisation matters most. None of it was
// caught, because nothing looked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function readLocale(name) {
  return JSON.parse(readFileSync(path.join(ROOT, 'messages', `${name}.json`), 'utf8'));
}

function flatten(value, prefix = '', out = new Set()) {
  for (const [key, entry] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) flatten(entry, full, out);
    else out.add(full);
  }
  return out;
}

test('the locale files describe exactly the same set of keys', () => {
  const de = flatten(readLocale('de'));
  const en = flatten(readLocale('en'));

  const missingInEn = [...de].filter((key) => !en.has(key)).sort();
  const missingInDe = [...en].filter((key) => !de.has(key)).sort();

  assert.deepEqual(missingInEn, [], 'keys present in de.json but missing from en.json');
  assert.deepEqual(missingInDe, [], 'keys present in en.json but missing from de.json');
});

// --- Hardcoded-German ratchet -------------------------------------------
//
// 32 files still carry German text inline. Migrating them is its own piece of
// work, so this does not demand zero — it freezes today's numbers. A file may
// improve (then lower its number here, or delete the entry) but never get
// worse, and a file that is not listed must contain none at all. That way the
// debt can only shrink, and no newly written page joins it unnoticed.
const HARDCODED_GERMAN_BASELINE = {
  'pages/transcriptions/[id].js': 42,
  'pages/settings.js': 33,
  'pages/upload.js': 21,
  'pages/transcriptions.js': 13,
  'pages/ocr.js': 17,
  'pages/translate.js': 13,
  'components/MeetingControlBar.js': 10,
  'pages/admin/users.js': 9,
  'pages/settings/organization/members.js': 9,
  'pages/profile.js': 7,
  'components/settings/OpenRouterIntegrationPanel.js': 7,
  'components/DocumentEditor.js': 3,
  'components/TableSchemaBuilder.js': 3,
  'components/settings/EdenAiIntegrationPanel.js': 3,
  'pages/admin/workspaces.js': 2,
  'components/AudioUploadForm.js': 2,
  'components/MeetingStartForm.js': 2,
  'components/ProcessStatusCard.js': 2,
  'components/TranscriptionCard.js': 2,
  'components/settings/MistralIntegrationPanel.js': 2,
  'pages/transcriptions/[id]/edit.js': 1,
  'pages/transcriptions/[id]/table.js': 1,
  'components/AudioRecorder.js': 1,
  'components/CommandPalette.js': 1,
  'components/WorkspaceSwitcher.js': 1,
};

const GERMAN_CHARS = /[äöüßÄÖÜ]/;

function collectSourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.jsx?$/.test(name)) out.push(full);
  }
  return out;
}

function countGermanLines(file) {
  let count = 0;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!GERMAN_CHARS.test(line)) continue;
    // Comments are documentation, not user-facing copy — including the JSX
    // form, which is how most explanatory notes inside markup are written.
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    if (line.startsWith('{/*')) continue;
    count += 1;
  }
  return count;
}

test('no file gains hardcoded German text', () => {
  // API routes are excluded: their German is in JSON error messages, a
  // separate (and much smaller) localisation problem from rendered UI.
  const files = [
    ...collectSourceFiles(path.join(ROOT, 'pages')),
    ...collectSourceFiles(path.join(ROOT, 'components')),
  ].filter((file) => !file.includes(`${path.sep}api${path.sep}`));

  const regressions = [];
  const improvements = [];

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const count = countGermanLines(file);
    const allowed = HARDCODED_GERMAN_BASELINE[relative] ?? 0;

    if (count > allowed) regressions.push(`${relative}: ${count} lines, baseline allows ${allowed}`);
    else if (count < allowed) improvements.push(`${relative}: ${count} lines, baseline still says ${allowed}`);
  }

  assert.deepEqual(
    regressions,
    [],
    'new hardcoded German text — use useTranslations and add the keys to messages/{de,en}.json',
  );
  // Improving without lowering the number leaves the next person a stale map,
  // so the ratchet insists on being tightened.
  assert.deepEqual(
    improvements,
    [],
    'these files improved — lower their numbers in HARDCODED_GERMAN_BASELINE (or delete the entry at 0)',
  );
});
