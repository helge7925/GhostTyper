import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { marked } from 'marked';

/**
 * Professional Markdown to HTML converter using 'marked'.
 */
export function mdToHtml(md) {
  if (!md) return '';
  return marked.parse(md, { breaks: true, gfm: true });
}

function toDisplayLabel(rawKey) {
  if (!rawKey) return '';

  const normalized = String(rawKey).toLowerCase();
  const explicitLabels = {
    prioritaet: 'Priorität',
    offene_punkte: 'Offene Punkte',
    naechste_schritte: 'Nächste Schritte',
    raeume: 'Räume',
    masse: 'Maße',
    hoehe: 'Höhe',
    gesamtflaechen: 'Gesamtflächen',
  };

  if (explicitLabels[normalized]) {
    return explicitLabels[normalized];
  }

  const withSpaces = String(rawKey).replace(/_/g, ' ');
  const withUmlauts = withSpaces
    .replace(/ae/g, 'ä')
    .replace(/oe/g, 'ö')
    .replace(/ue/g, 'ü')
    .replace(/Ae/g, 'Ä')
    .replace(/Oe/g, 'Ö')
    .replace(/Ue/g, 'Ü');

  return withUmlauts.charAt(0).toUpperCase() + withUmlauts.slice(1);
}

function isPlaceholderString(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;

  const knownPlaceholders = new Set([
    'todo',
    'to-do',
    'todo:',
    'to-do:',
    '-',
    'n/a',
    'na',
    'none',
    'null',
    'keine angabe',
    'keine angaben',
    'nicht angegeben',
    'nicht genannt',
    'nicht vorhanden',
    'offen',
  ]);
  if (knownPlaceholders.has(normalized)) return true;

  return /^[a-zA-ZäöüÄÖÜß\s_-]{2,60}:\s*$/.test(value.trim());
}

function hasRenderableContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return !isPlaceholderString(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function sanitizeAnalysisValue(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isPlaceholderString(trimmed)) return null;
    return trimmed;
  }

  if (Array.isArray(value)) {
    const cleanedItems = value
      .map((item) => sanitizeAnalysisValue(item))
      .filter((item) => hasRenderableContent(item));
    return cleanedItems.length > 0 ? cleanedItems : null;
  }

  if (typeof value === 'object') {
    const cleanedEntries = Object.entries(value)
      .map(([key, nested]) => [key, sanitizeAnalysisValue(nested)])
      .filter(([, nested]) => hasRenderableContent(nested));
    return cleanedEntries.length > 0 ? Object.fromEntries(cleanedEntries) : null;
  }

  return value;
}

/**
 * Recursively converts objects/arrays to clean HTML strings.
 */
function renderValue(value) {
  const cleanedValue = sanitizeAnalysisValue(value);
  if (!hasRenderableContent(cleanedValue)) return '';

  if (Array.isArray(cleanedValue)) {
    return `<ul class="list-disc ml-6 my-2 space-y-1">${cleanedValue.map(v => `<li>${typeof v === 'object' ? renderValue(v) : v}</li>`).join('')}</ul>`;
  }
  if (typeof cleanedValue === 'object') {
    return Object.entries(cleanedValue)
      .map(([k, v]) => `
        <div class="mb-2 ml-4">
          <strong class="text-accent-orange">${toDisplayLabel(k)}:</strong> 
          ${typeof v === 'object' ? renderValue(v) : v}
        </div>`)
      .join('');
  }
  return cleanedValue;
}

/**
 * Converts structured analysis to clean HTML for the editor.
 */
export function analysisToHtml(transcription) {
  if (!transcription) return '';
  const { original_name, analysis, text } = transcription;
  const normalizedAnalysis = analysis && typeof analysis === 'object'
    ? sanitizeAnalysisValue(analysis)
    : analysis;
  
  let html = `<div class="content-wrapper">`;
  
  let displayTitle = original_name?.replace(/\.[^/.]+$/, "")?.replace(/_/g, ' ') || 'Dokument';
  if (normalizedAnalysis && typeof normalizedAnalysis === 'object') {
    displayTitle = normalizedAnalysis.projekt || normalizedAnalysis.project || normalizedAnalysis.titel || normalizedAnalysis.title || displayTitle;
  }
  
  html += `<h1 class="main-title">${displayTitle}</h1>`;
  
  if (normalizedAnalysis && typeof normalizedAnalysis === 'object') {
    if (hasRenderableContent(normalizedAnalysis.zusammenfassung) || hasRenderableContent(normalizedAnalysis.summary)) {
      html += `<h2>Zusammenfassung</h2><p>${normalizedAnalysis.zusammenfassung || normalizedAnalysis.summary}</p>`;
    }
    
    const core = normalizedAnalysis.kernpunkte || normalizedAnalysis.key_points || normalizedAnalysis.themen || normalizedAnalysis.topics;
    if (Array.isArray(core) && core.length > 0) {
      html += `<h2>Wichtigste Punkte</h2><ul>${core.map(item => `<li>${item}</li>`).join('')}</ul>`;
    }

    const recs = normalizedAnalysis.handlungsempfehlungen || normalizedAnalysis.recommendations;
    if (Array.isArray(recs) && recs.length > 0) {
      html += `<h2>Handlungsempfehlungen</h2><ul>${recs.map(item => `<li>${item}</li>`).join('')}</ul>`;
    }

    const handled = ['zusammenfassung', 'summary', 'kernpunkte', 'key_points', 'themen', 'topics', 'raw', 'projekt', 'project', 'titel', 'title', 'handlungsempfehlungen', 'recommendations'];
    Object.entries(normalizedAnalysis).forEach(([key, value]) => {
      if (handled.includes(key.toLowerCase()) || !hasRenderableContent(value)) return;
      const renderedValue = renderValue(value);
      if (!renderedValue) return;
      html += `<h2>${toDisplayLabel(key)}</h2>`;
      html += `<div>${renderedValue}</div>`;
    });
  } else if (typeof normalizedAnalysis === 'string') {
    html += mdToHtml(normalizedAnalysis);
  }

  if (text && !normalizedAnalysis) {
    html += mdToHtml(text);
  }
  
  html += `</div>`;
  return html;
}

/**
 * True DOCX Export using 'docx' library.
 */
export async function exportToDoc(html, filename = 'dokument') {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  const children = [];
  
  // Very simple HTML to docx conversion
  const processNode = (node) => {
    if (node.nodeType === 3) { // Text
      return new TextRun(node.textContent);
    }
    
    if (node.nodeName === 'H1') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }));
    } else if (node.nodeName === 'H2') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 200 } }));
    } else if (node.nodeName === 'P') {
      children.push(new Paragraph({ text: node.textContent, spacing: { after: 120 } }));
    } else if (node.nodeName === 'LI') {
      children.push(new Paragraph({ text: node.textContent, bullet: { level: 0 }, spacing: { after: 120 } }));
    } else {
      // Process children
      node.childNodes.forEach(processNode);
    }
  };

  // Only process the content wrapper if present
  const root = tempDiv.querySelector('.content-wrapper') || tempDiv;
  root.childNodes.forEach(processNode);

  const doc = new Document({
    sections: [{
      properties: {},
      children: children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename.replace(/\.[^/.]+$/, "")}.docx`);
}
