/**
 * Berechnet Formeln sicher ohne eval()
 * Unterstützt: +, -, *, /, (, ), Spalten-Keys, sum(key)
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeExpression(expression) {
  const tokens = [];
  const source = String(expression || '');
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if ('+-*/()'.includes(char)) {
      tokens.push(char);
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let number = char;
      i += 1;
      let dotCount = char === '.' ? 1 : 0;

      while (i < source.length && /[0-9.]/.test(source[i])) {
        if (source[i] === '.') {
          dotCount += 1;
          if (dotCount > 1) {
            throw new Error('INVALID_NUMBER');
          }
        }
        number += source[i];
        i += 1;
      }

      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(number)) {
        throw new Error('INVALID_NUMBER');
      }

      tokens.push(number);
      continue;
    }

    throw new Error('INVALID_CHARACTER');
  }

  return tokens;
}

function parseExpressionTokens(tokens) {
  let position = 0;

  function peek() {
    return tokens[position];
  }

  function consume(expected) {
    const token = tokens[position];
    if (expected && token !== expected) {
      throw new Error('UNEXPECTED_TOKEN');
    }
    position += 1;
    return token;
  }

  function parseFactor() {
    const token = peek();
    if (token === '+') {
      consume('+');
      return parseFactor();
    }
    if (token === '-') {
      consume('-');
      return -parseFactor();
    }
    if (token === '(') {
      consume('(');
      const inner = parseAddSub();
      consume(')');
      return inner;
    }
    if (token === undefined) {
      throw new Error('UNEXPECTED_END');
    }

    const value = Number.parseFloat(consume());
    if (!Number.isFinite(value)) {
      throw new Error('INVALID_NUMBER');
    }
    return value;
  }

  function parseMulDiv() {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parseFactor();
      if (op === '*') {
        value *= right;
      } else {
        value /= right;
      }
    }
    return value;
  }

  function parseAddSub() {
    let value = parseMulDiv();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseMulDiv();
      if (op === '+') {
        value += right;
      } else {
        value -= right;
      }
    }
    return value;
  }

  const result = parseAddSub();
  if (position !== tokens.length) {
    throw new Error('TRAILING_TOKENS');
  }
  return result;
}

function evaluateExpression(expression) {
  const tokens = tokenizeExpression(expression);
  if (tokens.length === 0) return 0;
  const value = parseExpressionTokens(tokens);
  if (!Number.isFinite(value)) {
    throw new Error('NON_FINITE_RESULT');
  }
  return value;
}

export function evaluateFormula(formula, rowData) {
  let expression = String(formula || '');
  
  // Ersetze Spalten-Keys mit Werten
  // Sortiere Keys nach Länge (absteigend), damit "preis_total" vor "preis" ersetzt wird
  const sortedKeys = Object.keys(rowData || {}).sort((a, b) => b.length - a.length);
  
  for (const key of sortedKeys) {
    const value = parseFloat(rowData[key]) || 0;
    expression = expression.replace(new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g'), String(value));
  }
  
  // Sichere Evaluierung nur mit erlaubten Zeichen
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    console.warn('Ungültige Formel-Zeichen erkannt:', expression);
    return 0;
  }
  
  // Berechne
  try {
    const result = evaluateExpression(expression);
    return Number(result.toFixed(2));
  } catch (e) {
    console.error('Formel-Berechnungsfehler:', e, 'Formel:', formula, 'Daten:', rowData);
    return 0;
  }
}

/**
 * Extrahiert sum() Aggregations-Funktionen aus Formel
 */
export function extractAggregations(formula) {
  const aggregations = [];
  const regex = /sum\((\w+)\)/gi;
  let match;
  
  while ((match = regex.exec(formula)) !== null) {
    aggregations.push({
      function: 'sum',
      column: match[1],
      fullMatch: match[0]
    });
  }
  
  return aggregations;
}

/**
 * Wendet alle Berechnungen auf eine Zeile an
 */
export function applyCalculations(row, calculations) {
  if (!calculations || calculations.length === 0) {
    return row;
  }
  
  const calculatedRow = { ...row };
  
  calculations.forEach(calc => {
    if (calc.displayInTable && calc.formula) {
      try {
        calculatedRow[calc.key] = evaluateFormula(calc.formula, row);
      } catch (e) {
        console.error('Berechnungsfehler für', calc.key, e);
        calculatedRow[calc.key] = 0;
      }
    }
  });
  
  return calculatedRow;
}

