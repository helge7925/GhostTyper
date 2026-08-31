export function buildAuditRetentionPlan(rows, cutoff) {
  const cutoffMs = new Date(cutoff).valueOf();
  if (Number.isNaN(cutoffMs)) throw new Error('INVALID_RETENTION_CUTOFF');
  const expired = [];
  const retained = [];
  for (const row of rows) {
    if (new Date(row.created_at).valueOf() < cutoffMs) expired.push(row);
    else retained.push(row);
  }
  return {
    expired,
    retained,
    prunedRows: expired.length,
    priorHead: rows.at(-1)?.entry_hash || null,
  };
}
