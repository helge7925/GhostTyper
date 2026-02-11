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

/**
 * Recursively converts objects/arrays to clean HTML strings.
 */
function renderValue(value) {
  if (Array.isArray(value)) {
    return `<ul class="list-disc ml-6 my-2 space-y-1">${value.map(v => `<li>${typeof v === 'object' ? renderValue(v) : v}</li>`).join('')}</ul>`;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([k, v]) => `
        <div class="mb-2 ml-4">
          <strong class="text-accent-orange">${k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')}:</strong> 
          ${typeof v === 'object' ? renderValue(v) : v}
        </div>`)
      .join('');
  }
  return value;
}

/**
 * Converts structured analysis to clean HTML for the editor.
 */
export function analysisToHtml(transcription) {
  if (!transcription) return '';
  const { original_name, analysis, text } = transcription;
  
  let html = `<div class="content-wrapper">`;
  
  let displayTitle = original_name?.replace(/\.[^/.]+$/, "")?.replace(/_/g, ' ') || 'Dokument';
  if (analysis && typeof analysis === 'object') {
    displayTitle = analysis.projekt || analysis.project || analysis.titel || analysis.title || displayTitle;
  }
  
  html += `<h1 class="main-title">${displayTitle}</h1>`;
  
  if (analysis && typeof analysis === 'object') {
    if (analysis.zusammenfassung || analysis.summary) {
      html += `<h2>Zusammenfassung</h2><p>${analysis.zusammenfassung || analysis.summary}</p>`;
    }
    
    const core = analysis.kernpunkte || analysis.key_points || analysis.themen || analysis.topics;
    if (Array.isArray(core)) {
      html += `<h2>Wichtigste Punkte</h2><ul>${core.map(item => `<li>${item}</li>`).join('')}</ul>`;
    }

    const recs = analysis.handlungsempfehlungen || analysis.recommendations;
    if (Array.isArray(recs)) {
      html += `<h2>Handlungsempfehlungen</h2><ul>${recs.map(item => `<li>${item}</li>`).join('')}</ul>`;
    }

    const handled = ['zusammenfassung', 'summary', 'kernpunkte', 'key_points', 'themen', 'topics', 'raw', 'projekt', 'project', 'titel', 'title', 'handlungsempfehlungen', 'recommendations'];
    Object.entries(analysis).forEach(([key, value]) => {
      if (handled.includes(key.toLowerCase()) || value === null) return;
      html += `<h2>${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}</h2>`;
      html += `<div>${renderValue(value)}</div>`;
    });
  } else if (typeof analysis === 'string') {
    html += mdToHtml(analysis);
  }

  if (text && !analysis) {
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