/**
 * Berechnet aggregierte Werte für Fußzeile
 */
export function calculateFooterStats(rows, columns, calculations) {
  if (!calculations || calculations.length === 0) {
    return {};
  }
  
  const stats = {};
  
  // Berechne Summen für alle numerischen Spalten
  const columnSums = {};
  columns.forEach(col => {
    if (col.type === 'number' || col.type === 'currency') {
      columnSums[col.key] = rows.reduce((sum, row) => 
        sum + (parseFloat(row[col.key]) || 0), 0
      );
    }
  });
  
  calculations.forEach(calc => {
    if (calc.displayInFooter && calc.formula) {
      // Prüfe auf sum() Aggregationsfunktionen
      const aggregations = extractAggregations(calc.formula);
      
      if (aggregations.length > 0) {
        // Ersetze sum() mit tatsächlichen Summen
        let formulaWithSums = calc.formula;
        aggregations.forEach(agg => {
          const sumValue = columnSums[agg.column] || 0;
          formulaWithSums = formulaWithSums.replace(agg.fullMatch, sumValue);
        });
        
        try {
          stats[calc.key] = evaluateFormula(formulaWithSums, {});
        } catch (e) {
          console.error('Aggregations-Fehler:', e);
          stats[calc.key] = 0;
        }
      } else {
        // Normale Formel auf aggregierte Werte anwenden
        const aggregated = { ...columnSums };
        stats[calc.key] = evaluateFormula(calc.formula, aggregated);
      }
    }
  });
  
  return stats;
}

/**
 * Validiert ein Tabellen-Schema
 */
