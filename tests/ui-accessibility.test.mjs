import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const globals = fs.readFileSync(path.join(root, 'styles/globals.css'), 'utf8');

function themeBlock(selector) {
  const start = globals.indexOf(selector);
  assert.notEqual(start, -1, `Missing ${selector}`);
  const open = globals.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < globals.length; index += 1) {
    if (globals[index] === '{') depth += 1;
    if (globals[index] === '}') depth -= 1;
    if (depth === 0) return globals.slice(open + 1, index);
  }
  throw new Error(`Unclosed ${selector}`);
}

function rgb(block, token) {
  const match = block.match(new RegExp(`--${token}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  assert.ok(match, `Missing --${token}`);
  return match.slice(1).map(Number);
}

function luminance(color) {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrast(left, right) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const light = themeBlock(':root');
const dark = themeBlock("[data-theme='dark']");
const textTokens = ['primary', 'secondary', 'muted', 'accent-ink', 'success', 'warning', 'danger', 'info'];
const surfaces = ['canvas', 'surface', 'surface-elevated'];

for (const [name, block] of [['light', light], ['dark', dark]]) {
  test(`${name} theme text tokens meet WCAG AA on every surface`, () => {
    for (const foreground of textTokens) {
      for (const background of surfaces) {
        const ratio = contrast(rgb(block, foreground), rgb(block, background));
        assert.ok(
          ratio >= 4.5,
          `${name} --${foreground} on --${background} is ${ratio.toFixed(2)}:1`,
        );
      }
    }
  });

  test(`${name} focus indicator has at least 3:1 contrast`, () => {
    for (const background of surfaces) {
      const ratio = contrast(rgb(block, 'focus-ring'), rgb(block, background));
      assert.ok(
        ratio >= 3,
        `${name} focus ring on --${background} is ${ratio.toFixed(2)}:1`,
      );
    }
  });
}

test('interactive shell exposes a skip link and named loading status', () => {
  const layout = fs.readFileSync(path.join(root, 'components/Layout.js'), 'utf8');
  const spinner = fs.readFileSync(path.join(root, 'components/LoadingSpinner.js'), 'utf8');
  assert.match(layout, /href="#main-content"/);
  assert.match(layout, /id="main-content"/);
  assert.match(spinner, /role="status"/);
  assert.match(spinner, /className="sr-only"/);
});

test('source does not use raw accent for small text or white-label controls', () => {
  const roots = ['pages', 'components'];
  const files = roots.flatMap((directory) => (
    fs.readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(jsx?|tsx?)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name))
  ));

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /text-accent(?=\/|[\s'"`}])/g, file);
    assert.doesNotMatch(source, /bg-accent\s+text-white/g, file);
  }
});
