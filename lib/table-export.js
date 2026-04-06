import { saveAs } from 'file-saver';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function protectSpreadsheetValue(value) {
  const asString = String(value ?? '');
  if (!asString) return asString;
  if (/^[\s]*[=+\-@]/.test(asString)) {
    return `'${asString}`;
  }
  return asString;
}

/**
 * Exportiert Tabelle als CSV
 */
export function exportTableToCSV(tableData, schema, filename) {
  const { rows } = tableData;
  const allColumns = [
    ...schema.columns,
    ...(schema.calculations?.filter(c => c.displayInTable) || [])
  ];
  
  // Header
  const headers = allColumns.map(col => col.label).join(';');
  
  // Datenzeilen
  const dataRows = rows.map(row => {
    return allColumns.map(col => {
      let value = row[col.key];
      
      // Formatierung je nach Typ
      if (col.type === 'currency') {
        value = value ? Number(value).toFixed(2).replace('.', ',') : '';
      } else if (col.type === 'date' && value) {
        value = new Date(value).toLocaleDateString('de-DE');
      }
      
      // Escape Semikolons in Werten
      const strValue = protectSpreadsheetValue(value);
      if (strValue.includes(';') || strValue.includes('\n') || strValue.includes('"')) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    }).join(';');
  });
  
  // Fußzeile mit Summen (falls vorhanden)
  let footerRow = '';
  if (tableData.footerStats) {
    footerRow = '\n' + allColumns.map(col => {
      if (tableData.footerStats[col.key] !== undefined) {
        let value = tableData.footerStats[col.key];
        if (col.type === 'currency') {
          value = Number(value).toFixed(2).replace('.', ',');
        }
        return protectSpreadsheetValue(value);
      }
      return '';
    }).join(';');
  }
  
  const csv = '\uFEFF' + headers + '\n' + dataRows.join('\n') + footerRow;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `${filename}.csv`);
}

/**
 * Exportiert Tabelle als Excel-Datei (XLSX)
 * Hinweis: Benötigt 'exceljs' Bibliothek
 */
export async function exportTableToExcel(tableData, schema, filename) {
  try {
    const ExcelJS = await import('exceljs');

    const { rows, footerStats } = tableData;
    const allColumns = [
      ...schema.columns,
      ...(schema.calculations?.filter(c => c.displayInTable) || [])
    ];

    // Erstelle Workbook und Worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Daten');

    // Spalten definieren mit Header und Breite
    worksheet.columns = allColumns.map(col => ({
      header: col.label,
      width: Math.max(col.label.length + 2, 12)
    }));

    // Datenzeilen hinzufügen
    rows.forEach(row => {
      const rowData = allColumns.map(col => {
        const value = row[col.key];
        if (value === null || value === undefined) return '';

        if (col.type === 'date' && value) {
          return new Date(value);
        }

        if (col.type === 'currency' || col.type === 'number') {
          return Number(value) || 0;
        }

        return protectSpreadsheetValue(value);
      });
      worksheet.addRow(rowData);
    });

    // Fußzeile hinzufügen
    if (footerStats) {
      const footerData = allColumns.map(col => {
        if (footerStats[col.key] !== undefined) {
          const rawValue = footerStats[col.key];
          if (typeof rawValue === 'string') {
            return protectSpreadsheetValue(rawValue);
          }
          return rawValue;
        }
        return '';
      });
      worksheet.addRow(footerData);
    }

    // Schreibe Datei
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    saveAs(blob, `${filename}.xlsx`);

  } catch (error) {
    console.error('Excel-Export-Fehler:', error);
    // Fallback auf CSV
    exportTableToCSV(tableData, schema, filename);
  }
}

/**
 * Konvertiert Tabellendaten zu HTML (für Kopieren/Einfügen)
 */
export function exportTableToHTML(tableData, schema) {
  const { rows, footerStats } = tableData;
  const allColumns = [
    ...schema.columns,
    ...(schema.calculations?.filter(c => c.displayInTable) || [])
  ];
  
  const formatValue = (value, type) => {
    if (value === null || value === undefined) return '';
    if (type === 'currency') return `${Number(value).toFixed(2)} €`;
    if (type === 'date' && value) return new Date(value).toLocaleDateString('de-DE');
    return protectSpreadsheetValue(value);
  };
  
  let html = '<table border="1" cellpadding="5" cellspacing="0">\n';
  
  // Header
  html += '  <thead>\n    <tr>\n';
  allColumns.forEach(col => {
    html += `      <th><b>${escapeHtml(col.label)}</b></th>\n`;
  });
  html += '    </tr>\n  </thead>\n';
  
  // Body
  html += '  <tbody>\n';
  rows.forEach(row => {
    html += '    <tr>\n';
    allColumns.forEach(col => {
      const value = formatValue(row[col.key], col.type);
      html += `      <td>${escapeHtml(value)}</td>\n`;
    });
    html += '    </tr>\n';
  });
  html += '  </tbody>\n';
  
  // Footer
  if (footerStats) {
    html += '  <tfoot>\n    <tr>\n';
    allColumns.forEach(col => {
      const value = footerStats[col.key];
      html += `      <td><b>${value !== undefined ? escapeHtml(formatValue(value, col.type)) : ''}</b></td>\n`;
    });
    html += '    </tr>\n  </tfoot>\n';
  }
  
  html += '</table>';
  return html;
}