export function validateTableSchema(schema) {
  const errors = [];
  
  if (!schema.tableName) {
    errors.push('Tabellen-Name ist erforderlich');
  }
  
  if (!schema.columns || schema.columns.length === 0) {
    errors.push('Mindestens eine Spalte erforderlich');
  } else {
    const keys = schema.columns.map(c => c.key);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      errors.push('Spalten-Keys müssen eindeutig sein');
    }
    
    schema.columns.forEach((col, idx) => {
      if (!col.key) errors.push(`Spalte ${idx + 1}: Key fehlt`);
      if (!col.label) errors.push(`Spalte ${idx + 1}: Bezeichnung fehlt`);
      if (!['text', 'number', 'currency', 'date'].includes(col.type)) {
        errors.push(`Spalte ${col.key || idx + 1}: Ungültiger Typ`);
      }
    });
  }

  if (schema.rows && !Array.isArray(schema.rows)) {
    errors.push('Zeilen-Definitionen müssen als Array vorliegen');
  }

  if (Array.isArray(schema.rows) && schema.rows.length > 0) {
    const rowKeys = schema.rows.map((row) => row.key);
    const uniqueRowKeys = new Set(rowKeys);
    if (uniqueRowKeys.size !== rowKeys.length) {
      errors.push('Zeilen-Keys müssen eindeutig sein');
    }

    schema.rows.forEach((row, idx) => {
      if (!row.key) errors.push(`Zeile ${idx + 1}: Key fehlt`);
      if (!row.label) errors.push(`Zeile ${idx + 1}: Bezeichnung fehlt`);
    });
  }
  
  // Validiere Berechnungen
  if (schema.calculations) {
    const validColumnKeys = schema.columns.map(c => c.key);
    
    schema.calculations.forEach((calc, idx) => {
      if (!calc.key) errors.push(`Berechnung ${idx + 1}: Key fehlt`);
      if (!calc.formula) {
        errors.push(`Berechnung ${calc.key || idx + 1}: Formel fehlt`);
        return;
      }

      if (!/^[a-z0-9_+\-*/().\s]+$/i.test(calc.formula)) {
        errors.push(`Berechnung ${calc.key || idx + 1}: Formel enthält ungültige Zeichen`);
      }

      const functionCalls = calc.formula.match(/\b[a-z_][a-z0-9_]*\s*\(/gi) || [];
      functionCalls.forEach((call) => {
        const functionName = call.replace(/\s*\($/, '').toLowerCase();
        if (functionName !== 'sum') {
          errors.push(`Berechnung ${calc.key || idx + 1}: Nur sum(...) ist als Funktion erlaubt`);
        }
      });

      const sumArgs = calc.formula.match(/sum\(([^)]+)\)/gi) || [];
      sumArgs.forEach((entry) => {
        const column = entry.replace(/^sum\(/i, '').replace(/\)$/, '').trim();
        if (!/^[a-z_][a-z0-9_]*$/i.test(column)) {
          errors.push(`Berechnung ${calc.key || idx + 1}: Ungültiges sum()-Argument`);
          return;
        }
        if (!validColumnKeys.includes(column)) {
          errors.push(`Berechnung ${calc.key || idx + 1}: Unbekannte Spalte in sum(): ${column}`);
        }
      });

      const formulaKeys = calc.formula.match(/\b[a-z_][a-z0-9_]*\b/gi) || [];
      formulaKeys.forEach((key) => {
        if (key.toLowerCase() === 'sum') return;
        if (!validColumnKeys.includes(key)) {
          errors.push(`Berechnung ${calc.key || idx + 1}: Unbekannter Spalten-Key "${key}"`);
        }
      });
    });
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Erstellt einen Prompt für die KI-Extraktion basierend auf dem Schema
 */
export function buildTableExtractionPrompt(schema, language = 'de') {
  const rowDefinitions = Array.isArray(schema.rows)
    ? schema.rows.filter((row) => row && row.key && row.label)
    : [];
  const columns = schema.columns.map(col => 
    `- "${col.key}": "${col.label}" (${col.type}${col.required ? ', erforderlich' : ''})`
  ).join('\n');
  
  const calculations = schema.calculations 
    ? schema.calculations.filter(c => c.displayInTable).map(calc => 
        `- "${calc.key}": "${calc.label}" (${calc.type}, berechnet: ${calc.formula})`
      ).join('\n')
    : '';
  const hasRowDefinitions = rowDefinitions.length > 0;
  const rowDefinitionBlock = hasRowDefinitions
    ? `VORDEFINIERTE ZEILEN:\n${rowDefinitions.map((row) => `- "${row.key}": "${row.label}"${row.required ? ' (erforderlich)' : ''}${row.hint ? ` — Hinweis: ${row.hint}` : ''}`).join('\n')}\n`
    : '';
  const jsonRowFields = [
    ...(hasRowDefinitions ? ['      "row_key": "zeilen_key",'] : []),
    ...schema.columns.map((col) => `      "${col.key}": ${col.type === 'text' ? '"Wert"' : col.type === 'date' ? '"YYYY-MM-DD"' : '0.00'}`),
  ];
  
  return `Du bist ein Experte für Datenextraktion. Extrahiere alle relevanten Informationen aus dem folgenden Text und erstelle eine strukturierte Tabelle.

AUFGABE: ${schema.description || 'Extrahiere strukturierte Daten aus dem Text'}

TABELLE: ${schema.tableName}

SPALTEN:
${columns}

${rowDefinitionBlock}
${calculations ? `BERECHNETE SPALTEN:\n${calculations}\n` : ''}

WICHTIGE REGELN:
- Gib das Ergebnis als gültiges JSON zurück
- Die Hauptdaten sind im Array "rows" (jedes Element ist eine Zeile)
- Extrahiere ALLE vorkommenden Datensätze aus dem Text
- Wenn die gleiche Tabellenstruktur mehrfach im Text vorkommt, führe alle Zeilen in einem gemeinsamen "rows"-Array zusammen
- ${hasRowDefinitions ? 'Nutze für jede Zeile zusätzlich das Feld "row_key" mit einem der vordefinierten Zeilen-Keys' : 'Optional kann ein Feld "row_key" gesetzt werden, falls Zeilenkontext vorhanden ist'}
- Bei fehlenden Werten: null oder leerer String verwenden
- Bei Zahlen: Punkt als Dezimaltrenner (z.B. 19.99)
- Bei Währungen: Nur den Zahlenwert, kein €-Zeichen
- Bei Datum: ISO-Format YYYY-MM-DD

ERFORDERLICHE JSON-STRUKTUR:
{
  "rows": [
    {
${jsonRowFields.join(',\n')}
    }
  ],
  "extrahierte_zeilen_anzahl": 0,
  "unvollstaendige_daten": ["Liste von Hinweisen zu fehlenden oder unklaren Daten"],
  "zusammenfassung": "Kurze Zusammenfassung der extrahierten Daten"
}

Verbindliche Stilregeln:
- Liefere nur das JSON, keine Einleitung oder Erklärung
- JSON muss valide und vollständig sein
- Keine zusätzlichen Felder außerhalb der vorgegebenen Struktur
- Keine Platzhalter wie "Beispiel" oder "N/A"
- Wenn keine Daten gefunden wurden: rows als leeres Array []

TEXT ZUR ANALYSE:
"{{TEXT}}"`;
}
