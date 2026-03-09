import { useState, useMemo, useCallback } from 'react';
import { applyCalculations, calculateFooterStats } from '../lib/table-calculations';
import { exportTableToCSV, exportTableToExcel, exportTableToHTML } from '../lib/table-export';

export default function TableRenderer({ 
  initialData, 
  schema, 
  onChange,
  filename = 'export'
}) {
  const [editMode, setEditMode] = useState(false);
  const [rows, setRows] = useState(initialData?.rows || []);
  const [copyFeedback, setCopyFeedback] = useState(false);
  
  // Berechne automatische Felder
  const computedRows = useMemo(() => {
    return rows.map(row => applyCalculations(row, schema.calculations || []));
  }, [rows, schema.calculations]);
  
  // Footer-Statistiken
  const footerStats = useMemo(() => {
    return calculateFooterStats(computedRows, schema.columns, schema.calculations || []);
  }, [computedRows, schema.columns, schema.calculations]);
  
  const allColumns = [
    ...schema.columns,
    ...(schema.calculations?.filter(c => c.displayInTable) || [])
  ];

  const buildMissingMap = useCallback((rowsValue) => {
    const requiredColumns = schema.columns.filter((col) => col.required);
    const map = new Map();
    rowsValue.forEach((row, rowIndex) => {
      const missing = requiredColumns
        .filter((col) => row?.[col.key] === null || row?.[col.key] === undefined || row?.[col.key] === '')
        .map((col) => col.key);
      if (missing.length > 0) {
        map.set(rowIndex, missing);
      }
    });
    return map;
  }, [schema.columns]);

  const missingFieldsByRow = useMemo(() => {
    const map = buildMissingMap(rows);

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
  }, [rows, initialData?.missing_fields_by_row, buildMissingMap]);
  
  const updateCell = (rowIndex, columnKey, value) => {
    const newRows = [...rows];
    newRows[rowIndex] = {
      ...newRows[rowIndex],
      [columnKey]: value
    };
    setRows(newRows);
    const missing = Array.from(buildMissingMap(newRows).entries()).map(([missingRowIndex, fields]) => ({ rowIndex: missingRowIndex, fields }));
    onChange?.({ rows: newRows, footerStats, missing_fields_by_row: missing });
  };
  
  const addRow = () => {
    const newRow = {};
    schema.columns.forEach(col => {
      newRow[col.key] = col.type === 'number' || col.type === 'currency' ? 0 : '';
    });
    setRows([...rows, newRow]);
  };
  
  const removeRow = (index) => {
    setRows(rows.filter((_, i) => i !== index));
  };
  
  const handleExport = async (format) => {
    const exportData = {
      rows: computedRows,
      footerStats
    };
    
    switch (format) {
      case 'csv':
        exportTableToCSV(exportData, schema, filename);
        break;
      case 'excel':
        await exportTableToExcel(exportData, schema, filename);
        break;
      case 'copy':
        const html = exportTableToHTML(exportData, schema);
        try {
          await navigator.clipboard.writeText(html);
          setCopyFeedback(true);
          setTimeout(() => setCopyFeedback(false), 2000);
        } catch (err) {
          console.error('Kopieren fehlgeschlagen:', err);
        }
        break;
    }
  };
  
  const formatValue = (value, type) => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-text-secondary/30">-</span>;
    }
    
    switch (type) {
      case 'currency':
        return (
          <span className="font-mono">
            {Number(value).toFixed(2).replace('.', ',')} €
          </span>
        );
      case 'date':
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = value.split('-');
          return <span>{`${day}.${month}.${year}`}</span>;
        }
        try {
          return <span>{new Date(value).toLocaleDateString('de-DE')}</span>;
        } catch {
          return <span>{value}</span>;
        }
      case 'number':
        return <span className="font-mono">{Number(value).toLocaleString('de-DE')}</span>;
      default:
        return <span>{value}</span>;
    }
  };
  
  const CellEditor = ({ type, value, onChange }) => {
    const inputType = type === 'date' ? 'date' : type === 'number' || type === 'currency' ? 'number' : 'text';
    
    return (
      <input
        type={inputType}
        value={value || ''}
        onChange={(e) => {
          let newValue = e.target.value;
          if (type === 'number' || type === 'currency') {
            newValue = e.target.value === '' ? '' : parseFloat(e.target.value);
          }
          onChange(newValue);
        }}
        className="w-full bg-dark-input border border-accent-orange/50 rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent-orange"
        step={type === 'currency' ? '0.01' : type === 'number' ? '1' : undefined}
      />
    );
  };
  
  return (
    <div className="bg-dark-card rounded-2xl overflow-hidden border border-white/[0.06]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-text-primary">{schema.tableName}</h3>
          <span className="text-sm text-text-secondary">
            {computedRows.length} Zeilen
          </span>
          {missingFieldsByRow.size > 0 && (
            <span className="text-[11px] px-2 py-1 rounded-full border border-accent-red/40 text-accent-red bg-accent-red/10">
              {missingFieldsByRow.size} Zeilen unvollständig
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Edit-Modus Toggle */}
          <button
            onClick={() => setEditMode(!editMode)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              editMode 
                ? 'bg-accent-orange text-white' 
                : 'bg-white/5 text-text-secondary hover:text-text-primary'
            }`}
          >
            {editMode ? 'Fertig' : 'Bearbeiten'}
          </button>
          
          {editMode && (
            <button
              onClick={addRow}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-green/20 text-accent-green hover:bg-accent-green/30 transition-all"
            >
              + Zeile
            </button>
          )}
          
          <div className="w-px h-4 bg-white/10 mx-1" />
          
          {/* Export-Buttons */}
          <button
            onClick={() => handleExport('csv')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-text-secondary hover:text-text-primary transition-all"
            title="CSV exportieren"
          >
            CSV
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-text-secondary hover:text-text-primary transition-all"
            title="Excel exportieren"
          >
            Excel
          </button>
          <button
            onClick={() => handleExport('copy')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              copyFeedback 
                ? 'bg-accent-green/20 text-accent-green' 
                : 'bg-white/5 text-text-secondary hover:text-text-primary'
            }`}
            title="Als Tabelle kopieren"
          >
            {copyFeedback ? 'Kopiert!' : 'Kopieren'}
          </button>
        </div>
      </div>
      
      {/* Tabelle */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-white/5">
            <tr>
              {editMode && <th className="w-10 px-2 py-2" />}
              {allColumns.map(col => (
                <th 
                  key={col.key} 
                  className={`px-3 py-2 text-left text-xs font-bold text-text-secondary uppercase tracking-wider whitespace-nowrap ${
                    col.type === 'currency' || col.type === 'number' ? 'text-right' : ''
                  }`}
                >
                  {col.label}
                  {col.required && <span className="text-accent-red ml-1">*</span>}
                  {schema.calculations?.some(c => c.key === col.key) && (
                    <span className="text-accent-orange ml-1 text-[10px]">(auto)</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          
          <tbody className="divide-y divide-white/[0.04]">
            {computedRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={`hover:bg-white/[0.02] ${missingFieldsByRow.has(rowIndex) ? 'bg-accent-red/5' : ''}`}
              >
                {editMode && (
                  <td className="px-2 py-2">
                    <button
                      onClick={() => removeRow(rowIndex)}
                      className="p-1 text-accent-red/50 hover:text-accent-red transition-colors"
                      aria-label={`Zeile ${rowIndex + 1} entfernen`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                )}
                
                {allColumns.map(col => {
                  const isCalculated = schema.calculations?.some(c => c.key === col.key);
                  const isEditable = editMode && !isCalculated && schema.columns.find(c => c.key === col.key)?.editable !== false;
                  const isMissing = missingFieldsByRow.get(rowIndex)?.includes(col.key);
                  
                  return (
                    <td 
                      key={col.key} 
                      className={`px-3 py-2 text-sm ${
                        col.type === 'currency' || col.type === 'number' ? 'text-right' : 'text-left'
                      } ${isCalculated ? 'text-accent-orange' : 'text-text-primary'} ${isMissing ? 'ring-1 ring-inset ring-accent-red/40 rounded-sm' : ''}`}
                    >
                      {isEditable ? (
                        <CellEditor
                          type={col.type}
                          value={rows[rowIndex][col.key]}
                          onChange={(value) => updateCell(rowIndex, col.key, value)}
                        />
                      ) : (
                        formatValue(row[col.key], col.type)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            
            {computedRows.length === 0 && (
              <tr>
                <td 
                  colSpan={allColumns.length + (editMode ? 1 : 0)} 
                  className="px-4 py-8 text-center text-text-secondary"
                >
                  Keine Daten vorhanden
                </td>
              </tr>
            )}
          </tbody>
          
          {/* Fußzeile mit Summen */}
          {Object.keys(footerStats).length > 0 && (
            <tfoot className="bg-white/5 border-t-2 border-white/10 font-semibold">
              <tr>
                {editMode && <td className="px-2 py-2" />}
                {allColumns.map((col, index) => (
                  <td 
                    key={col.key} 
                    className={`px-3 py-2 text-sm ${
                      col.type === 'currency' || col.type === 'number' ? 'text-right' : ''
                    } ${footerStats[col.key] !== undefined ? 'text-accent-orange' : 'text-text-secondary'}`}
                  >
                    {footerStats[col.key] !== undefined ? (
                      formatValue(footerStats[col.key], col.type)
                    ) : (
                      index === 0 ? 'Summe:' : ''
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      
      {/* Hinweis */}
      <div className="px-4 py-2 bg-white/[0.02] border-t border-white/[0.06]">
        {missingFieldsByRow.size > 0 && (
          <div className="mb-2 text-[10px] text-accent-red/90">
            Fehlende Pflichtfelder:
            {' '}
            {Array.from(missingFieldsByRow.entries())
              .slice(0, 4)
              .map(([rowIndex, fields]) => `Zeile ${rowIndex + 1} (${fields.join(', ')})`)
              .join(' | ')}
            {missingFieldsByRow.size > 4 ? ' ...' : ''}
          </div>
        )}
        <p className="text-[10px] text-text-secondary/60">
          {schema.calculations?.some(c => c.displayInTable) && (
            <span className="text-accent-orange">Orange markierte Spalten</span>
          )}
          {schema.calculations?.some(c => c.displayInTable) && schema.calculations?.some(c => c.displayInFooter) && ' und '}
          {schema.calculations?.some(c => c.displayInFooter) && (
            <span className="text-accent-orange">Summen in der Fußzeile</span>
          )}
          {(schema.calculations?.some(c => c.displayInTable) || schema.calculations?.some(c => c.displayInFooter)) && ' werden automatisch berechnet.'}
        </p>
      </div>
    </div>
  );
}
