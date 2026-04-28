import { useEffect, useMemo, useState } from 'react';
import { validateTableSchema } from '../lib/table-calculations';
import { generateSchemaFromDescription } from '../lib/table-template-generator';
import {
  TABLE_FIELD_TYPES,
  createDefaultTableSchema,
  inferTableFieldType,
  normalizeTableSchema,
  sanitizeTableKey,
  splitTableLabels,
} from '../lib/table-schema';

const QUICKSTART_PRESETS = [
  {
    id: 'invoice',
    label: 'Rechnung',
    description: 'Positionen mit Datum und Person',
    schema: {
      tableName: 'Rechnungspositionen',
      description: 'Extrahiert diktierte Rechnungs- oder Bestellpositionen.',
      metadata: [
        { key: 'datum', label: 'Datum', type: 'date', required: false, editable: true, hint: '' },
        { key: 'ausgefuellt_von', label: 'Ausgefüllt von', type: 'text', required: false, editable: true, hint: '' },
      ],
      columns: [
        { key: 'pos', label: 'Pos.', type: 'number', required: false, editable: true },
        { key: 'artikel', label: 'Artikel / Leistung', type: 'text', required: true, editable: true },
        { key: 'menge', label: 'Menge', type: 'number', required: false, editable: true },
        { key: 'einheit', label: 'Einheit', type: 'text', required: false, editable: true },
        { key: 'einzelpreis', label: 'Einzelpreis', type: 'currency', required: false, editable: true },
      ],
      rows: [],
      calculations: [],
    },
  },
  {
    id: 'fixed',
    label: 'Festes Formular',
    description: 'Zeilentitel und Spalten vorgeben',
    schema: {
      tableName: 'Erfassungsbogen',
      description: 'Füllt feste Zeilen und Spalten mit diktierten Werten.',
      metadata: [
        { key: 'datum', label: 'Datum', type: 'date', required: false, editable: true, hint: '' },
        { key: 'person', label: 'Person', type: 'text', required: false, editable: true, hint: '' },
      ],
      columns: [
        { key: 'wert', label: 'Wert', type: 'text', required: false, editable: true },
        { key: 'bemerkung', label: 'Bemerkung', type: 'text', required: false, editable: true },
      ],
      rows: [
        { key: 'position_1', label: 'Position 1', required: false, editable: true, hint: '' },
        { key: 'position_2', label: 'Position 2', required: false, editable: true, hint: '' },
        { key: 'position_3', label: 'Position 3', required: false, editable: true, hint: '' },
      ],
      calculations: [],
    },
  },
  {
    id: 'actions',
    label: 'Aktionsliste',
    description: 'Aufgaben aus Protokollen',
    schema: {
      tableName: 'Aktionsliste',
      description: 'Extrahiert Aufgaben, Verantwortliche und Termine aus Transkripten.',
      metadata: [
        { key: 'datum', label: 'Datum', type: 'date', required: false, editable: true, hint: '' },
        { key: 'protokollant', label: 'Protokollant', type: 'text', required: false, editable: true, hint: '' },
      ],
      columns: [
        { key: 'thema', label: 'Thema', type: 'text', required: true, editable: true },
        { key: 'aufgabe', label: 'Aufgabe', type: 'text', required: true, editable: true },
        { key: 'verantwortlich', label: 'Verantwortlich', type: 'text', required: false, editable: true },
        { key: 'faellig', label: 'Fällig am', type: 'date', required: false, editable: true },
        { key: 'status', label: 'Status', type: 'text', required: false, editable: true },
      ],
      rows: [],
      calculations: [],
    },
  },
];

function schemasEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function createField(prefix, index, label) {
  const cleanLabel = String(label || '').trim();
  const fallbackLabel = prefix === 'meta' ? `Metadatum ${index + 1}` : prefix === 'zeile' ? `Zeile ${index + 1}` : `Spalte ${index + 1}`;
  const nextLabel = cleanLabel || fallbackLabel;
  return {
    key: sanitizeTableKey(nextLabel, `${prefix}_${index + 1}`),
    label: nextLabel,
    type: prefix === 'zeile' ? undefined : inferTableFieldType(nextLabel),
    required: false,
    editable: true,
    hint: '',
  };
}

function FieldTypeSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full bg-dark-input border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent-orange"
    >
      {TABLE_FIELD_TYPES.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export default function TableSchemaBuilder({ schema: initialSchema, onChange }) {
  const [schema, setSchema] = useState(() => normalizeTableSchema(initialSchema || createDefaultTableSchema()));
  const [quickColumnInput, setQuickColumnInput] = useState('');
  const [quickRowInput, setQuickRowInput] = useState('');
  const [quickMetadataInput, setQuickMetadataInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [validation, setValidation] = useState({ isValid: true, errors: [] });

  useEffect(() => {
    const normalizedIncoming = normalizeTableSchema(initialSchema || createDefaultTableSchema());
    setSchema((prev) => (schemasEqual(prev, normalizedIncoming) ? prev : normalizedIncoming));
  }, [initialSchema]);

  useEffect(() => {
    const result = validateTableSchema(schema);
    setValidation(result);
    if (result.isValid) {
      onChange?.(schema);
    }
  }, [schema, onChange]);

  const previewRows = useMemo(() => {
    if (schema.rows.length > 0) return schema.rows;
    return [
      { key: 'beispiel_1', label: 'Neue Zeile 1' },
      { key: 'beispiel_2', label: 'Neue Zeile 2' },
    ];
  }, [schema.rows]);

  function updateSchema(updater) {
    setSchema((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeTableSchema(next);
    });
  }

  function applyPreset(presetSchema) {
    updateSchema(presetSchema);
    setDescriptionInput('');
    setQuickColumnInput('');
    setQuickRowInput('');
    setQuickMetadataInput('');
  }

  function handleGenerateFromDescription() {
    if (!descriptionInput.trim()) return;
    applyPreset(generateSchemaFromDescription(descriptionInput.trim()));
  }

  function applyQuickFields(kind, rawValue) {
    const labels = splitTableLabels(rawValue);
    if (labels.length === 0) return;

    updateSchema((prev) => ({
      ...prev,
      [kind]: labels.map((label, index) => {
        if (kind === 'metadata') return createField('meta', index, label);
        if (kind === 'rows') {
          const field = createField('zeile', index, label);
          return {
            key: field.key,
            label: field.label,
            required: false,
            editable: true,
            hint: '',
          };
        }
        const field = createField('spalte', index, label);
        return {
          key: field.key,
          label: field.label,
          type: field.type,
          required: false,
          editable: true,
        };
      }),
      calculations: [],
    }));
  }

  function addMetadataField() {
    updateSchema((prev) => ({
      ...prev,
      metadata: [
        ...prev.metadata,
        createField('meta', prev.metadata.length, `Metadatum ${prev.metadata.length + 1}`),
      ],
    }));
  }

  function updateMetadataField(index, updates) {
    updateSchema((prev) => {
      const metadata = [...prev.metadata];
      const merged = { ...metadata[index], ...updates };
      if (Object.prototype.hasOwnProperty.call(updates, 'label')) {
        merged.key = sanitizeTableKey(merged.label, `meta_${index + 1}`);
      }
      metadata[index] = merged;
      return { ...prev, metadata };
    });
  }

  function removeMetadataField(index) {
    updateSchema((prev) => ({
      ...prev,
      metadata: prev.metadata.filter((_, entryIndex) => entryIndex !== index),
    }));
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

  function updateColumn(index, updates) {
    updateSchema((prev) => {
      const columns = [...prev.columns];
      const merged = { ...columns[index], ...updates };
      if (Object.prototype.hasOwnProperty.call(updates, 'label')) {
        merged.key = sanitizeTableKey(merged.label, `spalte_${index + 1}`);
      }
      columns[index] = merged;
      return { ...prev, columns };
    });
  }

  function removeColumn(index) {
    updateSchema((prev) => ({
      ...prev,
      columns: prev.columns.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function moveColumn(index, direction) {
    updateSchema((prev) => {
      const target = direction === 'left' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.columns.length) return prev;
      const columns = [...prev.columns];
      [columns[index], columns[target]] = [columns[target], columns[index]];
      return { ...prev, columns };
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

  function updateRowDefinition(index, updates) {
    updateSchema((prev) => {
      const rows = [...prev.rows];
      const merged = { ...rows[index], ...updates };
      if (Object.prototype.hasOwnProperty.call(updates, 'label')) {
        merged.key = sanitizeTableKey(merged.label, `zeile_${index + 1}`);
      }
      rows[index] = merged;
      return { ...prev, rows };
    });
  }

  function removeRowDefinition(index) {
    updateSchema((prev) => ({
      ...prev,
      rows: prev.rows.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function moveRowDefinition(index, direction) {
    updateSchema((prev) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.rows.length) return prev;
      const rows = [...prev.rows];
      [rows[index], rows[target]] = [rows[target], rows[index]];
      return { ...prev, rows };
    });
  }

  function renderPlaceholder(column) {
    if (column.type === 'currency') return '0,00 €';
    if (column.type === 'number') return '0';
    if (column.type === 'date') return 'TT.MM.JJJJ';
    return 'Inhalt';
  }

  return (
    <div className="space-y-6">
      <section className="bg-dark-card border border-white/[0.08] rounded-2xl p-5 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-text-primary">Schnellstart</p>
            <p className="text-[11px] text-text-secondary mt-1">Vorlage wählen oder aus einer kurzen Beschreibung erzeugen.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(event) => setShowAdvanced(event.target.checked)}
              className="accent-accent-orange"
            />
            Keys anzeigen
          </label>
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
            placeholder="z. B. Tabelle mit Datum, ausgefüllt von, drei Prüfpunkten als Zeilen und Spalten für Wert und Bemerkung"
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
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[1.2fr_1.8fr] gap-4">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Name der Tabelle</label>
            <input
              type="text"
              value={schema.tableName}
              onChange={(event) => updateSchema((prev) => ({ ...prev, tableName: event.target.value }))}
              placeholder="z. B. Tagesbericht"
              className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-orange"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Extraktionshinweis</label>
            <textarea
              value={schema.description}
              onChange={(event) => updateSchema((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Was soll aus dem Transkript in diese Tabelle eingetragen werden?"
              rows={4}
              className="w-full bg-dark-input border border-white/[0.1] rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent-orange resize-none"
            />
          </div>
        </div>

        <div className="bg-dark-card border border-white/[0.08] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-text-primary">Metadaten oberhalb der Tabelle</p>
            <button
              type="button"
              onClick={addMetadataField}
              className="px-3 py-1.5 rounded-lg border border-dashed border-white/[0.2] text-xs text-text-secondary hover:text-text-primary hover:border-accent-orange/50"
            >
              + Feld
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_auto] gap-2">
            <input
              value={quickMetadataInput}
              onChange={(event) => setQuickMetadataInput(event.target.value)}
              placeholder="z. B. Datum, Ausgefüllt von, Projekt"
              className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-orange"
            />
            <button
              type="button"
              onClick={() => {
                applyQuickFields('metadata', quickMetadataInput);
                setQuickMetadataInput('');
              }}
              disabled={!quickMetadataInput.trim()}
              className="px-4 py-2 rounded-lg bg-white/[0.06] text-text-primary hover:bg-white/[0.1] disabled:opacity-40 text-sm font-medium"
            >
              Übernehmen
            </button>
          </div>

          <div className="space-y-2">
            {schema.metadata.map((field, index) => (
              <div key={`metadata-${index}`} className="grid grid-cols-1 md:grid-cols-[1.4fr_120px_90px_auto] gap-2 items-center">
                <input
                  value={field.label}
                  onChange={(event) => updateMetadataField(index, { label: event.target.value })}
                  className="bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-orange"
                  placeholder="Feldname"
                />
                <FieldTypeSelect value={field.type} onChange={(value) => updateMetadataField(index, { type: value })} />
                <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => updateMetadataField(index, { required: event.target.checked })}
                    className="accent-accent-orange"
                  />
                  Pflicht
                </label>
                <button
                  type="button"
                  onClick={() => removeMetadataField(index)}
                  className="px-2 py-2 rounded-lg text-accent-red hover:bg-accent-red/10 text-xs"
                >
                  Löschen
                </button>
                {showAdvanced && (
                  <input
                    value={field.key}
                    onChange={(event) => updateMetadataField(index, { key: sanitizeTableKey(event.target.value, `meta_${index + 1}`) })}
                    className="md:col-span-4 bg-dark-input border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs font-mono text-text-secondary outline-none focus:border-accent-orange"
                  />
                )}
              </div>
            ))}
            {schema.metadata.length === 0 && (
              <p className="text-xs text-text-secondary bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-3">
                Keine Metadatenfelder angelegt.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="bg-dark-card border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="border-b border-white/[0.08] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-text-primary">Tabellenraster</p>
              <p className="text-[11px] text-text-secondary mt-1">Spaltentitel oben, Zeilentitel links. Die Zellen werden später nur mit diktiertem Inhalt gefüllt.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addRowDefinition}
                className="px-3 py-1.5 rounded-lg border border-dashed border-white/[0.2] text-xs text-text-secondary hover:text-text-primary hover:border-accent-orange/50"
              >
                + Zeile
              </button>
              <button
                type="button"
                onClick={addColumn}
                className="px-3 py-1.5 rounded-lg border border-dashed border-white/[0.2] text-xs text-text-secondary hover:text-text-primary hover:border-accent-orange/50"
              >
                + Spalte
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={quickRowInput}
                onChange={(event) => setQuickRowInput(event.target.value)}
                placeholder="Zeilen: Raum 1, Raum 2, Raum 3"
                className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-orange"
              />
              <button
                type="button"
                onClick={() => {
                  applyQuickFields('rows', quickRowInput);
                  setQuickRowInput('');
                }}
                disabled={!quickRowInput.trim()}
                className="px-3 py-2 rounded-lg bg-white/[0.06] text-text-primary hover:bg-white/[0.1] disabled:opacity-40 text-xs font-medium"
              >
                Zeilen setzen
              </button>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={quickColumnInput}
                onChange={(event) => setQuickColumnInput(event.target.value)}
                placeholder="Spalten: Wert, Einheit, Bemerkung"
                className="w-full bg-dark-input border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-orange"
              />
              <button
                type="button"
                onClick={() => {
                  applyQuickFields('columns', quickColumnInput);
                  setQuickColumnInput('');
                }}
                disabled={!quickColumnInput.trim()}
                className="px-3 py-2 rounded-lg bg-white/[0.06] text-text-primary hover:bg-white/[0.1] disabled:opacity-40 text-xs font-medium"
              >
                Spalten setzen
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-white/[0.04]">
                <th className="sticky left-0 z-10 bg-[#1b1b25] w-56 px-3 py-3 text-left text-[11px] uppercase tracking-wider text-text-secondary border-r border-white/[0.08]">
                  Zeilentitel
                </th>
                {schema.columns.map((column, index) => (
                  <th key={`column-${index}`} className="min-w-[170px] px-2 py-2 border-r border-white/[0.05] align-top">
                    <div className="space-y-2">
                      <input
                        value={column.label}
                        onChange={(event) => updateColumn(index, { label: event.target.value })}
                        className="w-full bg-dark-input border border-white/[0.1] rounded-md px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-orange"
                        placeholder={`Spalte ${index + 1}`}
                      />
                      <div className="grid grid-cols-[1fr_auto_auto] gap-1 items-center">
                        <FieldTypeSelect value={column.type} onChange={(value) => updateColumn(index, { type: value })} />
                        <button
                          type="button"
                          onClick={() => moveColumn(index, 'left')}
                          disabled={index === 0}
                          className="px-2 py-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                          title="Nach links"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => moveColumn(index, 'right')}
                          disabled={index === schema.columns.length - 1}
                          className="px-2 py-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                          title="Nach rechts"
                        >
                          →
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
                          <input
                            type="checkbox"
                            checked={column.required}
                            onChange={(event) => updateColumn(index, { required: event.target.checked })}
                            className="accent-accent-orange"
                          />
                          Pflicht
                        </label>
                        <button
                          type="button"
                          onClick={() => removeColumn(index)}
                          disabled={schema.columns.length <= 1}
                          className="text-[11px] text-accent-red hover:text-red-300 disabled:opacity-30"
                        >
                          Löschen
                        </button>
                      </div>
                      {showAdvanced && (
                        <input
                          value={column.key}
                          onChange={(event) => updateColumn(index, { key: sanitizeTableKey(event.target.value, `spalte_${index + 1}`) })}
                          className="w-full bg-dark-input border border-white/[0.1] rounded-md px-2 py-1 text-[11px] font-mono text-text-secondary outline-none focus:border-accent-orange"
                        />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => {
                const isRealRow = rowIndex < schema.rows.length;
                return (
                  <tr key={`row-${row.key || rowIndex}`} className="border-t border-white/[0.05]">
                    <th className="sticky left-0 z-10 bg-[#171720] w-56 px-2 py-2 border-r border-white/[0.08] align-top">
                      {isRealRow ? (
                        <div className="space-y-2">
                          <input
                            value={row.label}
                            onChange={(event) => updateRowDefinition(rowIndex, { label: event.target.value })}
                            className="w-full bg-dark-input border border-white/[0.1] rounded-md px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-orange"
                          />
                          <div className="grid grid-cols-[auto_auto_1fr_auto] gap-1 items-center">
                            <button
                              type="button"
                              onClick={() => moveRowDefinition(rowIndex, 'up')}
                              disabled={rowIndex === 0}
                              className="px-2 py-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                              title="Nach oben"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveRowDefinition(rowIndex, 'down')}
                              disabled={rowIndex === schema.rows.length - 1}
                              className="px-2 py-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-25"
                              title="Nach unten"
                            >
                              ↓
                            </button>
                            <label className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary justify-self-start">
                              <input
                                type="checkbox"
                                checked={row.required}
                                onChange={(event) => updateRowDefinition(rowIndex, { required: event.target.checked })}
                                className="accent-accent-orange"
                              />
                              Pflicht
                            </label>
                            <button
                              type="button"
                              onClick={() => removeRowDefinition(rowIndex)}
                              className="text-[11px] text-accent-red hover:text-red-300"
                            >
                              Löschen
                            </button>
                          </div>
                          <input
                            value={row.hint || ''}
                            onChange={(event) => updateRowDefinition(rowIndex, { hint: event.target.value })}
                            placeholder="Hinweis für diese Zeile"
                            className="w-full bg-dark-input border border-white/[0.1] rounded-md px-2 py-1 text-[11px] text-text-secondary outline-none focus:border-accent-orange"
                          />
                          {showAdvanced && (
                            <input
                              value={row.key}
                              onChange={(event) => updateRowDefinition(rowIndex, { key: sanitizeTableKey(event.target.value, `zeile_${rowIndex + 1}`) })}
                              className="w-full bg-dark-input border border-white/[0.1] rounded-md px-2 py-1 text-[11px] font-mono text-text-secondary outline-none focus:border-accent-orange"
                            />
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-text-secondary">{row.label}</span>
                      )}
                    </th>
                    {schema.columns.map((column) => (
                      <td key={`${row.key}-${column.key}`} className="px-3 py-4 border-r border-white/[0.04] text-text-secondary/50">
                        {renderPlaceholder(column)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {!validation.isValid && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4">
          <p className="text-accent-red text-sm font-medium mb-2">Bitte korrigieren Sie die folgenden Punkte:</p>
          <ul className="text-accent-red/80 text-xs space-y-1">
            {validation.errors.map((entry, index) => (
              <li key={`${entry}-${index}`}>• {entry}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
