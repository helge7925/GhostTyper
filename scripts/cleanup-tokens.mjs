#!/usr/bin/env node
/**
 * Cleanup pass — rename legacy compat tokens to semantic names.
 *
 *   node scripts/cleanup-tokens.mjs              # dry-run, summary
 *   node scripts/cleanup-tokens.mjs --verbose    # dry-run, per-file detail
 *   node scripts/cleanup-tokens.mjs --apply      # write changes
 *
 * After this runs and the build is green, remove the alias entries from
 * tailwind.config.js (dark.*, text.*, accent.orange/cyan/green/yellow/red).
 *
 * Mapping:
 *   bg-dark-bg          → bg-canvas
 *   bg-dark-card        → bg-surface
 *   bg-dark-input       → bg-surface-elevated
 *   text-text-primary   → text-primary
 *   text-text-secondary → text-secondary
 *   *-accent-orange     → *-accent           (e.g. bg-accent-orange/20 → bg-accent/20)
 *   *-accent-cyan       → *-info
 *   *-accent-green      → *-success
 *   *-accent-yellow     → *-warning
 *   *-accent-red        → *-danger
 *
 * Scope: components/ and pages/ (skips pages/api/, scripts/, node_modules/).
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOTS = ['components', 'pages'];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'api']);

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose');

// More-specific patterns first. \b at the end means each pattern leaves
// any alpha-modifier suffix (e.g. /20, /[0.5]) untouched.
const REPLACEMENTS = [
  // Bare surface tokens (no modifier suffix needed for these)
  [/\bbg-dark-bg\b/g, 'bg-canvas'],
  [/\bbg-dark-card\b/g, 'bg-surface'],
  [/\bbg-dark-input\b/g, 'bg-surface-elevated'],

  // Text tokens
  [/\btext-text-primary\b/g, 'text-primary'],
  [/\btext-text-secondary\b/g, 'text-secondary'],

  // Accent + state colors — \b boundary preserves /alpha modifiers.
  [/\baccent-orange\b/g, 'accent'],
  [/\baccent-cyan\b/g, 'info'],
  [/\baccent-green\b/g, 'success'],
  [/\baccent-yellow\b/g, 'warning'],
  [/\baccent-red\b/g, 'danger'],
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
