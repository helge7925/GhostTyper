import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { scanFileForViruses } from '../lib/virus-scan.js';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

async function withEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === null || v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Regression test for the JSON.stringify quoting bug: a path with spaces
// must reach the scanner verbatim, not wrapped in literal `"` characters.
// (The command-template tokeniser does not handle quoted args, so the
// scanner-script path itself must not contain whitespace — but the file
// argument can.)
test('scanFileForViruses passes raw file path to scanner (no JSON quoting)', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'virus-scan-'));
  try {
    const samplePath = path.join(tmpDir, 'eicar with space.com');
    await writeFile(samplePath, EICAR, 'utf8');

    const scannerPath = path.join(tmpDir, 'fake-clam.mjs');
    await writeFile(
      scannerPath,
      [
        "import { readFileSync } from 'fs';",
        'const target = process.argv[process.argv.length - 1];',
        // Reject literal quote chars — these only appear if JSON.stringify
        // wrapped the path. The whole point of this test.
        "if (target.startsWith('\"') || target.endsWith('\"')) {",
        "  console.error('PATH HAS LITERAL QUOTES: ' + target);",
        '  process.exit(2);',
        '}',
        "const body = readFileSync(target, 'utf8');",
        "if (body.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {",
        "  console.error('FOUND: EICAR-Test-Signature infected');",
        '  process.exit(1);',
        '}',
        "console.log('OK');",
        'process.exit(0);',
      ].join('\n'),
      'utf8',
    );

    await withEnv({
      NODE_ENV: 'test',
      UPLOAD_VIRUS_SCAN_MODE: 'command',
      UPLOAD_VIRUS_SCAN_CMD: `${process.execPath} ${scannerPath} {file}`,
      UPLOAD_VIRUS_SCAN_FAIL_OPEN: 'false',
      UPLOAD_VIRUS_SCAN_TIMEOUT_MS: '5000',
    }, async () => {
      const result = await scanFileForViruses(samplePath);
      assert.equal(result.clean, false, 'EICAR sample must be flagged');
      assert.equal(result.skipped, false);
      assert.match(String(result.detail || ''), /infected/i);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('scanFileForViruses returns clean for benign file (fail-closed mode)', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'virus-scan-'));
  try {
    const samplePath = path.join(tmpDir, 'hello.txt');
    await writeFile(samplePath, 'hello world', 'utf8');

    const scannerPath = path.join(tmpDir, 'fake-clam.mjs');
    await writeFile(
      scannerPath,
      [
        "import { readFileSync } from 'fs';",
        'const target = process.argv[process.argv.length - 1];',
        "const body = readFileSync(target, 'utf8');",
        "if (body.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {",
        "  console.error('FOUND: EICAR-Test-Signature infected');",
        '  process.exit(1);',
        '}',
        "console.log('OK');",
        'process.exit(0);',
      ].join('\n'),
      'utf8',
    );

    await withEnv({
      NODE_ENV: 'test',
      UPLOAD_VIRUS_SCAN_MODE: 'command',
      UPLOAD_VIRUS_SCAN_CMD: `${process.execPath} ${scannerPath} {file}`,
      UPLOAD_VIRUS_SCAN_FAIL_OPEN: 'false',
      UPLOAD_VIRUS_SCAN_TIMEOUT_MS: '5000',
    }, async () => {
      const result = await scanFileForViruses(samplePath);
      assert.equal(result.clean, true);
      assert.equal(result.skipped, false);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
