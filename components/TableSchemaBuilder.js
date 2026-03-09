import { useEffect, useMemo, useState } from 'react';
import { validateTableSchema } from '../lib/table-calculations';
import { generateSchemaFromDescription } from '../lib/table-template-generator';

const COLUMN_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Zahl' },
  { value: 'currency', label: 'Währung' },
  { value: 'date', label: 'Datum' },
];

const QUICKSTART_PRESETS = [
  {
    id: 'invoice',
    label: 'Rechnung',
    description: 'Positionen mit Menge und Preis',
    schema: {
      tableName: 'Rechnungspositionen',
      description: 'Extrahiert Positionen aus Rechnungen oder Lieferscheinen.',
      columns: [
        { key: 'pos', label: 'Pos.', type: 'number', required: false, editable: true },
        { key: 'artikel', label: 'Artikel / Leistung', type: 'text', required: true, editable: true },
        { key: 'menge', label: 'Menge', type: 'number', required: true, editable: true },
        { key: 'einheit', label: 'Einheit', type: 'text', required: false, editable: true },
        { key: 'einzelpreis', label: 'Einzelpreis', type: 'currency', required: true, editable: true },
      ],
      rows: [],
      calculations: [
        {
          key: 'gesamt',
          label: 'Gesamt',
          type: 'currency',
          formula: 'menge * einzelpreis',
          displayInTable: true,
          displayInFooter: true,
        },
      ],
    },
  },
  {
    id: 'time',
    label: 'Zeiterfassung',
    description: 'Datum, Projekt, Stunden, Satz',
    schema: {
      tableName: 'Stundenzettel',
      description: 'Extrahiert Zeiterfassungszeilen aus Besprechungen oder Notizen.',
      columns: [
        { key: 'datum', label: 'Datum', type: 'date', required: true, editable: true },
        { key: 'projekt', label: 'Projekt', type: 'text', required: false, editable: true },
        { key: 'taetigkeit', label: 'Tätigkeit', type: 'text', required: true, editable: true },
        { key: 'stunden', label: 'Stunden', type: 'number', required: true, editable: true },
        { key: 'stundensatz', label: 'Stundensatz', type: 'currency', required: false, editable: true },
      ],
      rows: [],
      calculations: [
        {
          key: 'kosten',
          label: 'Kosten',
          type: 'currency',
          formula: 'stunden * stundensatz',
          displayInTable: true,
          displayInFooter: true,
        },
      ],
    },
  },
  {
    id: 'actions',
    label: 'Aktionsliste',
    description: 'Aufgaben aus Protokollen',
    schema: {
      tableName: 'Aktionsliste',
      description: 'Extrahiert Aufgaben, Verantwortliche und Termine aus Transkripten.',
      columns: [
        { key: 'thema', label: 'Thema', type: 'text', required: true, editable: true },
        { key: 'aufgabe', label: 'Aufgabe', type: 'text', required: true, editable: true },
        { key: 'verantwortlich', label: 'Verantwortlich', type: 'text', required: true, editable: true },
        { key: 'faellig', label: 'Fällig am', type: 'date', required: false, editable: true },
        { key: 'status', label: 'Status', type: 'text', required: false, editable: true },
      ],
      rows: [],
      calculations: [],
    },
  },
];

function createDefaultSchema() {
  return {
    tableName: '',
    description: '',
    columns: [
      { key: 'spalte_1', label: 'Spalte 1', type: 'text', required: false, editable: true },
      { key: 'spalte_2', label: 'Spalte 2', type: 'text', required: false, editable: true },
      { key: 'spalte_3', label: 'Spalte 3', type: 'text', required: false, editable: true },
    ],
    rows: [],
    calculations: [],
  };
}

