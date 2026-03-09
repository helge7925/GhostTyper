import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCalculations,
  buildTableExtractionPrompt,
  calculateFooterStats,
  evaluateFormula,
  validateTableSchema,
} from '../lib/table-calculations.js';

test('evaluateFormula computes numeric expressions with column keys', () => {
  const row = {
    qty: 3,
    preis: 2,
    preis_total: 10,
  };

  const result = evaluateFormula('qty * preis_total + preis', row);
  assert.equal(result, 32);
});

test('evaluateFormula blocks invalid characters', () => {
  const result = evaluateFormula('qty + alert(1)', { qty: 1 });
  assert.equal(result, 0);
});

test('applyCalculations adds computed columns', () => {
  const row = { menge: 4, einzelpreis: 12.5 };
  const calculations = [
    {
      key: 'gesamt',
      formula: 'menge * einzelpreis',
      displayInTable: true,
    },
  ];

  const result = applyCalculations(row, calculations);
  assert.equal(result.gesamt, 50);
});

test('calculateFooterStats supports sum() formulas', () => {
  const rows = [
    { menge: 2, preis: 10 },
    { menge: 3, preis: 5 },
  ];
  const columns = [
    { key: 'menge', type: 'number' },
    { key: 'preis', type: 'number' },
  ];
  const calculations = [
    {
      key: 'gesamt_menge',
      formula: 'sum(menge)',
      displayInFooter: true,
    },
    {
      key: 'gesamt_preis',
      formula: 'sum(preis)',
      displayInFooter: true,
    },
  ];

  const stats = calculateFooterStats(rows, columns, calculations);
  assert.equal(stats.gesamt_menge, 5);
  assert.equal(stats.gesamt_preis, 15);
});

test('validateTableSchema returns errors for invalid schema', () => {
  const invalidSchema = {
    tableName: '',
    columns: [
      { key: 'wert', label: 'Wert', type: 'number' },
      { key: 'wert', label: 'Duplikat', type: 'number' },
    ],
  };

  const result = validateTableSchema(invalidSchema);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.length > 0);
});

test('validateTableSchema rejects unknown formula identifiers', () => {
  const invalidSchema = {
    tableName: 'Pruefung',
    columns: [
      { key: 'menge', label: 'Menge', type: 'number' },
      { key: 'preis', label: 'Preis', type: 'number' },
    ],
    calculations: [
      {
        key: 'gesamt',
        formula: 'menge * fremdwert',
      },
    ],
  };

  const result = validateTableSchema(invalidSchema);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((entry) => entry.includes('Unbekannter Spalten-Key')));
});

test('buildTableExtractionPrompt includes table context and repeated-table hint', () => {
  const schema = {
    tableName: 'Aufmass',
    description: 'Extrahiere Positionen',
    columns: [
      { key: 'position', label: 'Position', type: 'text', required: true },
      { key: 'menge', label: 'Menge', type: 'number', required: false },
    ],
  };

  const prompt = buildTableExtractionPrompt(schema, 'de');

  assert.ok(prompt.includes('TABELLE: Aufmass'));
  assert.ok(prompt.includes('Wenn die gleiche Tabellenstruktur mehrfach im Text vorkommt'));
  assert.ok(prompt.includes('{{TEXT}}'));
});

test('validateTableSchema rejects duplicate row keys', () => {
  const invalidSchema = {
    tableName: 'Row-Test',
    columns: [
      { key: 'wert', label: 'Wert', type: 'text' },
    ],
    rows: [
      { key: 'summe', label: 'Summe' },
      { key: 'summe', label: 'Summe doppelt' },
    ],
  };

  const result = validateTableSchema(invalidSchema);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((entry) => entry.includes('Zeilen-Keys')));
});

test('buildTableExtractionPrompt includes row_key instructions when rows are defined', () => {
  const schema = {
    tableName: 'Kennzahlen',
    description: 'Extrahiere Kennzahlen nach Zeilentyp',
    columns: [
      { key: 'wert', label: 'Wert', type: 'number', required: true },
    ],
    rows: [
      { key: 'umsatz', label: 'Umsatz', required: true },
      { key: 'kosten', label: 'Kosten', required: false },
    ],
  };

  const prompt = buildTableExtractionPrompt(schema, 'de');
  assert.ok(prompt.includes('VORDEFINIERTE ZEILEN'));
  assert.ok(prompt.includes('"row_key"'));
  assert.ok(prompt.includes('umsatz'));
});
