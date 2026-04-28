import { saveAs } from 'file-saver';
import {
  getTableRowLabel,
  normalizeTableMetadata,
  normalizeTableSchema,
  orderRowsBySchema,
} from './table-schema';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeExportName(filename) {
  const clean = String(filename || 'export')
    .replace(/\.[^/.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim();
  return clean || 'export';
}

function protectSpreadsheetValue(value) {
  const asString = String(value ?? '');
  if (!asString) return asString;
  if (/^[\s]*[=+\-@]/.test(asString)) {
    return `'${asString}`;
  }
  return asString;
}

function hasFixedRows(schema) {
  return Array.isArray(schema.rows) && schema.rows.length > 0;
}

function getExportShape(tableData, schema) {
  const normalizedSchema = normalizeTableSchema(schema);
  const rows = orderRowsBySchema(tableData?.rows || [], normalizedSchema);
  const metadata = normalizeTableMetadata(tableData?.metadata || {}, normalizedSchema);
  return {
    schema: normalizedSchema,
    rows,
    metadata,
    columns: normalizedSchema.columns,
    includeRowTitle: hasFixedRows(normalizedSchema),
  };
}

function formatPlainValue(value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'currency') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2).replace('.', ',') : protectSpreadsheetValue(value);
  }
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed).replace('.', ',') : protectSpreadsheetValue(value);
  }
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}.${month}.${year}`;
  }
  return protectSpreadsheetValue(value);
}

function csvCell(value) {
  const strValue = String(value ?? '');
  if (strValue.includes(';') || strValue.includes('\n') || strValue.includes('"')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }
  return strValue;
}

export function exportTableToCSV(tableData, schema, filename) {
  const shape = getExportShape(tableData, schema);
  const lines = [];

  if (shape.schema.tableName) {
    lines.push(csvCell(shape.schema.tableName));
  }

  shape.schema.metadata.forEach((field) => {
    lines.push([
      csvCell(field.label),
      csvCell(formatPlainValue(shape.metadata[field.key], field.type)),
    ].join(';'));
  });

  if (lines.length > 0) lines.push('');

  const headers = [
    ...(shape.includeRowTitle ? ['Zeile'] : []),
    ...shape.columns.map((column) => column.label),
  ];
  lines.push(headers.map(csvCell).join(';'));

  shape.rows.forEach((row, rowIndex) => {
    const values = [
      ...(shape.includeRowTitle ? [getTableRowLabel(shape.schema, row, rowIndex)] : []),
      ...shape.columns.map((column) => formatPlainValue(row?.[column.key], column.type)),
    ];
    lines.push(values.map(csvCell).join(';'));
  });

  const csv = `\uFEFF${lines.join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `${safeExportName(filename)}.csv`);
}

function parseExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toExcelValue(value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'number' || type === 'currency') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : protectSpreadsheetValue(value);
  }
  if (type === 'date') {
    return parseExcelDate(value) || protectSpreadsheetValue(value);
  }
  return protectSpreadsheetValue(value);
}

function applyCellStyle(cell, type) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  };
  cell.alignment = { vertical: 'top', wrapText: true };
  if (type === 'number') cell.numFmt = '#,##0.00';
  if (type === 'currency') cell.numFmt = '#,##0.00 €';
  if (type === 'date') cell.numFmt = 'dd.mm.yyyy';
}

function fitWorksheetColumns(worksheet, minWidth = 12, maxWidth = 42) {
  worksheet.columns.forEach((column) => {
    let width = minWidth;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const raw = cell.value instanceof Date
        ? '00.00.0000'
        : typeof cell.value === 'object' && cell.value?.richText
          ? cell.value.richText.map((entry) => entry.text).join('')
          : String(cell.value ?? '');
      width = Math.max(width, Math.min(maxWidth, raw.length + 2));
    });
    column.width = width;
  });
}

