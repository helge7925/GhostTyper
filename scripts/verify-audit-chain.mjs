#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { verifyAuditChain } from '../lib/audit-chain.js';
import { verifyAuditExportPackage } from '../lib/audit-export.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function verifyZip(filePath) {
  const result = await verifyAuditExportPackage(
    await readFile(filePath),
    process.env.AUDIT_SIGNING_KEY,
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

async function verifyDatabase(organizationId) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      `SELECT id, organization_id, user_id, action, target_type, target_id, severity,
              metadata, created_at, prev_hash, entry_hash
         FROM audit_log
        WHERE organization_id IS NOT DISTINCT FROM $1
        ORDER BY id ASC`,
      [organizationId],
    );
    const verified = verifyAuditChain(result.rows);
    console.log(JSON.stringify({ organizationId, ...verified }, null, 2));
    if (!verified.valid) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const zip = argument('--zip');
const org = argument('--org-id');
if (zip) await verifyZip(zip);
else if (org) await verifyDatabase(org);
else throw new Error('Usage: npm run audit:verify -- --org-id <id> | --zip <package.zip>');
