import { query } from '../../../lib/db';
import { enforceRateLimit, logApiError, serverError } from '../../../lib/api-utils';
import { withOrgScope } from '../../../lib/api/with-org-scope';
import { hasPermission } from '../../../lib/permissions';
import { normalizeGlossaryPayload } from '../../../lib/translation-glossary-validation';
import { parseGlossaryCsv } from '../../../lib/glossary-interop';

// Glossary CSV import per tier (translation-excellence stage 4). Personal
// imports are open to every member and land in their own list; workspace
// imports require org.settings, matching pages/api/glossary/index.js POST.
// Rows are validated one-by-one: a bad or duplicate row is reported and
// skipped, never aborting the whole import.
const MAX_IMPORT_ROWS = 2000;

function resolveScope(value) {
  const scope = String(value || '').trim().toLowerCase();
  return scope === 'personal' ? 'personal' : 'workspace';
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const userId = req.userId;
  const orgId = req.org.id;
  const allowed = await enforceRateLimit(req, res, {
    keyPrefix: 'translation-glossary-import',
    identifier: `org:${orgId}:user:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!allowed) return;

  const scope = resolveScope(req.body?.scope);
  if (scope === 'workspace' && !hasPermission(req.role, 'org.settings')) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'Nur Workspace-Admins können das Workspace-Glossar importieren.',
      permission: 'org.settings',
    });
  }

  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) {
    return res.status(400).json({ message: 'Keine CSV-Daten übermittelt.' });
  }

  let rows;
  try {
    ({ rows } = parseGlossaryCsv(csv));
  } catch (error) {
    logApiError('Glossary import parse error', error);
    return res.status(400).json({ message: 'CSV konnte nicht gelesen werden.' });
  }

  if (rows.length === 0) {
    return res.status(400).json({ message: 'Die CSV-Datei enthält keine Datenzeilen.' });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return res.status(400).json({ message: `Zu viele Zeilen (max. ${MAX_IMPORT_ROWS}).` });
  }

  // Personal rows are always owned by the caller; workspace rows have user_id
  // NULL. Never trust a client-supplied owner id.
  const ownerUserId = scope === 'personal' ? userId : null;

  const errors = [];
  let imported = 0;
  let skipped = 0;

  // Uniqueness is scoped per tier and, for translatable terms, per target
  // language (see the two partial unique indexes in lib/db-init.js). Building
  // the same key on both sides lets one multi-row INSERT report per-line
  // outcomes without a round-trip per row: MAX_IMPORT_ROWS is 2000, so the
  // old row-at-a-time loop could hold a pool connection for 2000 sequential
  // statements.
  const conflictKey = (sourceTerm, targetLang, doNotTranslate) => (doNotTranslate
    ? `${String(sourceTerm).toLowerCase()}|dnt`
    : `${String(sourceTerm).toLowerCase()}|${String(targetLang || '').toLowerCase()}`);

  const pending = [];
  const seenKeys = new Set();
  for (const row of rows) {
    const { value, error } = normalizeGlossaryPayload(row.data);
    if (error) {
      errors.push({ line: row.line, message: error });
      skipped += 1;
      continue;
    }
    // Duplicates inside the uploaded file collapse into a single INSERT row,
    // so they have to be caught here to keep reporting them per line.
    const key = conflictKey(value.sourceTerm, value.targetLang, value.doNotTranslate);
    if (seenKeys.has(key)) {
      errors.push({ line: row.line, message: 'Eintrag existiert bereits.' });
      skipped += 1;
      continue;
    }
    seenKeys.add(key);
    pending.push({ line: row.line, value, key });
  }

  const IMPORT_CHUNK_SIZE = 200;

  try {
    for (let offset = 0; offset < pending.length; offset += IMPORT_CHUNK_SIZE) {
      const chunk = pending.slice(offset, offset + IMPORT_CHUNK_SIZE);
      const params = [orgId, ownerUserId];
      const tuples = chunk.map(({ value }) => {
        const base = params.length;
        params.push(value.sourceTerm, value.targetLang, value.targetTerm, value.doNotTranslate, value.notes);
        return `($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });

      try {
        // eslint-disable-next-line no-await-in-loop
        const inserted = await query(
          `INSERT INTO translation_glossary (
              organization_id, user_id, source_term, target_lang, target_term, do_not_translate, notes
            )
            VALUES ${tuples.join(', ')}
            ON CONFLICT DO NOTHING
            RETURNING source_term, target_lang, do_not_translate`,
          params,
        );
        const storedKeys = new Set(
          inserted.rows.map((row) => conflictKey(row.source_term, row.target_lang, row.do_not_translate)),
        );
        for (const entry of chunk) {
          if (storedKeys.has(entry.key)) {
            imported += 1;
          } else {
            errors.push({ line: entry.line, message: 'Eintrag existiert bereits.' });
            skipped += 1;
          }
        }
      } catch (chunkError) {
        // A conflict cannot land here (ON CONFLICT DO NOTHING absorbs those),
        // so this is a real failure and the whole chunk is lost together.
        logApiError('Glossary import chunk error', chunkError);
        for (const entry of chunk) {
          errors.push({ line: entry.line, message: 'Zeile konnte nicht gespeichert werden.' });
          skipped += 1;
        }
      }
    }

    return res.status(200).json({
      scope,
      total: rows.length,
      imported,
      skipped,
      errors: errors.slice(0, 100),
    });
  } catch (error) {
    logApiError('Glossary import error', error);
    return serverError(res, 'Glossar konnte nicht importiert werden');
  }
}

export default withOrgScope({ permission: 'org.read' }, handler);
