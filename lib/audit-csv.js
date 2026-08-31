function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function eventsToCsv(events) {
  const columns = [
    'id', 'organization_id', 'created_at', 'user_id', 'action', 'target_type',
    'target_id', 'severity', 'metadata', 'prev_hash', 'entry_hash',
  ];
  const rows = events.map((event) => [
    event.id,
    event.organization_id,
    event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at,
    event.user_id,
    event.action,
    event.target_type,
    event.target_id,
    event.severity || 'info',
    JSON.stringify(event.metadata || {}),
    event.prev_hash,
    event.entry_hash,
  ].map(csvCell).join(','));
  return `${columns.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}
