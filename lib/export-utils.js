/**
 * DOCX export.
 *
 * `docx` and `file-saver` are loaded on demand rather than at module scope:
 * this file is imported by the document editor, which shows a toolbar long
 * before anyone clicks "export", and the DOCX writer is by far the heaviest
 * thing on that page. Markdown/analysis rendering moved to
 * lib/markdown-html.js so pages that only display text no longer pull any of
 * this in.
 */
import DOMPurify from 'dompurify';

const DOCX_SOFT_ACCENT = 'D66136';
const DOCX_HEADING_COLOR = '16202D';
const DOCX_TEXT_COLOR = '1F2A37';
const DOCX_DIVIDER_COLOR = 'D6DEE7';
const DOCX_BRAND_FONT = 'Inter';
const DOCX_BODY_FONT_SIZE = 23; // 11.5pt (docx uses half-points)

// Assigned by loadDocxRuntime() before any of the builders below run.
let BorderStyle;
let Document;
let Packer;
let Paragraph;
let TextRun;
let convertInchesToTwip;
let saveAs;

async function loadDocxRuntime() {
  if (Document) return;
  const [docx, fileSaver] = await Promise.all([import('docx'), import('file-saver')]);
  ({ BorderStyle, Document, Packer, Paragraph, TextRun, convertInchesToTwip } = docx);
  saveAs = fileSaver.saveAs || fileSaver.default?.saveAs || fileSaver.default;
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
  await loadDocxRuntime();
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
