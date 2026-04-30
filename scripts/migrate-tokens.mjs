#!/usr/bin/env node
/**
 * Migrate hardcoded color classes to semantic Tailwind tokens.
 *
 *   node scripts/migrate-tokens.mjs              # dry-run, summary
 *   node scripts/migrate-tokens.mjs --verbose    # dry-run, per-file detail
 *   node scripts/migrate-tokens.mjs --apply      # write changes
 *
 * What it does:
 *   - Replaces hardcoded `border-white/[0.0X]`, `bg-white/[0.0X]`,
 *     `bg-black/X`, etc. with theme-aware tokens (border-subtle,
 *     border-emphasis, bg-hover, bg-overlay, ...).
 *   - These hardcoded classes don't react to theme switching, so
 *     they're the main blocker for light mode working correctly.
 *
 * What it does NOT do (covered by tailwind compat aliases instead):
 *   - bg-dark-*, text-text-*, accent-orange/cyan/...  These keep
 *     working via aliases in tailwind.config.js. A later cleanup
 *     pass can rename them for code hygiene.
 *
 * Scope: components/ and pages/ (skips pages/api/, node_modules/, dotfiles).
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';

const ROOTS = ['components', 'pages'];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'api']);

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose');

// Replacement order matters — more specific patterns first.
// Each row: [regex, replacement].
const REPLACEMENTS = [
  // --- bg-white/[0.XX] (alpha-bracket form) ---
  [/\bbg-white\/\[0\.0[1-4]\]/g, 'bg-hover-subtle'],
  [/\bbg-white\/\[0\.0[5-7]\]/g, 'bg-hover'],
  [/\bbg-white\/\[0\.(?:0[8-9]|1\d?|[2-9])\]/g, 'bg-hover-strong'],

  // --- bg-white/X (percent slash form) ---
  [/\bbg-white\/5\b/g, 'bg-hover-subtle'],
  [/\bbg-white\/10\b/g, 'bg-hover-strong'],
  [/\bbg-white\/(?:15|20|25|30)\b/g, 'bg-hover-strong'],

  // --- border-white/[0.XX] ---
  [/\bborder-white\/\[0\.(?:0\d|1[01]?)\]/g, 'border-subtle'],
  [/\bborder-white\/\[0\.(?:1[2-9]|[2-9])\]/g, 'border-emphasis'],

  // --- border-white/X ---
  [/\bborder-white\/(?:5|10)\b/g, 'border-subtle'],
  [/\bborder-white\/(?:15|20|25|30)\b/g, 'border-emphasis'],

  // --- divide-white/[0.XX] ---
  [/\bdivide-white\/\[0\.0\d\]/g, 'divide-subtle'],

  // --- ring-white/X ---
  [/\bring-white\/(?:5|10|20)\b/g, 'ring-subtle'],

  // --- bg-black/X ---
  [/\bbg-black\/(?:5|10|20)\b/g, 'bg-hover-subtle'],
  [/\bbg-black\/(?:30|40|50|60|70|80|90)\b/g, 'bg-overlay'],

  // --- border-black/X ---
  [/\bborder-black\/(?:5|10)\b/g, 'border-subtle'],
  [/\bborder-black\/(?:15|20|25|30)\b/g, 'border-emphasis'],

  // --- text-black/X (rare) ---
  [/\btext-black\/(?:75|80|90)\b/g, 'text-primary'],
];

const fileChanges = [];
let totalChanges = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      await processFile(full);
    }
  }
}

async function processFile(path) {
  const original = readFileSync(path, 'utf8');
  let content = original;
  let count = 0;
  const summary = new Map();

  for (const [pattern, replacement] of REPLACEMENTS) {
    content = content.replace(pattern, (match) => {
      const key = `${match} -> ${replacement}`;
      summary.set(key, (summary.get(key) || 0) + 1);
      count += 1;
      return replacement;
    });
  }

  if (count > 0) {
    fileChanges.push({ path, count, summary });
    totalChanges += count;
    if (APPLY && content !== original) {
      writeFileSync(path, content, 'utf8');
    }
  }
}

(async () => {
  for (const root of ROOTS) {
    try {
      const stat = statSync(root);
      if (stat.isDirectory()) await walk(root);
    } catch {
      // skip missing roots silently
    }
  }

  fileChanges.sort((a, b) => b.count - a.count);

  console.log(
    `\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${fileChanges.length} file(s), ${totalChanges} replacement(s)\n`,
  );

  if (VERBOSE) {
    for (const { path, count, summary } of fileChanges) {
      console.log(`${path} (${count})`);
      for (const [key, n] of summary) {
        console.log(`  ${String(n).padStart(3)}x  ${key}`);
      }
    }
  } else {
    for (const { path, count } of fileChanges) {
      console.log(`  ${String(count).padStart(4)}  ${path}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write changes.');
  }
})();
