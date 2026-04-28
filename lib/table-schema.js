export const TABLE_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Zahl' },
  { value: 'currency', label: 'Währung' },
  { value: 'date', label: 'Datum' },
];

const VALID_FIELD_TYPES = new Set(TABLE_FIELD_TYPES.map((entry) => entry.value));

export function sanitizeTableKey(value, fallback = 'feld') {
  const normalized = String(value || '')
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return fallback;
  if (!/^[a-z]/.test(normalized)) return `k_${normalized}`;
  return normalized;
}

export function inferTableFieldType(label) {
  const lower = String(label || '').toLocaleLowerCase('de-DE');
  if (/datum|date|faellig|fällig|tag/.test(lower)) return 'date';
  if (/preis|betrag|kosten|summe|total|eur|€|honorar|satz/.test(lower)) return 'currency';
  if (/anzahl|menge|stunden|qty|quantity|nr|nummer|wert/.test(lower)) return 'number';
  return 'text';
}

function normalizeField(field, index, prefix, fallbackLabel) {
  const label = String(field?.label || '').trim() || `${fallbackLabel} ${index + 1}`;
  const key = sanitizeTableKey(field?.key || label, `${prefix}_${index + 1}`);
  const type = VALID_FIELD_TYPES.has(field?.type) ? field.type : inferTableFieldType(label);

  return {
    key,
    label,
    type,
    required: Boolean(field?.required),
    editable: field?.editable !== false,
    hint: String(field?.hint || '').trim().slice(0, 250),
  };
}

function normalizeColumn(column, index) {
  const normalized = normalizeField(column, index, 'spalte', 'Spalte');
  return {
    key: normalized.key,
    label: normalized.label,
    type: normalized.type,
    required: normalized.required,
    editable: normalized.editable,
  };
}

function normalizeRow(row, index) {
  const normalized = normalizeField(row, index, 'zeile', 'Zeile');
  return {
    key: normalized.key,
    label: normalized.label,
    required: normalized.required,
    editable: normalized.editable,
    hint: normalized.hint,
  };
}

function normalizeMetadataField(field, index) {
  const normalized = normalizeField(field, index, 'meta', 'Metadatum');
  return {
    key: normalized.key,
    label: normalized.label,
    type: normalized.type,
    required: normalized.required,
    editable: normalized.editable,
    hint: normalized.hint,
  };
}

export function createDefaultTableSchema() {
  return {
    tableName: '',
    description: '',
    metadata: [],
    columns: [
      { key: 'spalte_1', label: 'Spalte 1', type: 'text', required: false, editable: true },
      { key: 'spalte_2', label: 'Spalte 2', type: 'text', required: false, editable: true },
      { key: 'spalte_3', label: 'Spalte 3', type: 'text', required: false, editable: true },
    ],
    rows: [
      { key: 'zeile_1', label: 'Zeile 1', required: false, editable: true, hint: '' },
      { key: 'zeile_2', label: 'Zeile 2', required: false, editable: true, hint: '' },
      { key: 'zeile_3', label: 'Zeile 3', required: false, editable: true, hint: '' },
    ],
    calculations: [],
  };
}

export function normalizeTableSchema(input) {
  const fallback = createDefaultTableSchema();
  const base = input && typeof input === 'object' ? input : fallback;
  const columns = Array.isArray(base.columns) && base.columns.length > 0
    ? base.columns.map(normalizeColumn)
    : fallback.columns;
  const rows = Array.isArray(base.rows)
    ? base.rows.map(normalizeRow)
    : [];
  const metadata = Array.isArray(base.metadata)
    ? base.metadata.map(normalizeMetadataField)
    : [];

  return {
    tableName: String(base.tableName || '').trim(),
    description: String(base.description || '').trim(),
    metadata,
    columns,
    rows,
    calculations: [],
  };
}

export function splitTableLabels(value) {
  return String(value || '')
    .split(/[\n,;|\t]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function createEmptyTableRow(schema, rowDefinition = null) {
  const normalizedSchema = normalizeTableSchema(schema);
  const row = {};
  if (rowDefinition?.key) {
    row.row_key = rowDefinition.key;
  }
  normalizedSchema.columns.forEach((column) => {
    row[column.key] = '';
  });
  return row;
}

export function orderRowsBySchema(rows, schema) {
  const normalizedSchema = normalizeTableSchema(schema);
  const sourceRows = Array.isArray(rows) ? rows : [];
  const fixedRows = normalizedSchema.rows;

  if (fixedRows.length === 0) {
    return sourceRows.map((row) => (row && typeof row === 'object' ? row : {}));
  }

  const usedIndexes = new Set();
  const ordered = fixedRows.map((rowDefinition, index) => {
    const directIndex = sourceRows.findIndex((row, rowIndex) => (
      !usedIndexes.has(rowIndex)
      && row
      && typeof row === 'object'
      && String(row.row_key || row.rowKey || '') === rowDefinition.key
    ));
    const fallbackIndex = directIndex >= 0
      ? directIndex
      : (sourceRows[index] && !usedIndexes.has(index) ? index : -1);
    const source = fallbackIndex >= 0 && sourceRows[fallbackIndex] && typeof sourceRows[fallbackIndex] === 'object'
      ? sourceRows[fallbackIndex]
      : {};
    if (fallbackIndex >= 0) usedIndexes.add(fallbackIndex);
    return {
      ...createEmptyTableRow(normalizedSchema, rowDefinition),
      ...source,
      row_key: rowDefinition.key,
    };
  });

  sourceRows.forEach((row, rowIndex) => {
    if (usedIndexes.has(rowIndex)) return;
    if (!row || typeof row !== 'object') return;
    ordered.push(row);
  });

  return ordered;
}

export function getRowDefinitionByKey(schema, key) {
  const normalizedSchema = normalizeTableSchema(schema);
  return normalizedSchema.rows.find((row) => row.key === key) || null;
}

export function getTableRowLabel(schema, row, index) {
  const key = row?.row_key || row?.rowKey;
  const rowDefinition = getRowDefinitionByKey(schema, key);
  return rowDefinition?.label || `Zeile ${index + 1}`;
}

export function normalizeTableMetadata(metadata, schema) {
  const normalizedSchema = normalizeTableSchema(schema);
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const result = {};
  normalizedSchema.metadata.forEach((field) => {
    result[field.key] = source[field.key] ?? '';
  });
  return result;
}
