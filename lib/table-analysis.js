import { validateTableSchema } from './table-calculations';

function toPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).trim() || null;
  }
  return date.toISOString().slice(0, 10);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string'
    ? Number.parseFloat(value.replace(',', '.'))
    : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeByType(value, type) {
  if (type === 'number' || type === 'currency') return normalizeNumber(value);
  if (type === 'date') return normalizeDate(value);
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeRows(rawRows) {
  if (Array.isArray(rawRows)) return rawRows;
  return [];
}

export function normalizeAndValidateTableAnalysis(rawAnalysis, schema) {
  const schemaValidation = validateTableSchema(schema);
  if (!schemaValidation.isValid) {
    return {
      rows: [],
      extrahierte_zeilen_anzahl: 0,
      unvollstaendige_daten: ['Tabellen-Schema ist ungültig.'],
      zusammenfassung: 'Tabellen-Extraktion konnte nicht validiert werden.',
      missing_fields_by_row: [],
      schema_warnings: schemaValidation.errors,
    };
  }

  let payload = rawAnalysis;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  if (Array.isArray(payload)) {
    payload = { rows: payload };
  }

  const analysis = toPlainObject(payload);
  const rows = normalizeRows(analysis.rows);
  const definedRows = Array.isArray(schema.rows)
    ? schema.rows.filter((row) => row && row.key)
    : [];
  const definedRowKeys = new Set(definedRows.map((row) => row.key));
  const observedRowKeys = new Set();
  const normalizedRows = [];
  const missingFieldsByRow = [];
  const detailHints = Array.isArray(analysis.unvollstaendige_daten)
    ? analysis.unvollstaendige_daten.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  for (let i = 0; i < rows.length; i += 1) {
    const source = toPlainObject(rows[i]);
    const target = {};
    const missing = [];

    if (definedRows.length > 0) {
      const rowKey = String(source.row_key || source.rowKey || '').trim();
      target.row_key = rowKey || null;
      if (rowKey) {
        observedRowKeys.add(rowKey);
        if (!definedRowKeys.has(rowKey)) {
          detailHints.push(`Zeile ${i + 1}: Unbekannter row_key (${rowKey})`);
        }
      } else {
        missing.push('row_key');
      }
    }

    for (const column of schema.columns) {
      const normalizedValue = normalizeByType(source[column.key], column.type);
      target[column.key] = normalizedValue;

      const isMissing = normalizedValue === null || normalizedValue === '';
      if (isMissing && column.required) {
        missing.push(column.key);
      }
    }

    normalizedRows.push(target);
    if (missing.length > 0) {
      missingFieldsByRow.push({
        rowIndex: i,
        fields: missing,
      });
      detailHints.push(`Zeile ${i + 1}: Fehlende Pflichtfelder (${missing.join(', ')})`);
    }
  }

  if (definedRows.length > 0) {
    for (const rowDefinition of definedRows) {
      if (rowDefinition.required && !observedRowKeys.has(rowDefinition.key)) {
        detailHints.push(`Pflicht-Zeile fehlt: ${rowDefinition.label} (${rowDefinition.key})`);
      }
    }
  }

  return {
    rows: normalizedRows,
    extrahierte_zeilen_anzahl: normalizedRows.length,
    unvollstaendige_daten: [...new Set(detailHints)].slice(0, 50),
    zusammenfassung: String(analysis.zusammenfassung || '').trim(),
    missing_fields_by_row: missingFieldsByRow,
    schema_warnings: [],
  };
}