function sanitizeKey(value, fallback = 'spalte') {
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

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferTypeByLabel(label) {
  const lower = String(label || '').toLocaleLowerCase('de-DE');
  if (/datum|date|faellig|fällig/.test(lower)) return 'date';
  if (/preis|betrag|kosten|summe|total|eur|€/.test(lower)) return 'currency';
  if (/anzahl|menge|stunden|qty|quantity|nr|nummer/.test(lower)) return 'number';
  return 'text';
}

function splitLabels(value) {
  return String(value || '')
    .split(/[\n,;|\t]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeColumn(column, index) {
  const label = String(column?.label || '').trim() || `Spalte ${index + 1}`;
  const key = sanitizeKey(column?.key || label, `spalte_${index + 1}`);
  const type = COLUMN_TYPE_OPTIONS.some((option) => option.value === column?.type)
    ? column.type
    : inferTypeByLabel(label);

  return {
    key,
    label,
    type,
    required: Boolean(column?.required),
    editable: column?.editable !== false,
  };
}

function normalizeRowDefinition(row, index) {
  const label = String(row?.label || '').trim() || `Zeile ${index + 1}`;
  const key = sanitizeKey(row?.key || label, `zeile_${index + 1}`);
  return {
    key,
    label,
    required: Boolean(row?.required),
    editable: row?.editable !== false,
    hint: String(row?.hint || '').trim().slice(0, 250),
  };
}

function normalizeCalculation(calculation, index) {
  const label = String(calculation?.label || '').trim() || `Berechnung ${index + 1}`;
  const key = sanitizeKey(calculation?.key || label, `berechnung_${index + 1}`);

  return {
    key,
    label,
    type: calculation?.type === 'currency' ? 'currency' : 'number',
    formula: String(calculation?.formula || '').trim(),
    displayInTable: calculation?.displayInTable !== false,
    displayInFooter: calculation?.displayInFooter !== false,
  };
}

function normalizeSchema(input) {
  const fallback = createDefaultSchema();
  const base = input && typeof input === 'object' ? input : fallback;
  const columns = Array.isArray(base.columns) && base.columns.length > 0
    ? base.columns.map((column, index) => normalizeColumn(column, index))
    : fallback.columns;
  const rows = Array.isArray(base.rows)
    ? base.rows.map((row, index) => normalizeRowDefinition(row, index))
    : [];
  const calculations = Array.isArray(base.calculations)
    ? base.calculations.map((calculation, index) => normalizeCalculation(calculation, index))
    : [];

  return {
    tableName: String(base.tableName || '').trim(),
    description: String(base.description || '').trim(),
    columns,
    rows,
    calculations,
  };
}

function schemasEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function TableSchemaBuilder({ schema: initialSchema, onChange }) {
  const [schema, setSchema] = useState(() => normalizeSchema(initialSchema));
  const [activeTab, setActiveTab] = useState('columns');
  const [quickColumnInput, setQuickColumnInput] = useState('');
  const [quickRowInput, setQuickRowInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [validation, setValidation] = useState({ isValid: true, errors: [] });

  useEffect(() => {
    const normalizedIncoming = normalizeSchema(initialSchema);
    setSchema((prev) => (schemasEqual(prev, normalizedIncoming) ? prev : normalizedIncoming));
  }, [initialSchema]);

  useEffect(() => {
    const result = validateTableSchema(schema);
    setValidation(result);
    if (result.isValid) {
      onChange?.(schema);
    }
  }, [schema, onChange]);

  const numericColumns = useMemo(
    () => schema.columns.filter((column) => column.type === 'number' || column.type === 'currency'),
    [schema.columns]
  );

  const previewColumns = useMemo(
    () => [
      ...schema.columns,
      ...(schema.calculations?.filter((entry) => entry.displayInTable) || []),
    ],
    [schema.columns, schema.calculations]
  );

  const previewRows = useMemo(() => {
    if (schema.rows.length > 0) return schema.rows;
    return [{ key: 'row_1', label: 'Beispiel 1' }, { key: 'row_2', label: 'Beispiel 2' }];
  }, [schema.rows]);

  function updateSchema(updater) {
    setSchema((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeSchema(next);
    });
  }

  function applyPreset(presetSchema) {
    updateSchema(presetSchema);
    setDescriptionInput('');
    setQuickColumnInput('');
    setQuickRowInput('');
    setActiveTab('columns');
  }

  function handleGenerateFromDescription() {
    if (!descriptionInput.trim()) return;
    const generated = generateSchemaFromDescription(descriptionInput.trim());
    applyPreset(generated);
  }

  function handleApplyQuickColumns() {
    const labels = splitLabels(quickColumnInput);
    if (labels.length === 0) return;

    updateSchema((prev) => ({
      ...prev,
      columns: labels.map((label, index) => ({
        key: sanitizeKey(label, `spalte_${index + 1}`),
        label,
        type: inferTypeByLabel(label),
        required: false,
        editable: true,
      })),
      calculations: [],
    }));
    setQuickColumnInput('');
  }

  function handleApplyQuickRows() {
    const labels = splitLabels(quickRowInput);
    if (labels.length === 0) return;
    updateSchema((prev) => ({
      ...prev,
      rows: labels.map((label, index) => ({
        key: sanitizeKey(label, `zeile_${index + 1}`),
        label,
        required: false,
        editable: true,
        hint: '',
      })),
    }));
    setQuickRowInput('');
  }

  function addColumn() {
    updateSchema((prev) => ({
      ...prev,
      columns: [
        ...prev.columns,
        {
          key: `spalte_${prev.columns.length + 1}`,
          label: `Spalte ${prev.columns.length + 1}`,
          type: 'text',
          required: false,
          editable: true,
        },
      ],
    }));
  }

  function removeColumn(index) {
    updateSchema((prev) => {
      const removed = prev.columns[index];
      const remaining = prev.columns.filter((_, i) => i !== index);
      const calculations = prev.calculations.map((entry) => ({
        ...entry,
        formula: String(entry.formula || '')
          .replace(new RegExp(`\\b${escapeRegex(removed.key)}\\b`, 'g'), '')
          .replace(/\s{2,}/g, ' ')
          .trim(),
      }));
      return {
        ...prev,
        columns: remaining,
        calculations,
      };
    });
  }

  function moveColumn(index, direction) {
    updateSchema((prev) => {
      const target = direction === 'left' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.columns.length) return prev;
      const nextColumns = [...prev.columns];
      [nextColumns[index], nextColumns[target]] = [nextColumns[target], nextColumns[index]];
      return { ...prev, columns: nextColumns };
    });
  }

  function updateColumn(index, updates) {
    updateSchema((prev) => {
      const nextColumns = [...prev.columns];
      const current = nextColumns[index];
      const merged = { ...current, ...updates };

      if (Object.prototype.hasOwnProperty.call(updates, 'label')) {
        const newKey = sanitizeKey(merged.label, `spalte_${index + 1}`);
        if (current.key !== newKey) {
          merged.key = newKey;
          const keyRegex = new RegExp(`\\b${escapeRegex(current.key)}\\b`, 'g');
          const calculations = prev.calculations.map((entry) => ({
            ...entry,
            formula: String(entry.formula || '').replace(keyRegex, newKey),
          }));
          nextColumns[index] = merged;
          return { ...prev, columns: nextColumns, calculations };
        }
      }

      nextColumns[index] = merged;
      return { ...prev, columns: nextColumns };
    });
  }

  function addRowDefinition() {
    updateSchema((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        {
          key: `zeile_${prev.rows.length + 1}`,
          label: `Zeile ${prev.rows.length + 1}`,
          required: false,
          editable: true,
          hint: '',
        },
      ],
    }));
  }

  function removeRowDefinition(index) {
    updateSchema((prev) => ({
      ...prev,
      rows: prev.rows.filter((_, i) => i !== index),
    }));
  }

  function moveRowDefinition(index, direction) {
    updateSchema((prev) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.rows.length) return prev;
      const nextRows = [...prev.rows];
      [nextRows[index], nextRows[target]] = [nextRows[target], nextRows[index]];
      return { ...prev, rows: nextRows };
    });
  }

  function updateRowDefinition(index, updates) {
    updateSchema((prev) => {
      const nextRows = [...prev.rows];
      const current = nextRows[index];
      const merged = { ...current, ...updates };

      if (Object.prototype.hasOwnProperty.call(updates, 'label')) {
        merged.key = sanitizeKey(merged.label, `zeile_${index + 1}`);
      }

      nextRows[index] = merged;
      return { ...prev, rows: nextRows };
    });
  }

  function addCalculation() {
    const left = numericColumns[0]?.key || schema.columns[0]?.key || '';
    const right = numericColumns[1]?.key || '';
    const defaultFormula = left && right ? `${left} * ${right}` : left;

    updateSchema((prev) => ({
      ...prev,
      calculations: [
        ...prev.calculations,
        {
          key: `berechnung_${prev.calculations.length + 1}`,
          label: `Berechnung ${prev.calculations.length + 1}`,
          type: 'number',
          formula: defaultFormula,
          displayInTable: true,
          displayInFooter: true,
        },
      ],
    }));
    setActiveTab('calculations');
  }

  function updateCalculation(index, updates) {
    updateSchema((prev) => {
      const nextCalcs = [...prev.calculations];
      const current = nextCalcs[index];
      const merged = { ...current, ...updates };
      if (Object.prototype.hasOwnProperty.call(updates, 'label')) {
        merged.key = sanitizeKey(merged.label, `berechnung_${index + 1}`);
      }
      nextCalcs[index] = merged;
      return {
        ...prev,
        calculations: nextCalcs,
      };
    });
  }

  function removeCalculation(index) {
    updateSchema((prev) => ({
      ...prev,
      calculations: prev.calculations.filter((_, i) => i !== index),
    }));
  }

  function appendTokenToFormula(calcIndex, token) {
    updateSchema((prev) => {
      const nextCalcs = [...prev.calculations];
      const current = nextCalcs[calcIndex];
      const formula = String(current.formula || '').trim();
      nextCalcs[calcIndex] = {
        ...current,
        formula: formula ? `${formula} ${token}` : token,
      };
      return {
        ...prev,
        calculations: nextCalcs,
      };
    });
  }

  function renderCellPlaceholder(column) {
    if (column.type === 'currency') return '0,00 €';
    if (column.type === 'number') return '0';
    if (column.type === 'date') return 'TT.MM.JJJJ';
    return '...';
  }

  return (
    <div className="space-y-6">
      <div className="bg-dark-card border border-white/[0.08] rounded-2xl p-5 space-y-5">
        <div>
          <p className="text-xs font-semibold text-text-primary">Schnellstart</p>
          <p className="text-[11px] text-text-secondary mt-1">
            Wählen Sie eine Vorlage und passen Sie Spalten und Zeilen an.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {QUICKSTART_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.schema)}
              className="text-left rounded-xl border border-white/[0.08] bg-white/[0.03] hover:border-accent-orange/40 hover:bg-accent-orange/10 px-4 py-3 transition-colors"
            >
              <p className="text-sm font-semibold text-text-primary">{preset.label}</p>
              <p className="text-[11px] text-text-secondary mt-1">{preset.description}</p>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_auto] gap-3">
          <textarea
            value={descriptionInput}
            onChange={(event) => setDescriptionInput(event.target.value)}
            placeholder="Alternativ kurz beschreiben, was extrahiert werden soll (z. B. Aufmaßliste mit Position, Raum, Menge, Einheit, Preis)."
            rows={2}
            className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-orange resize-none"
          />
          <button
            type="button"
            onClick={handleGenerateFromDescription}
            disabled={!descriptionInput.trim()}
            className="px-4 py-2.5 rounded-xl bg-white/[0.06] text-text-primary hover:bg-white/[0.1] disabled:opacity-40 text-sm font-medium"
          >
            Vorschlag erzeugen
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Name der Tabelle</label>
          <input
            type="text"
            value={schema.tableName}
            onChange={(event) => updateSchema((prev) => ({ ...prev, tableName: event.target.value }))}
            placeholder="z. B. Aufmaß Positionen"
            className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-orange"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Beschreibung für die KI</label>
          <textarea
            value={schema.description}
            onChange={(event) => updateSchema((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Beschreiben Sie kurz, welche Werte die KI je Zeile aus dem Transkript extrahieren soll."
            rows={2}
            className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-orange resize-none"
          />
        </div>
      </div>

      <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('columns')}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'columns'
              ? 'bg-accent-orange text-white'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Spalten ({schema.columns.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('rows')}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'rows'
              ? 'bg-accent-orange text-white'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Zeilen ({schema.rows.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('calculations')}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'calculations'
              ? 'bg-accent-orange text-white'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Berechnungen ({schema.calculations.length})
        </button>
      </div>

      {activeTab === 'columns' && (
        <div className="space-y-4">
          <div className="bg-dark-card border border-white/[0.08] rounded-2xl p-4">
            <p className="text-xs font-semibold text-text-primary mb-2">Spalten schnell anlegen</p>
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_auto] gap-2">
              <input
                value={quickColumnInput}
                onChange={(event) => setQuickColumnInput(event.target.value)}
                placeholder="z. B. Pos, Artikel, Menge, Einheit, Einzelpreis"
                className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-orange"
              />
              <button
                type="button"
                onClick={handleApplyQuickColumns}
                disabled={!quickColumnInput.trim()}
                className="px-4 py-2 rounded-lg bg-white/[0.06] text-text-primary hover:bg-white/[0.1] disabled:opacity-40 text-sm font-medium"
              >
                Übernehmen
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
            <table className="w-full min-w-[760px] bg-dark-card">
              <thead>
                <tr className="bg-white/[0.03]">
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Spalte</th>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Typ</th>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Pflicht</th>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Editierbar</th>
                  {showAdvanced && (
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Key</th>
                  )}
                  <th className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-text-secondary">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {schema.columns.map((column, index) => (
                  <tr key={`column-${index}`} className="border-t border-white/[0.05]">
                    <td className="px-3 py-2">
                      <input
                        value={column.label}
                        onChange={(event) => updateColumn(index, { label: event.target.value })}
                        className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={column.type}
                        onChange={(event) => updateColumn(index, { type: event.target.value })}
                        className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none"
                      >
                        {COLUMN_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={column.required}
                          onChange={(event) => updateColumn(index, { required: event.target.checked })}
                          className="accent-accent-orange"
                        />
                        Ja
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={column.editable}
                          onChange={(event) => updateColumn(index, { editable: event.target.checked })}
                          className="accent-accent-orange"
                        />
                        Ja
                      </label>
                    </td>
                    {showAdvanced && (
                      <td className="px-3 py-2">
                        <input
                          value={column.key}
                          onChange={(event) => updateColumn(index, { key: sanitizeKey(event.target.value, `spalte_${index + 1}`) })}
                          className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs font-mono text-text-primary outline-none"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => moveColumn(index, 'left')}
                          disabled={index === 0}
                          className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                          title="Nach links"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveColumn(index, 'right')}
                          disabled={index === schema.columns.length - 1}
                          className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                          title="Nach rechts"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeColumn(index)}
                          className="p-1 rounded text-accent-red hover:bg-accent-red/10"
                          title="Spalte löschen"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addColumn}
              className="px-4 py-2 rounded-xl border border-dashed border-white/[0.2] text-sm text-text-secondary hover:text-text-primary hover:border-accent-orange/50"
            >
              + Spalte hinzufügen
            </button>
            <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={showAdvanced}
                onChange={(event) => setShowAdvanced(event.target.checked)}
                className="accent-accent-orange"
              />
              Expertenansicht (interne Keys)
            </label>
          </div>
        </div>
      )}

      {activeTab === 'rows' && (
        <div className="space-y-4">
          <div className="bg-dark-card border border-white/[0.08] rounded-2xl p-4">
            <p className="text-xs font-semibold text-text-primary mb-2">Zeilen schnell anlegen</p>
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_auto] gap-2">
              <input
                value={quickRowInput}
                onChange={(event) => setQuickRowInput(event.target.value)}
                placeholder="z. B. Summe Netto, Summe MwSt, Summe Brutto"
                className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-orange"
              />
              <button
                type="button"
                onClick={handleApplyQuickRows}
                disabled={!quickRowInput.trim()}
                className="px-4 py-2 rounded-lg bg-white/[0.06] text-text-primary hover:bg-white/[0.1] disabled:opacity-40 text-sm font-medium"
              >
                Übernehmen
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
            <table className="w-full min-w-[780px] bg-dark-card">
              <thead>
                <tr className="bg-white/[0.03]">
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Zeile</th>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Hinweis</th>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Pflicht</th>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Editierbar</th>
                  {showAdvanced && (
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Key</th>
                  )}
                  <th className="px-3 py-2 text-right text-[11px] uppercase tracking-wider text-text-secondary">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {schema.rows.map((row, index) => (
                  <tr key={`row-${index}`} className="border-t border-white/[0.05]">
                    <td className="px-3 py-2">
                      <input
                        value={row.label}
                        onChange={(event) => updateRowDefinition(index, { label: event.target.value })}
                        className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={row.hint}
                        onChange={(event) => updateRowDefinition(index, { hint: event.target.value })}
                        placeholder="Optionaler Hinweis für die KI"
                        className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={row.required}
                          onChange={(event) => updateRowDefinition(index, { required: event.target.checked })}
                          className="accent-accent-orange"
                        />
                        Ja
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={row.editable}
                          onChange={(event) => updateRowDefinition(index, { editable: event.target.checked })}
                          className="accent-accent-orange"
                        />
                        Ja
                      </label>
                    </td>
                    {showAdvanced && (
                      <td className="px-3 py-2">
                        <input
                          value={row.key}
                          onChange={(event) => updateRowDefinition(index, { key: sanitizeKey(event.target.value, `zeile_${index + 1}`) })}
                          className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs font-mono text-text-primary outline-none"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => moveRowDefinition(index, 'up')}
                          disabled={index === 0}
                          className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                          title="Nach oben"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRowDefinition(index, 'down')}
                          disabled={index === schema.rows.length - 1}
                          className="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                          title="Nach unten"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRowDefinition(index)}
                          className="p-1 rounded text-accent-red hover:bg-accent-red/10"
                          title="Zeile löschen"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addRowDefinition}
              className="px-4 py-2 rounded-xl border border-dashed border-white/[0.2] text-sm text-text-secondary hover:text-text-primary hover:border-accent-orange/50"
            >
              + Zeile hinzufügen
            </button>
            {schema.rows.length === 0 && (
              <p className="text-xs text-text-secondary">
                Optional: Definieren Sie feste Zeilentypen, die die KI gezielt befüllen soll.
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'calculations' && (
        <div className="space-y-4">
          <div className="bg-dark-card border border-white/[0.08] rounded-2xl p-4">
            <p className="text-xs text-text-secondary">
              Berechnungen sind optional. Beispiel: <code className="mx-1">menge * einzelpreis</code> oder <code className="mx-1">sum(gesamt)</code>.
            </p>
            <button
              type="button"
              onClick={addCalculation}
              className="mt-3 px-4 py-2 rounded-xl border border-dashed border-white/[0.2] text-sm text-text-secondary hover:text-text-primary hover:border-accent-orange/50"
            >
              + Berechnetes Feld hinzufügen
            </button>
          </div>

          {schema.calculations.map((calc, index) => (
            <div key={calc.key} className="bg-dark-card border border-white/[0.08] rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    value={calc.label}
                    onChange={(event) => updateCalculation(index, { label: event.target.value })}
                    placeholder="Name (z. B. Gesamt)"
                    className="bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                  />
                  <select
                    value={calc.type}
                    onChange={(event) => updateCalculation(index, { type: event.target.value })}
                    className="bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none"
                  >
                    <option value="number">Zahl</option>
                    <option value="currency">Währung</option>
                  </select>
                  <input
                    value={calc.formula}
                    onChange={(event) => updateCalculation(index, { formula: event.target.value })}
                    placeholder="Formel (z. B. menge * einzelpreis)"
                    className="bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm font-mono text-text-primary outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeCalculation(index)}
                  className="p-2 rounded-lg text-accent-red hover:bg-accent-red/10"
                  title="Berechnung löschen"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {schema.columns.map((column) => (
                  <button
                    key={`${calc.key}-${column.key}`}
                    type="button"
                    onClick={() => appendTokenToFormula(index, column.key)}
                    className="px-2 py-1 rounded-full text-[11px] border border-white/[0.12] text-text-secondary hover:text-text-primary hover:border-accent-orange/40"
                  >
                    {column.key}
                  </button>
                ))}
                {['+', '-', '*', '/', '(', ')', 'sum(', ')'].map((token, tokenIndex) => (
                  <button
                    key={`${calc.key}-op-${token}-${tokenIndex}`}
                    type="button"
                    onClick={() => appendTokenToFormula(index, token)}
                    className="px-2 py-1 rounded-full text-[11px] border border-white/[0.12] text-text-secondary hover:text-text-primary hover:border-accent-orange/40"
                  >
                    {token}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={calc.displayInTable}
                    onChange={(event) => updateCalculation(index, { displayInTable: event.target.checked })}
                    className="accent-accent-orange"
                  />
                  In Tabelle anzeigen
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={calc.displayInFooter}
                    onChange={(event) => updateCalculation(index, { displayInFooter: event.target.checked })}
                    className="accent-accent-orange"
                  />
                  In Fußzeile zeigen
                </label>
              </div>
            </div>
          ))}

          {schema.calculations.length === 0 && (
            <div className="text-xs text-text-secondary bg-dark-card border border-white/[0.08] rounded-xl p-4">
              Noch keine Berechnungen angelegt.
            </div>
          )}
        </div>
      )}

      <div className="bg-dark-card border border-white/[0.08] rounded-2xl p-4">
        <p className="text-xs font-semibold text-text-primary mb-3">Vorschau</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="bg-white/[0.04]">
                {schema.rows.length > 0 && (
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">Zeile</th>
                )}
                {previewColumns.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-text-secondary">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => (
                <tr key={row.key || rowIndex} className="border-t border-white/[0.05]">
                  {schema.rows.length > 0 && (
                    <td className="px-3 py-2 text-text-secondary font-medium">{row.label}</td>
                  )}
                  {previewColumns.map((column) => (
                    <td key={`${rowIndex}-${column.key}`} className="px-3 py-2 text-text-secondary">
                      {renderCellPlaceholder(column)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!validation.isValid && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4">
          <p className="text-accent-red text-sm font-medium mb-2">Bitte korrigieren Sie die folgenden Punkte:</p>
          <ul className="text-accent-red/80 text-xs space-y-1">
            {validation.errors.map((error, index) => (
              <li key={index}>• {error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
