import { useCallback, useEffect, useMemo, useState } from 'react';
import { exportTableToCSV, exportTableToExcel, exportTableToHTML } from '../lib/table-export';
import {
  createEmptyTableRow,
  getTableRowLabel,
  normalizeTableMetadata,
  normalizeTableSchema,
  orderRowsBySchema,
} from '../lib/table-schema';

function isMissingValue(value) {
  return value === null || value === undefined || value === '';
}

function formatValue(value, type) {
  if (isMissingValue(value)) {
    return <span className="text-secondary/30">-</span>;
  }

  if (type === 'currency') {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? <span className="font-mono">{parsed.toFixed(2).replace('.', ',')} €</span>
      : <span>{value}</span>;
  }

  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? <span className="font-mono">{parsed.toLocaleString('de-DE')}</span>
      : <span>{value}</span>;
  }

  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return <span>{`${day}.${month}.${year}`}</span>;
  }

  return <span>{value}</span>;
}

function normalizeInputValue(value, type) {
  if (type === 'number' || type === 'currency') {
    if (value === '') return '';
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function CellEditor({ type, value, onChange }) {
  const inputType = type === 'date' ? 'date' : type === 'number' || type === 'currency' ? 'number' : 'text';
  return (
    <input
      type={inputType}
      value={value ?? ''}
      onChange={(event) => onChange(normalizeInputValue(event.target.value, type))}
      className="w-full min-w-[120px] bg-surface-elevated border border-accent/50 rounded px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-accent"
      step={type === 'currency' ? '0.01' : type === 'number' ? '1' : undefined}
    />
  );
}

export default function TableRenderer({
  initialData,
  schema,
  onChange,
  filename = 'export',
  editable = false,
  startInEditMode = false,
  alwaysEditing = false,
  showToolbar = true,
}) {
  const normalizedSchema = useMemo(() => normalizeTableSchema(schema), [schema]);
  const [editMode, setEditMode] = useState(startInEditMode || alwaysEditing);
  const [rows, setRows] = useState(() => orderRowsBySchema(initialData?.rows || [], normalizedSchema));
  const [metadata, setMetadata] = useState(() => normalizeTableMetadata(initialData?.metadata || {}, normalizedSchema));
  const [copyFeedback, setCopyFeedback] = useState(false);

  useEffect(() => {
    setRows(orderRowsBySchema(initialData?.rows || [], normalizedSchema));
    setMetadata(normalizeTableMetadata(initialData?.metadata || {}, normalizedSchema));
  }, [initialData, normalizedSchema]);

  const isEditing = alwaysEditing || editMode;
  const includeRowTitle = normalizedSchema.rows.length > 0;

  const missingMetadataFields = useMemo(() => (
    normalizedSchema.metadata
      .filter((field) => field.required && isMissingValue(metadata[field.key]))
      .map((field) => field.key)
  ), [metadata, normalizedSchema.metadata]);

  const missingFieldsByRow = useMemo(() => {
    const requiredColumns = normalizedSchema.columns.filter((column) => column.required);
    const map = new Map();

    rows.forEach((row, rowIndex) => {
      const missing = requiredColumns
        .filter((column) => isMissingValue(row?.[column.key]))
        .map((column) => column.key);
      if (missing.length > 0) {
        map.set(rowIndex, missing);
      }
    });

    const persisted = Array.isArray(initialData?.missing_fields_by_row)
      ? initialData.missing_fields_by_row
      : [];
    persisted.forEach((entry) => {
      const rowIndex = Number(entry?.rowIndex);
      if (!Number.isFinite(rowIndex)) return;
      const existing = map.get(rowIndex) || [];
      const merged = [...new Set([...existing, ...(entry?.fields || [])])];
      if (merged.length > 0) {
        map.set(rowIndex, merged);
      }
    });

    return map;
  }, [rows, initialData?.missing_fields_by_row, normalizedSchema.columns]);

  const emitChange = useCallback((nextRows, nextMetadata) => {
    const requiredColumns = normalizedSchema.columns.filter((column) => column.required);
    const missing = [];
    nextRows.forEach((row, rowIndex) => {
      const fields = requiredColumns
        .filter((column) => isMissingValue(row?.[column.key]))
        .map((column) => column.key);
      if (fields.length > 0) missing.push({ rowIndex, fields });
    });
    const missingMetadata = normalizedSchema.metadata
      .filter((field) => field.required && isMissingValue(nextMetadata[field.key]))
      .map((field) => field.key);

    onChange?.({
      metadata: nextMetadata,
      rows: nextRows,
      missing_fields_by_row: missing,
      missing_metadata_fields: missingMetadata,
    });
  }, [normalizedSchema.columns, normalizedSchema.metadata, onChange]);

  function updateMetadata(fieldKey, value) {
    const nextMetadata = { ...metadata, [fieldKey]: value };
    setMetadata(nextMetadata);
    emitChange(rows, nextMetadata);
  }

  function updateCell(rowIndex, columnKey, value) {
    const nextRows = rows.map((row, index) => (
      index === rowIndex ? { ...row, [columnKey]: value } : row
    ));
    setRows(nextRows);
    emitChange(nextRows, metadata);
  }

  function addRow() {
    const nextRows = [
      ...rows,
      createEmptyTableRow(normalizedSchema),
    ];
    setRows(nextRows);
    emitChange(nextRows, metadata);
  }

  function removeRow(index) {
    const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
    setRows(nextRows);
    emitChange(nextRows, metadata);
  }

  async function handleExport(format) {
    const exportData = { metadata, rows };
    if (format === 'csv') {
      exportTableToCSV(exportData, normalizedSchema, filename);
      return;
    }
    if (format === 'excel') {
      await exportTableToExcel(exportData, normalizedSchema, filename);
      return;
    }
    if (format === 'copy') {
      const html = exportTableToHTML(exportData, normalizedSchema);
      try {
        await navigator.clipboard.writeText(html);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2000);
      } catch (error) {
        console.error('Kopieren fehlgeschlagen:', error);
      }
    }
  }

  return (
    <div className="bg-surface rounded-2xl overflow-hidden border border-subtle">
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-subtle">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-primary">{normalizedSchema.tableName || 'Datentabelle'}</h3>
            <span className="text-sm text-secondary">{rows.length} Zeilen</span>
            {missingMetadataFields.length > 0 && (
              <span className="text-[11px] px-2 py-1 rounded-full border border-danger/40 text-danger bg-danger/10">
                Metadaten unvollständig
              </span>
            )}
            {missingFieldsByRow.size > 0 && (
              <span className="text-[11px] px-2 py-1 rounded-full border border-danger/40 text-danger bg-danger/10">
                {missingFieldsByRow.size} Zeilen unvollständig
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editable && !alwaysEditing && (
              <button
                type="button"
                onClick={() => setEditMode((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  editMode
                    ? 'bg-accent text-white'
                    : 'bg-hover-subtle text-secondary hover:text-primary'
                }`}
              >
                {editMode ? 'Fertig' : 'Bearbeiten'}
              </button>
            )}

            {editable && isEditing && !includeRowTitle && (
              <button
                type="button"
                onClick={addRow}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-success/20 text-success hover:bg-success/30 transition-all"
              >
                + Zeile
              </button>
            )}

            <div className="w-px h-4 bg-hover-strong mx-1" />
            <button
              type="button"
              onClick={() => handleExport('excel')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-success/20 text-success hover:bg-success/30 transition-all"
              title="Excel exportieren"
            >
              Excel
            </button>
            <button
              type="button"
              onClick={() => handleExport('csv')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-hover-subtle text-secondary hover:text-primary transition-all"
              title="CSV exportieren"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleExport('copy')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                copyFeedback
                  ? 'bg-success/20 text-success'
                  : 'bg-hover-subtle text-secondary hover:text-primary'
              }`}
              title="Als HTML-Tabelle kopieren"
            >
              {copyFeedback ? 'Kopiert!' : 'Kopieren'}
            </button>
          </div>
        </div>
      )}

      {normalizedSchema.metadata.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 border-b border-subtle bg-hover-subtle">
          {normalizedSchema.metadata.map((field) => {
            const missing = field.required && isMissingValue(metadata[field.key]);
            return (
              <label key={field.key} className="block">
                <span className="block text-[11px] uppercase tracking-wider text-secondary mb-1">
                  {field.label}{field.required && <span className="text-danger ml-1">*</span>}
                </span>
                {editable && isEditing && field.editable !== false ? (
                  <CellEditor
                    type={field.type}
                    value={metadata[field.key]}
                    onChange={(value) => updateMetadata(field.key, value)}
                  />
                ) : (
                  <div className={`min-h-[34px] rounded-lg border px-3 py-2 text-sm text-primary ${missing ? 'border-danger/50 bg-danger/5' : 'border-subtle bg-hover-subtle'}`}>
                    {formatValue(metadata[field.key], field.type)}
                  </div>
                )}
              </label>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-hover-subtle">
            <tr>
              {editable && isEditing && !includeRowTitle && <th className="w-10 px-2 py-2" />}
              {includeRowTitle && (
                <th className="sticky left-0 z-10 bg-surface-elevated px-3 py-2 text-left text-xs font-bold text-secondary uppercase tracking-wider whitespace-nowrap border-r border-subtle">
                  Zeile
                </th>
              )}
              {normalizedSchema.columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-2 text-left text-xs font-bold text-secondary uppercase tracking-wider whitespace-nowrap ${
                    column.type === 'currency' || column.type === 'number' ? 'text-right' : ''
                  }`}
                >
                  {column.label}
                  {column.required && <span className="text-danger ml-1">*</span>}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-subtle">
            {rows.map((row, rowIndex) => (
              <tr
                key={`${row.row_key || 'row'}-${rowIndex}`}
                className={`hover:bg-hover-subtle ${missingFieldsByRow.has(rowIndex) ? 'bg-danger/5' : ''}`}
              >
                {editable && isEditing && !includeRowTitle && (
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(rowIndex)}
                      className="p-1 text-danger/50 hover:text-danger transition-colors"
                      aria-label={`Zeile ${rowIndex + 1} entfernen`}
                    >
                      ×
                    </button>
                  </td>
                )}
                {includeRowTitle && (
                  <th className="sticky left-0 z-10 bg-surface-elevated px-3 py-2 text-left text-sm text-primary font-semibold border-r border-subtle">
                    {getTableRowLabel(normalizedSchema, row, rowIndex)}
                  </th>
                )}
                {normalizedSchema.columns.map((column) => {
                  const isEditable = editable && isEditing && column.editable !== false;
                  const missing = missingFieldsByRow.get(rowIndex)?.includes(column.key);
                  return (
                    <td
                      key={column.key}
                      className={`px-3 py-2 text-sm ${
                        column.type === 'currency' || column.type === 'number' ? 'text-right' : 'text-left'
                      } text-primary ${missing ? 'ring-1 ring-inset ring-danger/40 rounded-sm' : ''}`}
                    >
                      {isEditable ? (
                        <CellEditor
                          type={column.type}
                          value={row?.[column.key]}
                          onChange={(value) => updateCell(rowIndex, column.key, value)}
                        />
                      ) : (
                        formatValue(row?.[column.key], column.type)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={normalizedSchema.columns.length + (includeRowTitle ? 1 : 0) + (editable && isEditing && !includeRowTitle ? 1 : 0)}
                  className="px-4 py-8 text-center text-secondary"
                >
                  Keine Daten vorhanden
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(missingMetadataFields.length > 0 || missingFieldsByRow.size > 0) && (
        <div className="px-4 py-3 bg-hover-subtle border-t border-subtle text-[10px] text-danger/90">
          {missingMetadataFields.length > 0 && (
            <p>Fehlende Metadaten: {missingMetadataFields.join(', ')}</p>
          )}
          {missingFieldsByRow.size > 0 && (
            <p>
              Fehlende Pflichtfelder:{' '}
              {Array.from(missingFieldsByRow.entries())
                .slice(0, 4)
                .map(([rowIndex, fields]) => `Zeile ${rowIndex + 1} (${fields.join(', ')})`)
                .join(' | ')}
              {missingFieldsByRow.size > 4 ? ' ...' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
