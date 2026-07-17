#!/usr/bin/env node

/**
 * Seed a small, neutral example glossary into one or all organizations.
 *
 * This is a generic starter set (do-not-translate proper nouns + a couple of
 * fixed translations) meant only to demonstrate the two-tier glossary. Replace
 * or extend it with your own workspace terminology. Every row is inserted as a
 * WORKSPACE entry (user_id NULL); ON CONFLICT DO NOTHING keeps re-runs idempotent.
 *
 * Usage:
 *   node scripts/seed-translation-glossary.mjs               # all organizations
 *   node scripts/seed-translation-glossary.mjs --org-id 42   # one organization
 */

import pool from '../lib/db.js';

// Neutral technical example terms. `do_not_translate` entries keep a term
// verbatim; the fixed entries pin a specific target-language translation.
const EXAMPLE_GLOSSARY = [
  { source_term: 'GhostTyper', do_not_translate: true, notes: 'Product name — keep verbatim.' },
  { source_term: 'API', do_not_translate: true, notes: 'Technical acronym — keep verbatim.' },
  { source_term: 'Dashboard', do_not_translate: true, notes: 'UI term — keep verbatim.' },
  { source_term: 'Webhook', do_not_translate: true, notes: 'Technical term — keep verbatim.' },
  { source_term: 'Zeitstempel', target_lang: 'en', target_term: 'timestamp', do_not_translate: false, notes: 'Preferred technical translation.' },
  { source_term: 'Übersetzungsgedächtnis', target_lang: 'en', target_term: 'translation memory', do_not_translate: false, notes: 'Preferred technical translation.' },
  { source_term: 'Ausgangssprache', target_lang: 'en', target_term: 'source language', do_not_translate: false, notes: 'Preferred technical translation.' },
];

function parseOrgIdArg(argv) {
  const index = argv.indexOf('--org-id');
  if (index === -1) return null;
  const value = Number.parseInt(argv[index + 1], 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('--org-id must be a positive integer');
  }
  return value;
}

async function getOrganizations(orgId) {
  if (orgId) {
    const result = await pool.query('SELECT id FROM organizations WHERE id = $1', [orgId]);
    return result.rows;
  }
  const result = await pool.query('SELECT id FROM organizations ORDER BY id ASC');
  return result.rows;
}

async function seedOrg(orgId) {
  let inserted = 0;
  for (const entry of EXAMPLE_GLOSSARY) {
    const result = await pool.query(
      `INSERT INTO translation_glossary (
          organization_id,
          user_id,
          source_term,
          target_lang,
          target_term,
          do_not_translate,
          notes
        )
        VALUES ($1, NULL, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
        RETURNING id`,
      [
        orgId,
        entry.source_term,
        entry.do_not_translate ? null : entry.target_lang,
        entry.do_not_translate ? null : entry.target_term,
        !!entry.do_not_translate,
        entry.notes || null,
      ]
    );
    inserted += result.rowCount;
  }
  return inserted;
}

async function main() {
  const orgId = parseOrgIdArg(process.argv.slice(2));
  const organizations = await getOrganizations(orgId);
  let total = 0;

  for (const org of organizations) {
    const inserted = await seedOrg(org.id);
    total += inserted;
    console.log(`organization ${org.id}: inserted ${inserted}`);
  }

  console.log(`translation glossary seed complete: ${total} inserted`);
}

main()
  .catch((error) => {
    console.error('translation glossary seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
