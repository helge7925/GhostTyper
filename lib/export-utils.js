import { BorderStyle, Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { marked } from 'marked';
import { hasMeaningfulContent, sanitizeStructuredValue } from './analysis-cleaner';

const DOCX_SOFT_ACCENT = 'D66136';
const DOCX_HEADING_COLOR = '16202D';
const DOCX_TEXT_COLOR = '1F2A37';
const DOCX_DIVIDER_COLOR = 'D6DEE7';
const DOCX_BRAND_FONT = 'Inter';
const DOCX_BODY_FONT_SIZE = 23; // 11.5pt (docx uses half-points)

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

  const withSpaces = String(rawKey).replace(/_/g, ' ').trim();
  if (!withSpaces) return '';

  return withSpaces
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function hasRenderableContent(value) {
  return hasMeaningfulContent(value);
}

/**
 * Recursively converts objects/arrays to clean HTML strings.
 */
function renderValue(value) {
  const cleanedValue = sanitizeStructuredValue(value);
  if (!hasRenderableContent(cleanedValue)) return '';

  if (Array.isArray(cleanedValue)) {
    const items = cleanedValue
      .map((entry) => {
        if (!hasRenderableContent(entry)) return '';
        if (typeof entry === 'object') {
          const nested = renderValue(entry);
          return nested ? `<li>${nested}</li>` : '';
        }
        return `<li>${entry}</li>`;
      })
      .filter(Boolean)
      .join('');

    return items ? `<ul>${items}</ul>` : '';
  }
  if (typeof cleanedValue === 'object') {
    const items = Object.entries(cleanedValue)
      .map(([k, v]) => {
        if (!hasRenderableContent(v)) return '';
        const label = toDisplayLabel(k);

        if (typeof v === 'object') {
          const nested = renderValue(v);
          if (!nested) return '';
          return `<li><strong>${label}:</strong>${nested}</li>`;
        }

        return `<li><strong>${label}:</strong> ${v}</li>`;
      })
      .filter(Boolean)
      .join('');

    return items ? `<ul>${items}</ul>` : '';
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
    ? sanitizeStructuredValue(analysis)
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

  const createBrandRun = (text, options = {}) => {
    return new TextRun({
      text: text || '',
      font: {
        ascii: DOCX_BRAND_FONT,
        hAnsi: DOCX_BRAND_FONT,
        eastAsia: DOCX_BRAND_FONT,
        cs: DOCX_BRAND_FONT,
      },
      size: options.size ?? DOCX_BODY_FONT_SIZE,
      color: options.color ?? DOCX_TEXT_COLOR,
      bold: Boolean(options.bold),
    });
  };

  const createHeadingParagraph = (text, size, color, spacing = {}, border = undefined) => {
    return new Paragraph({
      children: [
        createBrandRun(text, {
          size,
          bold: true,
          color,
        }),
      ],
      border,
      spacing,
    });
  };

  const createBodyParagraph = (text, spacing = {}) => {
    return new Paragraph({
      children: [createBrandRun(text)],
      spacing,
    });
  };
  
  // Very simple HTML to docx conversion
  const processNode = (node) => {
    if (node.nodeType === 3) { // Text
      return createBrandRun(node.textContent);
    }
    
    if (node.nodeName === 'H1') {
      children.push(createHeadingParagraph(
        node.textContent,
        42,
        DOCX_HEADING_COLOR,
        { after: 220 }
      ));
    } else if (node.nodeName === 'H2') {
      children.push(createHeadingParagraph(
        node.textContent,
        34,
        DOCX_SOFT_ACCENT,
        { before: 420, after: 160 },
        {
          top: { style: BorderStyle.SINGLE, color: DOCX_DIVIDER_COLOR, size: 4, space: 8 },
        }
      ));
    } else if (node.nodeName === 'H3') {
      children.push(createHeadingParagraph(node.textContent, 28, DOCX_HEADING_COLOR, { before: 300, after: 140 }));
    } else if (node.nodeName === 'P') {
      children.push(createBodyParagraph(node.textContent, { after: 120 }));
    } else if (node.nodeName === 'LI') {
      children.push(new Paragraph({
        children: [createBrandRun(node.textContent)],
        bullet: { level: 0 },
        spacing: { after: 120 },
      }));
    } else {
      // Process children
      node.childNodes.forEach(processNode);
    }
  };

  // Only process the content wrapper if present
  const root = tempDiv.querySelector('.content-wrapper') || tempDiv;
  root.childNodes.forEach(processNode);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: {
              ascii: DOCX_BRAND_FONT,
              hAnsi: DOCX_BRAND_FONT,
              eastAsia: DOCX_BRAND_FONT,
              cs: DOCX_BRAND_FONT,
            },
            size: DOCX_BODY_FONT_SIZE,
            color: DOCX_TEXT_COLOR,
          },
          paragraph: {
            spacing: {
              line: 320,
            },
          },
        },
      },
    },
    sections: [{
      properties: {},
      children: children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename.replace(/\.[^/.]+$/, "")}.docx`);
}
