// The stall window that decides when a reservation is treated as belonging to
// a dead process. Its exact value matters less than one invariant: it must
// outlast the longest legitimate provider call in the system, or a still-
// running job has its budget released out from under it. Releasing a live
// reservation is not a cosmetic error — the eventual commit finds the row no
// longer 'reserved', throws RESERVATION_NOT_ACTIVE, and real provider costs
// are never booked, while the freed headroom lets other work overshoot the
// limit the reservation existed to enforce.
//
// Same DATABASE_URL-guard + dynamic-import pattern as tests/edenai-ocr.test.mjs.
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PROVIDER_STALL_MS } = await import('../lib/budget-service.js');

// The longest reservation any call site asks for: checkpointMeetingStt and the
// meeting-creation path both hold six hours for live meeting STT.
const LONGEST_RESERVATION_MS = 6 * 60 * 60 * 1000;

test('the stall window outlasts the longest legitimate reservation', () => {
  assert.ok(
    PROVIDER_STALL_MS > LONGEST_RESERVATION_MS,
    `stall window ${PROVIDER_STALL_MS}ms must exceed the 6h meeting-STT reservation`,
  );
});

test('the stall window keeps a safety margin, not just a hairline lead', () => {
  // A six-hour meeting that ends exactly at its reservation limit should still
  // have hours of slack before anything reconciles it.
  assert.ok(
    PROVIDER_STALL_MS >= LONGEST_RESERVATION_MS * 2,
    `stall window ${PROVIDER_STALL_MS}ms should be at least double the longest reservation`,
  );
});

test('no call site reserves for longer than the stall window', () => {
  // Guards the invariant above against a future call site quietly asking for a
  // longer hold than the reconciler is willing to wait out.
  const sources = [
    '../lib/budget-runtime.js',
    '../lib/transcription-worker.js',
    '../lib/vexa-bridge.js',
    '../lib/in-meeting-audio.js',
    '../pages/api/meetings/index.js',
  ];

  for (const relativePath of sources) {
    const text = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    for (const [, expression] of text.matchAll(/reservationMs:\s*([0-9_ *]+)/g)) {
      // Only plain arithmetic literals appear here; anything else is a signal
      // to revisit this test rather than to loosen it.
      const value = Number(new Function(`return ${expression.replace(/_/g, '')}`)());
      assert.ok(Number.isFinite(value) && value > 0, `unparsed reservationMs in ${relativePath}: ${expression}`);
      assert.ok(
        value < PROVIDER_STALL_MS,
        `${relativePath} reserves ${value}ms, which the ${PROVIDER_STALL_MS}ms stall window would cut short`,
      );
    }
  }
});
