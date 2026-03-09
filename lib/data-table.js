const VALID_TYPES = new Set(['text', 'number', 'currency', 'date']);

function toPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const stripped = raw.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (!stripped) return null;

  let normalized = stripped;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readFirstString(candidates) {
  for (const entry of candidates) {
    if (typeof entry === 'string' && entry.trim()) {
      return entry.trim();
    }
  }
  return '';
}

function normalizeLabel(input, fallback) {
  const value = String(input || '').trim();
  if (!value) return fallback;
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeKey(input, fallbackIndex, usedKeys) {
  const source = String(input || '').trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const base = source || `spalte_${fallbackIndex + 1}`;
  let key = base;
  let i = 2;
  while (usedKeys.has(key)) {
    key = `${base}_${i}`;
    i += 1;
  }
  usedKeys.add(key);
  return key;
}

function normalizeColumnType(type, values) {
  const hinted = String(type || '').trim().toLowerCase();
  if (VALID_TYPES.has(hinted)) return hinted;

  const nonEmpty = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
  if (nonEmpty.length === 0) return 'text';

  const numberHits = nonEmpty.filter((value) => parseNumber(value) !== null).length;
  const dateHits = nonEmpty.filter((value) => normalizeDate(value) !== null).length;
  const currencyHits = nonEmpty.filter((value) => /[€$£]/.test(String(value))).length;

  if (currencyHits > 0 && numberHits >= Math.max(1, Math.ceil(nonEmpty.length * 0.7))) {
    return 'currency';
  }
  if (dateHits >= Math.max(1, Math.ceil(nonEmpty.length * 0.8))) {
    return 'date';
  }
  if (numberHits >= Math.max(1, Math.ceil(nonEmpty.length * 0.8))) {
    return 'number';
  }
  return 'text';
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  const data = toPlainObject(payload);

  const rowCandidates = [
    data.rows,
    data.zeilen,
    data.data,
    data.records,
    data.entries,
    data.eintraege,
    data.items,
  ];

  for (const candidate of rowCandidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function extractColumnDefinitions(payload) {
  if (Array.isArray(payload)) return [];
  const data = toPlainObject(payload);
  const candidates = [data.columns, data.spalten, data.headers, data.felder];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function inferColumnsFromRows(rows) {
  const ordered = [];
  const seen = new Set();

  for (const row of rows) {
    const source = toPlainObject(row);
    for (const key of Object.keys(source)) {
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push({ key, label: normalizeLabel(key, key) });
    }
  }

  return ordered;
}

function normalizeCellValue(value, type) {
  if (value === null || value === undefined || value === '') return null;

  if (type === 'number' || type === 'currency') {
    return parseNumber(value);
  }

  if (type === 'date') {
    const normalizedDate = normalizeDate(value);
    return normalizedDate || String(value).trim();
  }

  return String(value).trim();
}

function normalizeRows(rows, columns) {
  const normalized = [];

  for (const row of rows) {
    const source = toPlainObject(row);
    const target = {};

    columns.forEach((column) => {
      const lookupKeys = [column.sourceKey, column.key].filter(Boolean);
      let rawValue = null;

      for (const lookupKey of lookupKeys) {
        if (Object.prototype.hasOwnProperty.call(source, lookupKey)) {
          rawValue = source[lookupKey];
          break;
        }
      }

      target[column.key] = normalizeCellValue(rawValue, column.type);
    });

    normalized.push(target);
  }

  return normalized;
}

function collectMissingData(payload) {
  const data = toPlainObject(payload);
  const candidates = [
    data.unvollstaendige_daten,
    data.missing_data,
    data.missing,
    data.hinweise,
    data.notes,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 50);
    }
  }

  return [];
}

export function normalizeDataTableAnalysis(rawAnalysis, language = 'de') {
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

  const data = toPlainObject(payload);
  const tableName = readFirstString([
    data.tabellenname,
    data.table_name,
    data.tableName,
    data.titel,
    data.title,
    language === 'en' ? 'Data table' : 'Datentabelle',
  ]);

  const rawRows = extractRows(data)
    .map((row) => toPlainObject(row))
    .filter((row) => Object.keys(row).length > 0);

  const rawColumns = extractColumnDefinitions(data);
  const usedKeys = new Set();

  let columns = rawColumns
    .map((column, index) => {
      if (typeof column === 'string') {
        const key = normalizeKey(column, index, usedKeys);
        return {
          key,
          sourceKey: column,
          label: normalizeLabel(column, `Spalte ${index + 1}`),
          type: 'text',
          required: false,
          editable: true,
        };
      }

      const source = toPlainObject(column);
      const sourceKey = readFirstString([source.key, source.id, source.name, source.field]);
      const label = readFirstString([source.label, source.name, source.title, sourceKey]);
      const key = normalizeKey(sourceKey || label, index, usedKeys);

      return {
        key,
        sourceKey,
        label: normalizeLabel(label, `Spalte ${index + 1}`),
        type: source.type,
        required: false,
        editable: true,
      };
    })
    .filter((column) => column.key);

  if (columns.length === 0) {
    const inferred = inferColumnsFromRows(rawRows);
    columns = inferred.map((column, index) => {
      const key = normalizeKey(column.key || column.label, index, usedKeys);
      return {
        key,
        sourceKey: column.key,
        label: normalizeLabel(column.label, `Spalte ${index + 1}`),
        type: 'text',
        required: false,
        editable: true,
      };
    });
  }

  if (columns.length === 0) {
    const fallbackKey = normalizeKey('wert', 0, usedKeys);
    columns = [{
      key: fallbackKey,
      sourceKey: fallbackKey,
      label: language === 'en' ? 'Value' : 'Wert',
      type: 'text',
      required: false,
      editable: true,
    }];
  }

  columns = columns.map((column) => {
    const values = rawRows.map((row) => {
      const lookupKeys = [column.sourceKey, column.key].filter(Boolean);
      for (const lookupKey of lookupKeys) {
        if (Object.prototype.hasOwnProperty.call(row, lookupKey)) {
          return row[lookupKey];
        }
      }
      return null;
    });

    return {
      key: column.key,
      label: column.label,
      type: normalizeColumnType(column.type, values),
      required: false,
      editable: true,
    };
  });

  const rows = normalizeRows(rawRows, columns);
  const summary = readFirstString([
    data.zusammenfassung,
    data.summary,
    data.kurzfassung,
    data.description,
  ]);

  return {
    rows,
    schema: {
      tableName,
      description: language === 'en' ? 'Extracted data table' : 'Extrahierte Datentabelle',
      columns,
      calculations: [],
    },
    meta: {
      extrahierte_zeilen_anzahl: rows.length,
      zusammenfassung: summary,
      unvollstaendige_daten: collectMissingData(data),
      missing_fields_by_row: [],
    },
  };
}
