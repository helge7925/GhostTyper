import { BorderStyle, Document, Packer, Paragraph, TextRun, convertInchesToTwip } from 'docx';
import { saveAs } from 'file-saver';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
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
 * Recursively parse HTML node into docx paragraphs and text runs
 */
function parseHtmlNode(node, parentOptions = {}) {
  const results = [];
  
  if (node.nodeType === 3) { // Text node
    const text = node.textContent || '';
    if (text.trim() || parentOptions.preserveWhitespace) {
      results.push(new TextRun({
        text: text,
        font: {
          ascii: DOCX_BRAND_FONT,
          hAnsi: DOCX_BRAND_FONT,
          eastAsia: DOCX_BRAND_FONT,
          cs: DOCX_BRAND_FONT,
        },
        size: parentOptions.size ?? DOCX_BODY_FONT_SIZE,
        color: parentOptions.color ?? DOCX_TEXT_COLOR,
        bold: Boolean(parentOptions.bold),
        italics: Boolean(parentOptions.italic),
        underline: parentOptions.underline ? { type: 'single' } : undefined,
      }));
    }
    return results;
  }

  if (node.nodeType !== 1) return results; // Not an element

  const tagName = node.nodeName.toUpperCase();
  const newOptions = { ...parentOptions };

  // Handle formatting tags
  if (tagName === 'STRONG' || tagName === 'B') {
    newOptions.bold = true;
  } else if (tagName === 'EM' || tagName === 'I') {
    newOptions.italic = true;
  } else if (tagName === 'U') {
    newOptions.underline = true;
  } else if (tagName === 'BR') {
    results.push(new TextRun({ text: '', break: 1 }));
    return results;
  }

  // Handle block-level elements
  if (tagName === 'H1') {
    const children = [];
    node.childNodes.forEach(child => {
      children.push(...parseHtmlNode(child, { ...newOptions, size: 42, bold: true, color: DOCX_HEADING_COLOR }));
    });
    results.push(new Paragraph({
      children,
      spacing: { after: 220 },
    }));
    return results;
  }

  if (tagName === 'H2') {
    const children = [];
    node.childNodes.forEach(child => {
      children.push(...parseHtmlNode(child, { ...newOptions, size: 34, bold: true, color: DOCX_SOFT_ACCENT }));
    });
    results.push(new Paragraph({
      children,
      spacing: { before: 420, after: 160 },
      border: {
        top: { style: BorderStyle.SINGLE, color: DOCX_DIVIDER_COLOR, size: 4, space: 8 },
      },
    }));
    return results;
  }

  if (tagName === 'H3') {
    const children = [];
    node.childNodes.forEach(child => {
      children.push(...parseHtmlNode(child, { ...newOptions, size: 28, bold: true, color: DOCX_HEADING_COLOR }));
    });
    results.push(new Paragraph({
      children,
      spacing: { before: 300, after: 140 },
    }));
    return results;
  }

  if (tagName === 'P') {
    const children = [];
    node.childNodes.forEach(child => {
      children.push(...parseHtmlNode(child, newOptions));
    });
    results.push(new Paragraph({
      children,
      spacing: { after: 120 },
    }));
    return results;
  }

  if (tagName === 'DIV') {
    const children = [];
    node.childNodes.forEach(child => {
      const parsed = parseHtmlNode(child, newOptions);
      // If child returns paragraphs, flatten; otherwise collect text runs
      parsed.forEach(item => {
        if (item instanceof Paragraph) {
          results.push(item);
        } else {
          children.push(item);
        }
      });
    });
    if (children.length > 0) {
      results.push(new Paragraph({
        children,
        spacing: { after: 120 },
      }));
    }
    return results;
  }

  if (tagName === 'UL' || tagName === 'OL') {
    const isOrdered = tagName === 'OL';
    const level = parentOptions.listLevel ?? 0;
    
    node.childNodes.forEach((child, index) => {
      if (child.nodeName === 'LI') {
        const liChildren = [];
        child.childNodes.forEach(liChild => {
          const parsed = parseHtmlNode(liChild, { ...newOptions, listLevel: level + 1 });
          parsed.forEach(item => {
            if (item instanceof Paragraph) {
              // Nested structure - add with increased indentation
              results.push(item);
            } else {
              liChildren.push(item);
            }
          });
        });

        // Check if LI contains nested lists
        const hasNestedList = Array.from(child.childNodes).some(n => 
          n.nodeType === 1 && (n.nodeName === 'UL' || n.nodeName === 'OL')
        );

        if (hasNestedList) {
          // Process nested structure separately
          const nestedItems = [];
          child.childNodes.forEach(liChild => {
            if (liChild.nodeType === 1 && (liChild.nodeName === 'UL' || liChild.nodeName === 'OL')) {
              const nestedParsed = parseHtmlNode(liChild, { ...newOptions, listLevel: level + 1 });
              nestedItems.push(...nestedParsed);
            } else if (liChild.nodeType === 3 && liChild.textContent.trim()) {
              // Text content before nested list
              const textRuns = parseHtmlNode(liChild, newOptions);
              if (textRuns.length > 0) {
                results.push(new Paragraph({
                  children: textRuns,
                  bullet: { level },
                  spacing: { after: 120 },
                }));
              }
            }
          });
          results.push(...nestedItems);
        } else {
          // Simple list item
          results.push(new Paragraph({
            children: liChildren,
            bullet: isOrdered ? { level } : { level },
            numbering: isOrdered ? { reference: 'default', level, ordinal: index + 1 } : undefined,
            spacing: { after: 120 },
          }));
        }
      }
    });
    return results;
  }

  if (tagName === 'LI') {
    // LI should be handled by parent UL/OL
    const children = [];
    node.childNodes.forEach(child => {
      children.push(...parseHtmlNode(child, newOptions));
    });
    return children;
  }

  // Default: process children
  node.childNodes.forEach(child => {
    results.push(...parseHtmlNode(child, newOptions));
  });

  return results;
}

/**
 * True DOCX Export using 'docx' library.
 */
export async function exportToDoc(html, filename = 'dokument') {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  
  const children = [];

  // Only process the content wrapper if present
  const root = tempDiv.querySelector('.content-wrapper') || tempDiv;
  
  root.childNodes.forEach(node => {
    const parsed = parseHtmlNode(node);
    parsed.forEach(item => {
      if (item instanceof Paragraph) {
        children.push(item);
      } else if (item instanceof TextRun) {
        // Wrap orphaned TextRuns in a paragraph
        children.push(new Paragraph({
          children: [item],
          spacing: { after: 120 },
        }));
      }
    });
  });

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