export async function exportTableToExcel(tableData, schema, filename) {
  try {
    const ExcelJS = await import('exceljs');
    const shape = getExportShape(tableData, schema);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GhostTyper';
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheetName = (shape.schema.tableName || 'Daten').slice(0, 31).replace(/[\\/*?:[\]]/g, ' ') || 'Daten';
    const worksheet = workbook.addWorksheet(worksheetName);
    const totalColumns = shape.columns.length + (shape.includeRowTitle ? 1 : 0);

    const titleRow = worksheet.addRow([shape.schema.tableName || 'Datentabelle']);
    titleRow.height = 24;
    const titleCell = titleRow.getCell(1);
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF111827' } };
    titleCell.alignment = { vertical: 'middle' };
    if (totalColumns > 1) {
      worksheet.mergeCells(1, 1, 1, totalColumns);
    }

    let currentRowNumber = 2;
    if (shape.schema.metadata.length > 0) {
      shape.schema.metadata.forEach((field) => {
        const row = worksheet.getRow(currentRowNumber);
        row.getCell(1).value = field.label;
        row.getCell(1).font = { bold: true, color: { argb: 'FF374151' } };
        row.getCell(2).value = toExcelValue(shape.metadata[field.key], field.type);
        applyCellStyle(row.getCell(1), 'text');
        applyCellStyle(row.getCell(2), field.type);
        currentRowNumber += 1;
      });
      currentRowNumber += 1;
    }

    const headerRowNumber = currentRowNumber;
    const headerRow = worksheet.getRow(headerRowNumber);
    const headers = [
      ...(shape.includeRowTitle ? ['Zeile'] : []),
      ...shape.columns.map((column) => column.label),
    ];
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      applyCellStyle(cell, 'text');
    });

    shape.rows.forEach((sourceRow, rowIndex) => {
      const row = worksheet.getRow(headerRowNumber + rowIndex + 1);
      let cellIndex = 1;
      if (shape.includeRowTitle) {
        const cell = row.getCell(cellIndex);
        cell.value = protectSpreadsheetValue(getTableRowLabel(shape.schema, sourceRow, rowIndex));
        cell.font = { bold: true, color: { argb: 'FF374151' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        applyCellStyle(cell, 'text');
        cellIndex += 1;
      }

      shape.columns.forEach((column) => {
        const cell = row.getCell(cellIndex);
        cell.value = toExcelValue(sourceRow?.[column.key], column.type);
        applyCellStyle(cell, column.type);
        cellIndex += 1;
      });
    });

    worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
    worksheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: Math.max(totalColumns, 1) },
    };
    fitWorksheetColumns(worksheet);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${safeExportName(filename)}.xlsx`);
  } catch (error) {
    console.error('Excel-Export-Fehler:', error);
    exportTableToCSV(tableData, schema, filename);
  }
}

export function exportTableToHTML(tableData, schema) {
  const shape = getExportShape(tableData, schema);
  let html = `<h2>${escapeHtml(shape.schema.tableName || 'Datentabelle')}</h2>\n`;

  if (shape.schema.metadata.length > 0) {
    html += '<table border="1" cellpadding="5" cellspacing="0">\n<tbody>\n';
    shape.schema.metadata.forEach((field) => {
      html += `<tr><th>${escapeHtml(field.label)}</th><td>${escapeHtml(formatPlainValue(shape.metadata[field.key], field.type))}</td></tr>\n`;
    });
    html += '</tbody>\n</table>\n<br />\n';
  }

  html += '<table border="1" cellpadding="5" cellspacing="0">\n<thead>\n<tr>\n';
  if (shape.includeRowTitle) {
    html += '<th><b>Zeile</b></th>\n';
  }
  shape.columns.forEach((column) => {
    html += `<th><b>${escapeHtml(column.label)}</b></th>\n`;
  });
  html += '</tr>\n</thead>\n<tbody>\n';

  shape.rows.forEach((row, rowIndex) => {
    html += '<tr>\n';
    if (shape.includeRowTitle) {
      html += `<th>${escapeHtml(getTableRowLabel(shape.schema, row, rowIndex))}</th>\n`;
    }
    shape.columns.forEach((column) => {
      html += `<td>${escapeHtml(formatPlainValue(row?.[column.key], column.type))}</td>\n`;
    });
    html += '</tr>\n';
  });

  html += '</tbody>\n</table>';
  return html;
}
