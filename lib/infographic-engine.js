const ALLOWED_LAYOUTS = new Set(['auto', 'timeline', 'process_flow', 'comparison', 'mindmap', 'topic_tree']);
const ALLOWED_DETAIL_LEVELS = new Set(['compact', 'standard', 'detailed']);

const DETAIL_LIMITS = {
  compact: 8,
  standard: 12,
  detailed: 18,
};

const GROUP_PALETTE = ['#06b6d4', '#f59e0b', '#22c55e', '#f97316', '#8b5cf6', '#14b8a6', '#ef4444', '#f43f5e'];
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const SAFE_LEFT = 80;
const SAFE_TOP = 180;
const SAFE_RIGHT = CANVAS_WIDTH - 80;
const SAFE_BOTTOM = CANVAS_HEIGHT - 80;
const CONTENT_LEFT = 110;
const CONTENT_TOP = 250;
const CONTENT_RIGHT = CANVAS_WIDTH - 110;
const CONTENT_BOTTOM = CANVAS_HEIGHT - 100;
const ALLOWED_ICON_TYPES = new Set([
  'idea',
  'gear',
  'chart',
  'timeline',
  'people',
  'document',
  'warning',
  'network',
  'compare',
  'check',
  'question',
]);
const ALLOWED_SCENE_TYPES = new Set([
  'generic',
  'process',
  'data',
  'network',
  'timeline',
  'education',
  'research',
  'finance',
  'healthcare',
  'legal',
  'communication',
  'environment',
  'technology',
  'risk',
  'decision',
  'people',
  'comparison',
]);
const ALLOWED_ILLUSTRATION_STYLES = new Set([
  'editorial',
  'technical',
  'minimal',
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeFillAttributes(svg) {
  return String(svg || '').replace(/<([a-zA-Z][^<>]*)>/g, (tag) => {
    let seenFill = false;
    return tag.replace(/\sfill=(?:"[^"]*"|'[^']*')/g, (fillAttr) => {
      if (seenFill) return '';
      seenFill = true;
      return fillAttr;
    });
  });
}

function splitLongToken(token, maxLength) {
  if (!token || token.length <= maxLength) return [token];
  const parts = [];
  for (let index = 0; index < token.length; index += maxLength) {
    parts.push(token.slice(index, index + maxLength));
  }
  return parts;
}

function wrapText(text, maxCharsPerLine, maxLines) {
  const tokens = normalizeWhitespace(text)
    .split(' ')
    .filter(Boolean)
    .flatMap((token) => splitLongToken(token, Math.max(8, Math.floor(maxCharsPerLine * 0.75))));

  if (tokens.length === 0) return [''];

  const lines = [];
  let current = '';

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = token;
      if (lines.length >= maxLines - 1) break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

function truncate(value, maxLength) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function slugify(value, fallback = 'block') {
  const base = String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}

function stableHash(value) {
  const source = String(value || '');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 33) + source.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function buildScenePhotoUrl({ sceneType = '', iconType = '', motif = '', id = '' }) {
  const tokens = `${sceneType} ${iconType} ${motif}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  const query = tokens.join(',') || 'learning,diagram,study';
  const lock = stableHash(`${id}-${sceneType}-${iconType}-${motif}`);
  return `https://loremflickr.com/640/420/${query}?lock=${lock}`;
}

function extractSentences(text) {
  const source = String(text || '');
  return source
    .split(/\n+/)
    .flatMap((line) => line.split(/[.!?;:]/))
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry.length >= 6);
}

function dedupeStrings(items, maxItems = 100) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const value = normalizeWhitespace(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
    if (unique.length >= maxItems) break;
  }
  return unique;
}

function normalizeIconType(value) {
  const icon = normalizeWhitespace(value).toLowerCase();
  return ALLOWED_ICON_TYPES.has(icon) ? icon : 'document';
}

function normalizeSceneType(value) {
  const scene = normalizeWhitespace(value).toLowerCase();
  return ALLOWED_SCENE_TYPES.has(scene) ? scene : 'generic';
}

export function normalizeIllustrationStyle(value) {
  const style = normalizeWhitespace(value).toLowerCase();
  return ALLOWED_ILLUSTRATION_STYLES.has(style) ? style : 'editorial';
}

function inferIconTypeFromText(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return 'document';
  if (/warn|risiko|risk|problem|fehler|gefahr/.test(source)) return 'warning';
  if (/vergleich|versus|vs\\b|pro|contra|trade[- ]?off/.test(source)) return 'compare';
  if (/zeit|timeline|roadmap|phase|meilenstein|historie|epoch/.test(source)) return 'timeline';
  if (/team|rolle|kunde|person|stakeholder|gruppe|nutzer/.test(source)) return 'people';
  if (/prozess|ablauf|schritt|workflow|pipeline|flow/.test(source)) return 'gear';
  if (/daten|kennzahl|statistik|analyse|metr|chart|diagramm/.test(source)) return 'chart';
  if (/netz|beziehung|abhäng|graph|knoten|struktur/.test(source)) return 'network';
  if (/idee|konzept|strategie|vision|ziel/.test(source)) return 'idea';
  if (/aufgabe|todo|maßnahme|ergebnis|check|done/.test(source)) return 'check';
  if (/frage|offen|unknown|unklar|hypothese/.test(source)) return 'question';
  return 'document';
}

function inferSceneTypeFromText(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return 'generic';
  if (/prozess|ablauf|workflow|pipeline|schritt|flow/.test(source)) return 'process';
  if (/daten|kennzahl|statistik|metr|dashboard|analyse|report/.test(source)) return 'data';
  if (/netz|knoten|beziehung|abhäng|graph/.test(source)) return 'network';
  if (/zeit|roadmap|phase|meilenstein|historie|jahr|timeline/.test(source)) return 'timeline';
  if (/lernen|schule|bildung|kurs|training|studium|unterricht/.test(source)) return 'education';
  if (/forschung|hypothese|experiment|studie|methode|evidenz/.test(source)) return 'research';
  if (/budget|umsatz|kosten|preis|rendite|finanz|gewinn/.test(source)) return 'finance';
  if (/gesund|medizin|patient|therapie|klinik|diagnose/.test(source)) return 'healthcare';
  if (/recht|gesetz|compliance|vertrag|audit|richtlinie/.test(source)) return 'legal';
  if (/kommunikation|meeting|dialog|feedback|nachricht|chat/.test(source)) return 'communication';
  if (/nachhalt|co2|umwelt|klima|energie|ressource/.test(source)) return 'environment';
  if (/software|system|api|code|plattform|automation|ki/.test(source)) return 'technology';
  if (/risiko|problem|warn|gefahr|incident|fehler/.test(source)) return 'risk';
  if (/entscheidung|option|priorit|trade[- ]?off|abwäg/.test(source)) return 'decision';
  if (/team|rolle|kunde|nutzer|stakeholder|gruppe/.test(source)) return 'people';
  if (/vergleich|vs\\b|pro|contra|gegenüber/.test(source)) return 'comparison';
  return 'generic';
}

export function normalizeLayoutMode(value) {
  const layout = normalizeWhitespace(value).toLowerCase();
  return ALLOWED_LAYOUTS.has(layout) ? layout : 'auto';
}

export function normalizeDetailLevel(value) {
  const detail = normalizeWhitespace(value).toLowerCase();
  return ALLOWED_DETAIL_LEVELS.has(detail) ? detail : 'standard';
}

function inferLayout(blocks, requestedLayout) {
  if (requestedLayout && requestedLayout !== 'auto') return requestedLayout;

  const groups = [...new Set(blocks.map((block) => block.group).filter(Boolean))];
  if (groups.length >= 2 && groups.some((group) => /pro|contra|vs|vergleich|compare|left|right/i.test(group))) {
    return 'comparison';
  }

  const levelCounts = blocks.reduce((acc, block) => {
    const level = Number.isFinite(block.level) ? block.level : 1;
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, {});

  if ((levelCounts[0] || 0) >= 1 && (levelCounts[1] || 0) >= 2) {
    return 'topic_tree';
  }

  if (blocks.length <= 6) return 'mindmap';
  if (blocks.length >= 10) return 'process_flow';
  return 'timeline';
}

function parseJsonFromText(rawText) {
  const source = String(rawText || '').trim();
  if (!source) return null;

  try {
    return JSON.parse(source);
  } catch {
    // continue with fenced / embedded json extraction
  }

  const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // continue
    }
  }

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = source.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeBlocks(rawBlocks, detailLevel, sourceText) {
  const maxBlocks = DETAIL_LIMITS[detailLevel] || DETAIL_LIMITS.standard;
  const safeBlocks = Array.isArray(rawBlocks) ? rawBlocks : [];

  const normalized = [];
  const usedIds = new Set();

  for (let index = 0; index < safeBlocks.length; index += 1) {
    const block = safeBlocks[index];
    const source = typeof block === 'string' ? { title: block } : toPlainObject(block);

    const title = truncate(
      source.title || source.label || source.name || source.headline || source.text || `Punkt ${index + 1}`,
      60
    );

    const body = truncate(
      source.body || source.description || source.detail || source.summary || source.text || '',
      180
    );

    if (!title) continue;

    const baseId = slugify(source.id || title, `block-${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    let level = Number.parseInt(source.level, 10);
    if (!Number.isFinite(level)) level = index === 0 ? 0 : 1;
    level = clamp(level, 0, 3);

    normalized.push({
      id,
      title,
      body,
      group: truncate(source.group || source.category || source.column || '', 32),
      level,
      order: Number.isFinite(Number(source.order)) ? Number(source.order) : index,
      column: truncate(source.column || '', 24),
      illustration: {
        icon: normalizeIconType(source?.illustration?.icon || source?.icon || ''),
        motif: truncate(source?.illustration?.motif || source?.illustration_hint || source?.motif || '', 34),
        scene: normalizeSceneType(source?.illustration?.scene || source?.scene || ''),
      },
    });

    if (normalized.length >= maxBlocks) break;
  }

  if (normalized.length >= 3) {
    return normalized.sort((a, b) => a.order - b.order);
  }

  const fallbackSentences = dedupeStrings(extractSentences(sourceText), maxBlocks + 2);
  const fallbackBlocks = fallbackSentences.slice(0, maxBlocks).map((sentence, index) => ({
    id: `block-${index + 1}`,
    title: truncate(sentence, 58),
    body: '',
    group: '',
    level: index === 0 ? 0 : 1,
    order: index,
    column: '',
    illustration: { icon: 'document', motif: '', scene: 'generic' },
  }));

  if (fallbackBlocks.length > 0) return fallbackBlocks;

  return [
    {
      id: 'block-1',
      title: 'Kernaussage',
      body: truncate(sourceText, 160),
      group: '',
      level: 0,
      order: 0,
      column: '',
      illustration: { icon: 'document', motif: '', scene: 'generic' },
    },
  ];
}

function normalizeLinks(rawLinks, blocks) {
  const allowedIds = new Set(blocks.map((block) => block.id));
  const linksSource = Array.isArray(rawLinks) ? rawLinks : [];
  const normalized = [];
  const seen = new Set();

  for (const entry of linksSource) {
    const source = toPlainObject(entry);
    const from = normalizeWhitespace(source.from || source.von || source.source || '');
    const to = normalizeWhitespace(source.to || source.zu || source.target || '');

    if (!from || !to || from === to) continue;
    if (!allowedIds.has(from) || !allowedIds.has(to)) continue;

    const key = `${from}>>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      from,
      to,
      label: truncate(source.label || source.relation || '', 34),
    });
  }

  if (normalized.length > 0) return normalized;

  return blocks.slice(1).map((block, index) => ({
    from: blocks[index].id,
    to: block.id,
    label: '',
  }));
}

function normalizeStructureObject(rawObject, options) {
  const source = toPlainObject(rawObject);
  const sourceText = String(options?.text || '');
  const detailLevel = normalizeDetailLevel(options?.detailLevel);
  const requestedLayout = normalizeLayoutMode(options?.layoutMode);

  const rawBlocks = source.blocks || source.nodes || source.items || source.points || source.sections || [];
  const blocks = normalizeBlocks(rawBlocks, detailLevel, sourceText);
  const links = normalizeLinks(source.links || source.edges || source.connections || [], blocks);
  const layout = inferLayout(blocks, requestedLayout);

  const titleFallback = sourceText.split(/\n|[.!?]/).map((entry) => normalizeWhitespace(entry)).find(Boolean) || 'Infografik';

  return {
    title: truncate(source.title || source.titel || source.headline || titleFallback, 70),
    layout,
    summary: truncate(source.summary || source.zusammenfassung || '', 200),
    blocks,
    links,
  };
}

export function buildHeuristicStructure(text, options = {}) {
  const sourceText = String(text || '').trim();
  const detailLevel = normalizeDetailLevel(options.detailLevel);
  const requestedLayout = normalizeLayoutMode(options.layoutMode);
  const maxBlocks = DETAIL_LIMITS[detailLevel] || DETAIL_LIMITS.standard;

  const sentences = dedupeStrings(extractSentences(sourceText), maxBlocks + 4);
  const candidates = sentences.length > 0 ? sentences : [sourceText || 'Kerninhalt'];
  const blocks = candidates.slice(0, maxBlocks).map((entry, index) => ({
    id: `block-${index + 1}`,
    title: truncate(entry, 58),
    body: '',
    group: '',
    level: index === 0 ? 0 : (index <= 3 ? 1 : 2),
    order: index,
    column: '',
    illustration: {
      icon: inferIconTypeFromText(entry),
      motif: '',
      scene: inferSceneTypeFromText(entry),
    },
  }));

  const layout = inferLayout(blocks, requestedLayout);
  const links = blocks.slice(1).map((block, index) => ({
    from: blocks[index].id,
    to: block.id,
    label: '',
  }));

  const title = sourceText
    .split(/\n|[.!?]/)
    .map((entry) => normalizeWhitespace(entry))
    .find(Boolean) || 'Infografik';

  return {
    title: truncate(title, 70),
    layout,
    summary: '',
    blocks,
    links,
  };
}

export function parseAndNormalizeStructure(rawText, options = {}) {
  const parsed = parseJsonFromText(rawText);
  if (!parsed) {
    return buildHeuristicStructure(options.text || '', options);
  }
  return normalizeStructureObject(parsed, options);
}

export function buildIllustrationPrompt({ structure, focus = '', illustrationStyle = 'editorial' }) {
  const blocks = Array.isArray(structure?.blocks) ? structure.blocks : [];
  const normalizedStyle = normalizeIllustrationStyle(illustrationStyle);
  const summaryLines = blocks
    .slice(0, 24)
    .map((block) => {
      const title = truncate(block.title || '', 60);
      const body = truncate(block.body || '', 120);
      return `- id: ${block.id} | title: ${title} | body: ${body}`;
    });

  return [
    'You are an infographic illustrator planner.',
    'Task: assign one icon type, one scene type and one short motif per block.',
    'Output JSON only.',
    'Allowed icons: idea, gear, chart, timeline, people, document, warning, network, compare, check, question.',
    'Allowed scenes: generic, process, data, network, timeline, education, research, finance, healthcare, legal, communication, environment, technology, risk, decision, people, comparison.',
    `Global illustration style (strict): ${normalizedStyle}.`,
    String(focus || '').trim() ? `Focus context: ${truncate(String(focus || ''), 200)}` : '',
    'Schema:',
    '{',
    '  "illustrations": [',
    '    {',
    '      "id": "block-id",',
    '      "icon": "one-of-allowed-icons",',
    '      "scene": "one-of-allowed-scenes",',
    '      "motif": "very short motif (max 5 words)"',
    '    }',
    '  ]',
    '}',
    '',
    'Blocks:',
    ...summaryLines,
  ].filter(Boolean).join('\n');
}

export function applyIllustrationPlan(structure, rawPlanText = '', options = {}) {
  const normalized = normalizeStructureObject(structure, {
    text: options.text || '',
    detailLevel: options.detailLevel,
    layoutMode: structure?.layout,
  });

  const planObject = parseJsonFromText(rawPlanText);
  const planArray = Array.isArray(planObject?.illustrations) ? planObject.illustrations : [];
  const planById = new Map();

  for (const item of planArray) {
    const source = toPlainObject(item);
    const id = normalizeWhitespace(source.id || '');
    if (!id) continue;
    planById.set(id, {
      icon: normalizeIconType(source.icon || source.type || ''),
      scene: normalizeSceneType(source.scene || source.theme || ''),
      motif: truncate(source.motif || source.hint || source.label || '', 34),
    });
  }

  const blocks = normalized.blocks.map((block) => {
    const planned = planById.get(block.id);
    const textBundle = `${block.title} ${block.body} ${block.group}`;
    const fallbackIcon = inferIconTypeFromText(textBundle);
    const fallbackScene = inferSceneTypeFromText(textBundle);
    const icon = planned?.icon || fallbackIcon;
    const scene = planned?.scene || fallbackScene;
    const motif = planned?.motif || truncate(block.group || block.title, 26);

    return {
      ...block,
      illustration: {
        icon: normalizeIconType(icon),
        scene: normalizeSceneType(scene),
        motif,
      },
    };
  });

  return {
    ...normalized,
    blocks,
  };
}

export function buildStructurePrompt({ text, layoutMode, detailLevel, focus }) {
  const normalizedLayout = normalizeLayoutMode(layoutMode);
  const normalizedDetail = normalizeDetailLevel(detailLevel);
  const focusText = truncate(String(focus || '').trim(), 320);

  const layoutHintMap = {
    auto: 'Layout: AUTO (choose best fitting).',
    timeline: 'Layout: TIMELINE (strict).',
    process_flow: 'Layout: PROCESS_FLOW (strict).',
    comparison: 'Layout: COMPARISON (strict, two clear sides/columns).',
    mindmap: 'Layout: MINDMAP (strict, central concept + branches).',
    topic_tree: 'Layout: TOPIC_TREE (strict, hierarchical top-down).',
  };

  const detailHintMap = {
    compact: 'Detail level: COMPACT (few, very clear blocks).',
    standard: 'Detail level: STANDARD (balanced depth).',
    detailed: 'Detail level: DETAILED (more sub-points, still concise).',
  };

  return [
    'You are an information architect.',
    'Analyze the German source text and output ONLY valid JSON for a structured infographic.',
    layoutHintMap[normalizedLayout],
    detailHintMap[normalizedDetail],
    focusText ? `Focus (strict): ${focusText}` : '',
    'Hard rules:',
    '- Output JSON only, no markdown.',
    '- Keep labels concise and self-contained.',
    '- Respect semantic hierarchy: central ideas first, details below.',
    '- Use this exact schema:',
    '{',
    '  "title": "string",',
    '  "layout": "timeline|process_flow|comparison|mindmap|topic_tree",',
    '  "summary": "string",',
    '  "blocks": [',
    '    {',
    '      "id": "string",',
    '      "title": "string",',
    '      "body": "string",',
    '      "group": "string",',
    '      "level": 0,',
    '      "order": 0,',
    '      "column": "string",',
    '      "illustration_hint": "short visual hint (optional)"',
    '    }',
    '  ],',
    '  "links": [',
    '    { "from": "id", "to": "id", "label": "string" }',
    '  ]',
    '}',
    '',
    'Source text (German):',
    String(text || '').trim(),
  ].filter(Boolean).join('\n');
}

function buildColorMap(blocks) {
  const map = new Map();
  let pointer = 0;

  for (const block of blocks) {
    const key = block.group || `level-${block.level}`;
    if (map.has(key)) continue;
    map.set(key, GROUP_PALETTE[pointer % GROUP_PALETTE.length]);
    pointer += 1;
  }

  return map;
}

function keepInsideCanvas(x, y, width, height) {
  const fixedX = clamp(x, SAFE_LEFT, SAFE_RIGHT - width);
  const fixedY = clamp(y, SAFE_TOP, SAFE_BOTTOM - height);

  return { x: fixedX, y: fixedY, width, height };
}

function makeSequentialLinks(layoutItems) {
  if (layoutItems.length <= 1) return [];
  const links = [];
  for (let index = 1; index < layoutItems.length; index += 1) {
    links.push({
      from: layoutItems[index - 1].id,
      to: layoutItems[index].id,
      label: '',
    });
  }
  return links;
}

function buildIdMap(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function rectsOverlap(a, b, padding = 0) {
  return (
    a.x < (b.x + b.width + padding)
    && (a.x + a.width + padding) > b.x
    && a.y < (b.y + b.height + padding)
    && (a.y + a.height + padding) > b.y
  );
}

function resolveMindmapCollisions(items, centerX, centerY) {
  const adjusted = items.map((item) => ({ ...item }));
  if (adjusted.length <= 2) return adjusted;

  for (let iteration = 0; iteration < 10; iteration += 1) {
    let moved = false;

    for (let index = 1; index < adjusted.length; index += 1) {
      const current = adjusted[index];
      const centerOverlap = rectsOverlap(current, adjusted[0], 8);
      if (centerOverlap) {
        const currentCenterX = current.x + current.width / 2;
        const currentCenterY = current.y + current.height / 2;
        const vectorX = currentCenterX - centerX;
        const vectorY = currentCenterY - centerY;
        const distance = Math.hypot(vectorX, vectorY) || 1;
        current.x += (vectorX / distance) * 16;
        current.y += (vectorY / distance) * 16;
        Object.assign(current, keepInsideCanvas(current.x, current.y, current.width, current.height));
        moved = true;
      }
    }

    for (let i = 1; i < adjusted.length; i += 1) {
      for (let j = i + 1; j < adjusted.length; j += 1) {
        const a = adjusted[i];
        const b = adjusted[j];
        if (!rectsOverlap(a, b, 6)) continue;

        const bCenterX = b.x + b.width / 2;
        const bCenterY = b.y + b.height / 2;
        const vectorX = bCenterX - centerX;
        const vectorY = bCenterY - centerY;
        const distance = Math.hypot(vectorX, vectorY) || 1;
        b.x += (vectorX / distance) * 14;
        b.y += (vectorY / distance) * 14;
        Object.assign(b, keepInsideCanvas(b.x, b.y, b.width, b.height));
        moved = true;
      }
    }

    if (!moved) break;
  }

  return adjusted;
}

function resolveGlobalCollisions(items, padding = 10, maxIterations = 22, lockedIds = new Set()) {
  const adjusted = items.map((item) => ({ ...item }));
  if (adjusted.length <= 1) return adjusted;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let moved = false;

    for (let i = 0; i < adjusted.length; i += 1) {
      for (let j = i + 1; j < adjusted.length; j += 1) {
        const a = adjusted[i];
        const b = adjusted[j];
        if (!rectsOverlap(a, b, padding)) continue;

        const aCenterX = a.x + a.width / 2;
        const aCenterY = a.y + a.height / 2;
        const bCenterX = b.x + b.width / 2;
        const bCenterY = b.y + b.height / 2;
        let vectorX = bCenterX - aCenterX;
        let vectorY = bCenterY - aCenterY;
        if (Math.abs(vectorX) < 0.01 && Math.abs(vectorY) < 0.01) {
          vectorX = (i % 2 === 0 ? 1 : -1) * 0.8;
          vectorY = (j % 2 === 0 ? 1 : -1) * 0.6;
        }

        const distance = Math.hypot(vectorX, vectorY) || 1;
        const unitX = vectorX / distance;
        const unitY = vectorY / distance;
        const overlapX = ((a.width + b.width) / 2 + padding) - Math.abs(vectorX);
        const overlapY = ((a.height + b.height) / 2 + padding) - Math.abs(vectorY);
        const pushBase = Math.max(4, Math.min(20, Math.min(overlapX, overlapY) * 0.58));

        const aLocked = lockedIds.has(a.id);
        const bLocked = lockedIds.has(b.id);

        if (!aLocked && !bLocked) {
          a.x -= unitX * pushBase;
          a.y -= unitY * pushBase;
          b.x += unitX * pushBase;
          b.y += unitY * pushBase;
        } else if (!aLocked) {
          a.x -= unitX * pushBase * 1.45;
          a.y -= unitY * pushBase * 1.45;
        } else if (!bLocked) {
          b.x += unitX * pushBase * 1.45;
          b.y += unitY * pushBase * 1.45;
        } else {
          continue;
        }

        Object.assign(a, keepInsideCanvas(a.x, a.y, a.width, a.height));
        Object.assign(b, keepInsideCanvas(b.x, b.y, b.width, b.height));
        moved = true;
      }
    }

    if (!moved) break;
  }

  return adjusted;
}

function getContentDimensions() {
  return {
    width: CONTENT_RIGHT - CONTENT_LEFT,
    height: CONTENT_BOTTOM - CONTENT_TOP,
  };
}

function layoutTimeline(blocks) {
  const count = Math.max(1, blocks.length);
  const rows = count <= 6 ? 1 : (count <= 12 ? 2 : 3);
  const cols = Math.ceil(count / rows);
  const gapX = cols >= 6 ? 16 : 22;
  const gapY = rows >= 3 ? 20 : 28;
  const { width: contentWidth, height: contentHeight } = getContentDimensions();
  const width = Math.floor((contentWidth - (cols - 1) * gapX) / Math.max(1, cols));
  const rawHeight = Math.floor((contentHeight - (rows - 1) * gapY) / Math.max(1, rows));
  const height = Math.min(rows === 1 ? 170 : 145, rawHeight);
  const totalHeight = rows * height + Math.max(0, rows - 1) * gapY;
  const startY = CONTENT_TOP + Math.floor((contentHeight - totalHeight) / 2);
  const items = [];

  blocks.forEach((block, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const logicalCol = row % 2 === 1 ? (cols - 1 - col) : col;
    const x = CONTENT_LEFT + logicalCol * (width + gapX);
    const y = startY + row * (height + gapY);
    items.push({ ...block, ...keepInsideCanvas(x, y, width, height) });
  });

  return {
    items,
    links: makeSequentialLinks(items),
  };
}

function layoutProcessFlow(blocks) {
  const count = Math.max(1, blocks.length);
  const cols = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(count * 1.3))));
  const rows = Math.ceil(count / cols);
  const gapX = cols >= 5 ? 16 : 24;
  const gapY = rows >= 5 ? 10 : (rows >= 4 ? 14 : 22);
  const { width: contentWidth, height: contentHeight } = getContentDimensions();
  const width = Math.floor((contentWidth - (cols - 1) * gapX) / Math.max(1, cols));
  const rawHeight = Math.floor((contentHeight - (rows - 1) * gapY) / Math.max(1, rows));
  const height = Math.min(170, rawHeight);
  const totalHeight = rows * height + Math.max(0, rows - 1) * gapY;
  const startY = CONTENT_TOP + Math.floor((contentHeight - totalHeight) / 2);

  const items = blocks.map((block, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const isOddRow = row % 2 === 1;
    const logicalCol = isOddRow ? (cols - 1 - col) : col;
    const x = CONTENT_LEFT + logicalCol * (width + gapX);
    const y = startY + row * (height + gapY);
    return { ...block, ...keepInsideCanvas(x, y, width, height) };
  });

  return {
    items,
    links: makeSequentialLinks(items),
  };
}

function layoutComparison(blocks) {
  const left = [];
  const right = [];

  const groupValues = [...new Set(blocks.map((block) => (block.group || '').toLowerCase()).filter(Boolean))];
  const leftKeywords = new Set(['pro', 'vorteile', 'links', 'left', 'a']);

  blocks.forEach((block, index) => {
    const groupKey = (block.group || '').toLowerCase();
    const preferredLeft = groupValues.length >= 2
      ? leftKeywords.has(groupKey) || groupKey === groupValues[0]
      : index % 2 === 0;
    if (preferredLeft) left.push(block);
    else right.push(block);
  });

  if (right.length === 0 && left.length > 1) {
    while (left.length - right.length > 1) {
      right.push(left.pop());
    }
  }

  const maxRows = Math.max(left.length, right.length, 1);
  const { width: contentWidth, height: contentHeight } = getContentDimensions();
  const splitGap = 28;
  const width = Math.floor((contentWidth - splitGap) / 2);
  const gapY = maxRows >= 8 ? 8 : (maxRows >= 6 ? 12 : 18);
  const rawHeight = Math.floor((contentHeight - (maxRows - 1) * gapY) / maxRows);
  const height = Math.min(maxRows <= 4 ? 160 : 136, rawHeight);
  const usedHeight = maxRows * height + Math.max(0, maxRows - 1) * gapY;
  const top = CONTENT_TOP + Math.floor((contentHeight - usedHeight) / 2);
  const leftX = CONTENT_LEFT;
  const rightX = CONTENT_LEFT + width + splitGap;

  const items = [
    ...left.map((block, index) => ({ ...block, ...keepInsideCanvas(leftX, top + index * (height + gapY), width, height), column: 'left' })),
    ...right.map((block, index) => ({ ...block, ...keepInsideCanvas(rightX, top + index * (height + gapY), width, height), column: 'right' })),
  ];

  return {
    items,
    links: [],
  };
}

function layoutMindmap(blocks) {
  const center = blocks[0];
  const others = blocks.slice(1);
  const centerX = CANVAS_WIDTH / 2;
  const centerY = 585;
  const centerWidth = 420;
  const centerHeight = 190;
  const centerItem = {
    ...center,
    ...keepInsideCanvas(centerX - centerWidth / 2, centerY - centerHeight / 2, centerWidth, centerHeight),
  };

  const items = [centerItem];
  const nodeWidth = others.length >= 12 ? 220 : (others.length >= 8 ? 240 : 270);
  const nodeHeight = others.length >= 12 ? 102 : 122;
  const maxRx = Math.min(SAFE_RIGHT - centerX - nodeWidth / 2 - 20, centerX - SAFE_LEFT - nodeWidth / 2 - 20);
  const maxRy = Math.min(SAFE_BOTTOM - centerY - nodeHeight / 2 - 20, centerY - SAFE_TOP - nodeHeight / 2 - 20);
  const minRx = centerWidth / 2 + nodeWidth / 2 + 40;
  const minRy = centerHeight / 2 + nodeHeight / 2 + 30;
  const ringCount = Math.max(1, Math.ceil(others.length / 6));

  const ringCapacities = [];
  let remaining = others.length;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const ringsLeft = ringCount - ring;
    const capacity = Math.ceil(remaining / ringsLeft);
    ringCapacities.push(capacity);
    remaining -= capacity;
  }

  let offset = 0;
  ringCapacities.forEach((capacity, ringIndex) => {
    const ringFactor = ringCount === 1 ? 1 : (ringIndex / Math.max(1, ringCount - 1));
    const rx = minRx + ((maxRx - minRx) * ringFactor);
    const ry = minRy + ((maxRy - minRy) * ringFactor);
    const angleOffset = ringIndex % 2 === 1 ? (Math.PI / Math.max(1, capacity)) : 0;
    for (let index = 0; index < capacity; index += 1) {
      const block = others[offset + index];
      if (!block) continue;
      const angle = ((Math.PI * 2) / Math.max(1, capacity)) * index - (Math.PI / 2) + angleOffset;
      const x = centerX + rx * Math.cos(angle) - nodeWidth / 2;
      const y = centerY + ry * Math.sin(angle) - nodeHeight / 2;
      items.push({ ...block, ...keepInsideCanvas(x, y, nodeWidth, nodeHeight) });
    }
    offset += capacity;
  });

  const resolvedItems = resolveMindmapCollisions(items, centerX, centerY);

  const links = resolvedItems.slice(1).map((block) => ({
    from: centerItem.id,
    to: block.id,
    label: '',
  }));

  return { items: resolvedItems, links };
}

function layoutTopicTree(blocks) {
  const byLevel = new Map();
  blocks.forEach((block) => {
    const level = Number.isFinite(block.level) ? block.level : 1;
    const key = clamp(level, 0, 3);
    const current = byLevel.get(key) || [];
    current.push(block);
    byLevel.set(key, current);
  });

  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const items = [];
  const { width: contentWidth, height: contentHeight } = getContentDimensions();
  const rowCount = Math.max(levels.length, 1);
  const gapY = rowCount >= 4 ? 16 : 24;
  const baseHeight = Math.floor((contentHeight - (rowCount - 1) * gapY) / rowCount);
  const top = CONTENT_TOP + Math.floor((contentHeight - (rowCount * baseHeight + Math.max(0, rowCount - 1) * gapY)) / 2);

  levels.forEach((level, rowIndex) => {
    const row = byLevel.get(level) || [];
    const count = row.length;
    const gapX = count >= 8 ? 10 : 18;
    const widthRaw = Math.floor((contentWidth - (Math.max(0, count - 1) * gapX)) / Math.max(1, count));
    const widthCap = count <= 1 ? 760 : (count <= 3 ? 520 : 420);
    const widthFloor = count <= 1 ? 360 : 120;
    const width = clamp(Math.min(widthRaw, widthCap), widthFloor, widthCap);
    const height = level === 0 ? Math.min(170, baseHeight) : Math.min(144, baseHeight);
    const total = count * width + Math.max(0, count - 1) * gapX;
    const startX = CONTENT_LEFT + Math.floor((contentWidth - total) / 2);
    const y = top + rowIndex * (baseHeight + gapY);

    row.forEach((block, index) => {
      const x = startX + index * (width + gapX);
      items.push({ ...block, ...keepInsideCanvas(x, y, width, height) });
    });
  });

  const links = [];
  for (const item of items) {
    if (item.level <= 0) continue;
    const parentLevel = item.level - 1;
    const candidates = items.filter((entry) => entry.level === parentLevel);
    if (candidates.length === 0) continue;
    const itemCenter = item.x + item.width / 2;
    let parent = candidates[0];
    let minDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = Math.abs((candidate.x + candidate.width / 2) - itemCenter);
      if (distance < minDistance) {
        minDistance = distance;
        parent = candidate;
      }
    }
    if (!parent) continue;
    links.push({ from: parent.id, to: item.id, label: '' });
  }

  return {
    items,
    links,
  };
}

function resolveLayout(structure) {
  const blocks = [...(structure.blocks || [])].sort((a, b) => a.order - b.order);
  if (blocks.length === 0) {
    blocks.push({
      id: 'block-1',
      title: 'Kernpunkt',
      body: '',
      group: '',
      level: 0,
      order: 0,
      column: '',
    });
  }

  let layoutResult;
  switch (structure.layout) {
    case 'timeline':
      layoutResult = layoutTimeline(blocks);
      break;
    case 'comparison':
      layoutResult = layoutComparison(blocks);
      break;
    case 'mindmap':
      layoutResult = layoutMindmap(blocks);
      break;
    case 'topic_tree':
      layoutResult = layoutTopicTree(blocks);
      break;
    case 'process_flow':
    default:
      layoutResult = layoutProcessFlow(blocks);
      break;
  }

  const lockCenter = structure.layout === 'mindmap' && layoutResult.items?.[0]?.id
    ? new Set([layoutResult.items[0].id])
    : new Set();
  const collisionPadding = structure.layout === 'comparison' ? 6 : 10;
  const collisionIterations = structure.layout === 'mindmap' ? 14 : 22;

  return {
    ...layoutResult,
    items: resolveGlobalCollisions(layoutResult.items || [], collisionPadding, collisionIterations, lockCenter),
  };
}

function makeConnectionsSvg(links, idMap) {
  if (!Array.isArray(links) || links.length === 0) return '';

  return links.map((link) => {
    const from = idMap.get(link.from);
    const to = idMap.get(link.to);
    if (!from || !to) return '';

    const x1 = from.x + from.width / 2;
    const y1 = to.y >= from.y ? from.y + from.height - 8 : from.y + 8;
    const x2 = to.x + to.width / 2;
    const y2 = to.y >= from.y ? to.y + 8 : to.y + to.height - 8;
    const direction = y2 >= y1 ? 1 : -1;
    const bend = clamp(Math.abs(y2 - y1) * 0.45, 26, 110);
    const path = `M ${x1} ${y1} C ${x1} ${y1 + (bend * direction)} ${x2} ${y2 - (bend * direction)} ${x2} ${y2}`;
    const label = truncate(link.label || '', 24);

    return `
      <path d="${path}" stroke="rgba(15,23,42,0.32)" stroke-width="2.4" fill="none" marker-end="url(#arrow)" />
      ${label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" font-size="13" fill="#334155">${escapeXml(label)}</text>` : ''}
    `;
  }).join('');
}

function makeIconGlyph(iconType, x, y, size, color) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const pad = size * 0.2;
  const left = x + pad;
  const right = x + size - pad;
  const top = y + pad;
  const bottom = y + size - pad;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const stroke = `stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

  switch (iconType) {
    case 'idea':
      return `
        <circle cx="${midX}" cy="${midY - 2}" r="${(right - left) * 0.34}" ${stroke} />
        <path d="M ${midX - 6} ${bottom - 3} L ${midX + 6} ${bottom - 3}" ${stroke} />
      `;
    case 'gear':
      return `
        <circle cx="${midX}" cy="${midY}" r="${(right - left) * 0.36}" ${stroke} />
        <circle cx="${midX}" cy="${midY}" r="${(right - left) * 0.12}" ${stroke} />
        <path d="M ${midX} ${top} L ${midX} ${top + 6} M ${midX} ${bottom - 6} L ${midX} ${bottom}" ${stroke} />
      `;
    case 'chart':
      return `
        <path d="M ${left} ${bottom} L ${left} ${top} L ${right} ${top}" ${stroke} />
        <path d="M ${left + 4} ${bottom - 4} L ${midX - 3} ${midY + 2} L ${right - 4} ${top + 8}" ${stroke} />
      `;
    case 'timeline':
      return `
        <path d="M ${left} ${midY} L ${right} ${midY}" ${stroke} />
        <circle cx="${left + 4}" cy="${midY}" r="2.3" fill="${color}" />
        <circle cx="${midX}" cy="${midY}" r="2.3" fill="${color}" />
        <circle cx="${right - 4}" cy="${midY}" r="2.3" fill="${color}" />
      `;
    case 'people':
      return `
        <circle cx="${midX - 6}" cy="${top + 8}" r="4" ${stroke} />
        <circle cx="${midX + 6}" cy="${top + 10}" r="3.5" ${stroke} />
        <path d="M ${left + 3} ${bottom - 4} Q ${midX - 6} ${midY + 6} ${midX + 1} ${bottom - 4}" ${stroke} />
      `;
    case 'warning':
      return `
        <path d="M ${midX} ${top} L ${right} ${bottom} L ${left} ${bottom} Z" ${stroke} />
        <path d="M ${midX} ${top + 9} L ${midX} ${midY + 2}" ${stroke} />
        <circle cx="${midX}" cy="${bottom - 7}" r="1.8" fill="${color}" />
      `;
    case 'network':
      return `
        <circle cx="${left + 4}" cy="${midY + 1}" r="2.7" fill="${color}" />
        <circle cx="${midX}" cy="${top + 5}" r="2.7" fill="${color}" />
        <circle cx="${right - 4}" cy="${bottom - 4}" r="2.7" fill="${color}" />
        <path d="M ${left + 4} ${midY + 1} L ${midX} ${top + 5} L ${right - 4} ${bottom - 4} L ${left + 4} ${midY + 1}" ${stroke} />
      `;
    case 'compare':
      return `
        <rect x="${left}" y="${top}" width="${(right - left) / 2 - 2}" height="${bottom - top}" rx="3" ${stroke} />
        <rect x="${midX + 2}" y="${top}" width="${(right - left) / 2 - 2}" height="${bottom - top}" rx="3" ${stroke} />
      `;
    case 'check':
      return `
        <path d="M ${left} ${midY} L ${midX - 3} ${bottom - 4} L ${right} ${top + 2}" ${stroke} />
      `;
    case 'question':
      return `
        <path d="M ${left + 4} ${top + 7} Q ${midX} ${top - 1} ${right - 4} ${top + 8} Q ${right - 4} ${midY} ${midX} ${midY}" ${stroke} />
        <circle cx="${midX}" cy="${bottom - 6}" r="2" fill="${color}" />
      `;
    case 'document':
    default:
      return `
        <rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" rx="3" ${stroke} />
        <path d="M ${left + 5} ${top + 7} L ${right - 5} ${top + 7} M ${left + 5} ${midY} L ${right - 5} ${midY}" ${stroke} />
      `;
  }
}

function getIllustrationStyleProfile(styleVariant) {
  const style = normalizeIllustrationStyle(styleVariant);
  if (style === 'technical') {
    return {
      style,
      strokeWidth: 2.45,
      softOpacity: 0.11,
      strongOpacity: 0.2,
      panelOpacity: 0.06,
      circleOpacity: 0.08,
      motifFontSize: 11,
      roundedPanel: 10,
      drawGrid: true,
      showExtraDetail: true,
    };
  }
  if (style === 'minimal') {
    return {
      style,
      strokeWidth: 1.7,
      softOpacity: 0.08,
      strongOpacity: 0.14,
      panelOpacity: 0.04,
      circleOpacity: 0.06,
      motifFontSize: 11,
      roundedPanel: 18,
      drawGrid: false,
      showExtraDetail: false,
    };
  }

  return {
    style: 'editorial',
    strokeWidth: 2.2,
    softOpacity: 0.16,
    strongOpacity: 0.24,
    panelOpacity: 0.08,
    circleOpacity: 0.16,
    motifFontSize: 12,
    roundedPanel: 14,
    drawGrid: false,
    showExtraDetail: true,
  };
}

function makeThematicIllustration(sceneType, iconType, x, y, width, height, color, styleVariant = 'editorial') {
  const profile = getIllustrationStyleProfile(styleVariant);
  const left = x;
  const top = y;
  const right = x + width;
  const bottom = y + height;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const innerPad = Math.max(3, width * 0.09);
  const innerLeft = left + innerPad;
  const innerRight = right - innerPad;
  const innerTop = top + innerPad;
  const innerBottom = bottom - innerPad;
  const stroke = `stroke="${color}" stroke-width="${profile.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const strokePaint = `stroke="${color}" stroke-width="${profile.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  const fillSoft = `fill="${color}" fill-opacity="${profile.softOpacity}"`;
  const fillStrong = `fill="${color}" fill-opacity="${profile.strongOpacity}"`;
  const detail = profile.showExtraDetail;

  switch (sceneType) {
    case 'process':
      return `
        <circle cx="${innerLeft + 8}" cy="${midY}" r="6" ${fillStrong} />
        <circle cx="${midX}" cy="${midY}" r="7" ${fillSoft} ${strokePaint} />
        <circle cx="${innerRight - 8}" cy="${midY}" r="6" ${fillStrong} />
        <path d="M ${innerLeft + 16} ${midY} L ${midX - 9} ${midY} M ${midX + 9} ${midY} L ${innerRight - 16} ${midY}" ${stroke} />
        <path d="M ${midX - 5} ${midY - 6} L ${midX} ${midY} L ${midX - 5} ${midY + 6}" ${stroke} />
      `;
    case 'data':
      return `
        <path d="M ${innerLeft} ${innerBottom} L ${innerRight} ${innerBottom}" ${stroke} />
        <rect x="${innerLeft + 2}" y="${innerBottom - 10}" width="8" height="10" rx="2" ${fillStrong} />
        <rect x="${innerLeft + 14}" y="${innerBottom - 17}" width="8" height="17" rx="2" ${fillStrong} />
        <rect x="${innerLeft + 26}" y="${innerBottom - 24}" width="8" height="24" rx="2" ${fillStrong} />
        ${detail ? `<path d="M ${innerLeft + 2} ${innerBottom - 13} L ${innerLeft + 18} ${innerBottom - 22} L ${innerLeft + 30} ${innerBottom - 18} L ${innerRight - 2} ${innerTop + 6}" ${stroke} />` : ''}
      `;
    case 'network':
      return `
        <circle cx="${innerLeft + 6}" cy="${midY + 6}" r="3.6" ${fillStrong} />
        <circle cx="${midX}" cy="${innerTop + 4}" r="3.6" ${fillStrong} />
        <circle cx="${innerRight - 7}" cy="${midY + 1}" r="3.6" ${fillStrong} />
        <circle cx="${midX - 3}" cy="${innerBottom - 4}" r="3.6" ${fillStrong} />
        <path d="M ${innerLeft + 6} ${midY + 6} L ${midX} ${innerTop + 4} L ${innerRight - 7} ${midY + 1} L ${midX - 3} ${innerBottom - 4} Z" ${stroke} />
      `;
    case 'timeline':
      return `
        <path d="M ${innerLeft} ${midY} L ${innerRight} ${midY}" ${stroke} />
        <circle cx="${innerLeft + 5}" cy="${midY}" r="2.8" ${fillStrong} />
        <circle cx="${midX}" cy="${midY}" r="2.8" ${fillStrong} />
        <circle cx="${innerRight - 5}" cy="${midY}" r="2.8" ${fillStrong} />
        <path d="M ${midX} ${midY - 10} L ${midX} ${midY - 20} L ${midX + 10} ${midY - 16} Z" ${fillStrong} />
      `;
    case 'education':
      return `
        <path d="M ${innerLeft} ${innerBottom - 4} Q ${midX} ${innerBottom - 12} ${innerRight} ${innerBottom - 4} L ${innerRight} ${innerTop + 8} Q ${midX} ${innerTop} ${innerLeft} ${innerTop + 8} Z" ${fillSoft} ${strokePaint} />
        <path d="M ${midX} ${innerTop + 2} L ${midX} ${innerBottom - 10}" ${stroke} />
      `;
    case 'research':
      return `
        <circle cx="${midX - 4}" cy="${midY - 2}" r="9" ${stroke} />
        ${detail ? `<path d="M ${midX + 4} ${midY + 6} L ${midX + 13} ${midY + 15}" ${stroke} />` : ''}
        ${detail ? `<path d="M ${innerLeft + 4} ${innerTop + 7} L ${innerLeft + 8} ${innerTop + 7} M ${innerLeft + 6} ${innerTop + 5} L ${innerLeft + 6} ${innerTop + 9}" ${stroke} />` : ''}
      `;
    case 'finance':
      return `
        <rect x="${innerLeft + 2}" y="${innerBottom - 12}" width="7" height="12" rx="2" ${fillStrong} />
        <rect x="${innerLeft + 12}" y="${innerBottom - 18}" width="7" height="18" rx="2" ${fillStrong} />
        <rect x="${innerLeft + 22}" y="${innerBottom - 24}" width="7" height="24" rx="2" ${fillStrong} />
        <circle cx="${innerRight - 9}" cy="${innerTop + 11}" r="8" ${fillSoft} ${strokePaint} />
        <text x="${innerRight - 9}" y="${innerTop + 15}" text-anchor="middle" font-size="8" fill="${color}">EUR</text>
      `;
    case 'healthcare':
      return `
        <rect x="${midX - 4}" y="${innerTop + 3}" width="8" height="20" rx="2" ${fillStrong} />
        <rect x="${midX - 10}" y="${innerTop + 9}" width="20" height="8" rx="2" ${fillStrong} />
        <path d="M ${innerLeft + 2} ${innerBottom - 8} Q ${innerLeft + 8} ${innerBottom - 14} ${innerLeft + 14} ${innerBottom - 8} Q ${innerLeft + 18} ${innerBottom - 3} ${innerLeft + 14} ${innerBottom}" ${stroke} />
      `;
    case 'legal':
      return `
        <path d="M ${midX} ${innerTop + 2} L ${midX} ${innerBottom - 2}" ${stroke} />
        <path d="M ${innerLeft + 4} ${innerTop + 8} L ${innerRight - 4} ${innerTop + 8}" ${stroke} />
        <path d="M ${innerLeft + 7} ${innerTop + 8} L ${innerLeft + 2} ${innerTop + 16} L ${innerLeft + 12} ${innerTop + 16} Z" ${fillSoft} ${strokePaint} />
        <path d="M ${innerRight - 7} ${innerTop + 8} L ${innerRight - 12} ${innerTop + 16} L ${innerRight - 2} ${innerTop + 16} Z" ${fillSoft} ${strokePaint} />
        <rect x="${midX - 10}" y="${innerBottom - 3}" width="20" height="3" rx="2" ${fillStrong} />
      `;
    case 'communication':
      return `
        <rect x="${innerLeft + 1}" y="${innerTop + 4}" width="20" height="14" rx="5" ${fillSoft} ${strokePaint} />
        <path d="M ${innerLeft + 7} ${innerTop + 18} L ${innerLeft + 10} ${innerTop + 22} L ${innerLeft + 12} ${innerTop + 18}" ${fillSoft} ${strokePaint} />
        <rect x="${innerLeft + 16}" y="${innerTop + 14}" width="20" height="14" rx="5" ${fillSoft} ${strokePaint} />
      `;
    case 'environment':
      return `
        <circle cx="${innerRight - 8}" cy="${innerTop + 7}" r="5" ${fillStrong} />
        <path d="M ${innerLeft + 2} ${innerBottom - 2} Q ${midX} ${innerBottom - 11} ${innerRight - 1} ${innerBottom - 2}" ${fillSoft} ${strokePaint} />
        <path d="M ${midX - 5} ${midY + 5} Q ${midX + 2} ${midY - 3} ${midX + 9} ${midY + 5} Q ${midX + 2} ${midY + 13} ${midX - 5} ${midY + 5}" ${fillSoft} ${strokePaint} />
      `;
    case 'technology':
      return `
        <rect x="${midX - 11}" y="${midY - 11}" width="22" height="22" rx="4" ${fillSoft} ${strokePaint} />
        ${detail ? `<path d="M ${midX - 15} ${midY - 6} L ${midX - 11} ${midY - 6} M ${midX - 15} ${midY} L ${midX - 11} ${midY} M ${midX - 15} ${midY + 6} L ${midX - 11} ${midY + 6}" ${stroke} />` : ''}
        ${detail ? `<path d="M ${midX + 11} ${midY - 6} L ${midX + 15} ${midY - 6} M ${midX + 11} ${midY} L ${midX + 15} ${midY} M ${midX + 11} ${midY + 6} L ${midX + 15} ${midY + 6}" ${stroke} />` : ''}
      `;
    case 'risk':
      return `
        <path d="M ${midX} ${innerTop + 2} L ${innerRight - 3} ${innerBottom - 2} L ${innerLeft + 3} ${innerBottom - 2} Z" ${fillSoft} ${strokePaint} />
        <path d="M ${midX} ${innerTop + 10} L ${midX} ${innerBottom - 10}" ${stroke} />
        <circle cx="${midX}" cy="${innerBottom - 6}" r="1.8" fill="${color}" />
      `;
    case 'decision':
      return `
        <path d="M ${midX} ${innerBottom - 3} L ${midX} ${innerTop + 8} M ${midX} ${innerTop + 8} L ${innerLeft + 6} ${innerTop + 2} M ${midX} ${innerTop + 8} L ${innerRight - 6} ${innerTop + 2}" ${stroke} />
        <path d="M ${innerLeft + 6} ${innerTop + 2} L ${innerLeft + 10} ${innerTop + 2}" ${stroke} />
        <path d="M ${innerRight - 6} ${innerTop + 2} L ${innerRight - 10} ${innerTop + 2}" ${stroke} />
      `;
    case 'people':
      return `
        <circle cx="${midX - 9}" cy="${innerTop + 9}" r="4" ${fillStrong} />
        <circle cx="${midX + 9}" cy="${innerTop + 9}" r="4" ${fillStrong} />
        <circle cx="${midX}" cy="${innerTop + 6}" r="4.5" ${fillStrong} />
        <path d="M ${innerLeft + 4} ${innerBottom - 3} Q ${midX} ${midY + 5} ${innerRight - 4} ${innerBottom - 3}" ${stroke} />
      `;
    case 'comparison':
      return `
        <rect x="${innerLeft + 1}" y="${innerTop + 2}" width="13" height="22" rx="3" ${fillSoft} ${strokePaint} />
        <rect x="${innerRight - 14}" y="${innerTop + 2}" width="13" height="22" rx="3" ${fillSoft} ${strokePaint} />
        <path d="M ${innerLeft + 17} ${midY} L ${innerRight - 17} ${midY}" ${stroke} />
      `;
    case 'generic':
    default: {
      const iconSize = Math.max(22, Math.min(width, height) - 10);
      const iconX = x + ((width - iconSize) / 2);
      const iconY = y + ((height - iconSize) / 2);
      return `
        ${makeIconGlyph(iconType, iconX, iconY, iconSize, color)}
      `;
    }
  }
}

function makeSceneBackdrop(sceneType, x, y, width, height, color) {
  const left = x;
  const top = y;
  const right = x + width;
  const bottom = y + height;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  const softFill = `fill="${color}" fill-opacity="0.12"`;
  const mediumFill = `fill="${color}" fill-opacity="0.18"`;
  const lightStroke = `stroke="${color}" stroke-opacity="0.3" stroke-width="1.1" fill="none"`;

  switch (sceneType) {
    case 'process':
      return `
        <rect x="${left + 3}" y="${midY - 16}" width="16" height="12" rx="4" ${softFill} />
        <rect x="${midX - 8}" y="${midY - 6}" width="16" height="12" rx="4" ${softFill} />
        <rect x="${right - 19}" y="${midY + 4}" width="16" height="12" rx="4" ${softFill} />
        <path d="M ${left + 20} ${midY - 10} L ${midX - 9} ${midY} L ${right - 20} ${midY + 10}" ${lightStroke} />
      `;
    case 'data':
      return `
        <path d="M ${left + 2} ${bottom - 5} L ${right - 2} ${bottom - 5}" ${lightStroke} />
        <rect x="${left + 6}" y="${bottom - 17}" width="8" height="12" rx="2" ${mediumFill} />
        <rect x="${left + 20}" y="${bottom - 22}" width="8" height="17" rx="2" ${mediumFill} />
        <rect x="${left + 34}" y="${bottom - 27}" width="8" height="22" rx="2" ${mediumFill} />
        <path d="M ${left + 6} ${bottom - 24} Q ${midX - 2} ${top + 3} ${right - 5} ${top + 10}" ${lightStroke} />
      `;
    case 'network':
      return `
        <circle cx="${left + 8}" cy="${midY + 6}" r="2.5" ${mediumFill} />
        <circle cx="${midX}" cy="${top + 7}" r="2.5" ${mediumFill} />
        <circle cx="${right - 8}" cy="${midY + 2}" r="2.5" ${mediumFill} />
        <circle cx="${midX - 4}" cy="${bottom - 7}" r="2.5" ${mediumFill} />
        <path d="M ${left + 8} ${midY + 6} L ${midX} ${top + 7} L ${right - 8} ${midY + 2} L ${midX - 4} ${bottom - 7} Z" ${lightStroke} />
      `;
    case 'timeline':
      return `
        <path d="M ${left + 3} ${midY} L ${right - 3} ${midY}" ${lightStroke} />
        <circle cx="${left + 7}" cy="${midY}" r="2.1" ${mediumFill} />
        <circle cx="${midX}" cy="${midY}" r="2.1" ${mediumFill} />
        <circle cx="${right - 7}" cy="${midY}" r="2.1" ${mediumFill} />
      `;
    case 'comparison':
      return `
        <rect x="${left + 4}" y="${top + 5}" width="${Math.max(8, (width / 2) - 7)}" height="${Math.max(12, height - 10)}" rx="4" ${softFill} />
        <rect x="${midX + 3}" y="${top + 5}" width="${Math.max(8, (width / 2) - 7)}" height="${Math.max(12, height - 10)}" rx="4" ${softFill} />
      `;
    case 'people':
      return `
        <circle cx="${midX - 8}" cy="${top + 10}" r="3.2" ${mediumFill} />
        <circle cx="${midX + 8}" cy="${top + 11}" r="3" ${mediumFill} />
        <circle cx="${midX}" cy="${top + 8}" r="3.5" ${mediumFill} />
        <path d="M ${left + 4} ${bottom - 6} Q ${midX} ${midY + 2} ${right - 4} ${bottom - 6}" ${lightStroke} />
      `;
    case 'environment':
      return `
        <path d="M ${left + 3} ${bottom - 4} Q ${midX} ${bottom - 12} ${right - 3} ${bottom - 4}" ${softFill} />
        <circle cx="${right - 8}" cy="${top + 7}" r="4" ${mediumFill} />
      `;
    case 'technology':
      return `
        <rect x="${midX - 10}" y="${midY - 10}" width="20" height="20" rx="4" ${softFill} />
        <path d="M ${midX - 14} ${midY - 4} L ${midX - 10} ${midY - 4} M ${midX - 14} ${midY + 2} L ${midX - 10} ${midY + 2} M ${midX + 10} ${midY - 4} L ${midX + 14} ${midY - 4} M ${midX + 10} ${midY + 2} L ${midX + 14} ${midY + 2}" ${lightStroke} />
      `;
    case 'risk':
      return `
        <path d="M ${midX} ${top + 4} L ${right - 4} ${bottom - 5} L ${left + 4} ${bottom - 5} Z" ${softFill} />
      `;
    case 'decision':
      return `
        <path d="M ${midX} ${bottom - 4} L ${midX} ${top + 8} M ${midX} ${top + 8} L ${left + 6} ${top + 3} M ${midX} ${top + 8} L ${right - 6} ${top + 3}" ${lightStroke} />
      `;
    case 'legal':
      return `
        <path d="M ${midX} ${top + 3} L ${midX} ${bottom - 4}" ${lightStroke} />
        <path d="M ${left + 4} ${top + 10} L ${right - 4} ${top + 10}" ${lightStroke} />
      `;
    case 'healthcare':
      return `
        <rect x="${midX - 4}" y="${top + 4}" width="8" height="18" rx="2" ${mediumFill} />
        <rect x="${midX - 10}" y="${top + 10}" width="20" height="8" rx="2" ${mediumFill} />
      `;
    case 'finance':
      return `
        <rect x="${left + 6}" y="${bottom - 16}" width="7" height="11" rx="2" ${mediumFill} />
        <rect x="${left + 16}" y="${bottom - 21}" width="7" height="16" rx="2" ${mediumFill} />
        <rect x="${left + 26}" y="${bottom - 26}" width="7" height="21" rx="2" ${mediumFill} />
      `;
    case 'education':
      return `
        <path d="M ${left + 3} ${bottom - 5} Q ${midX} ${bottom - 12} ${right - 3} ${bottom - 5} L ${right - 3} ${top + 9} Q ${midX} ${top + 3} ${left + 3} ${top + 9} Z" ${softFill} />
      `;
    case 'research':
      return `
        <circle cx="${midX - 3}" cy="${midY - 1}" r="8.5" ${softFill} />
        <path d="M ${midX + 4} ${midY + 7} L ${midX + 12} ${bottom - 2}" ${lightStroke} />
      `;
    case 'communication':
      return `
        <rect x="${left + 4}" y="${top + 6}" width="18" height="12" rx="4" ${softFill} />
        <rect x="${midX + 2}" y="${midY - 1}" width="18" height="12" rx="4" ${softFill} />
      `;
    case 'generic':
    default:
      return `
        <path d="M ${left + 3} ${bottom - 5} L ${midX - 5} ${top + 7} L ${right - 5} ${bottom - 5} Z" ${softFill} />
        <circle cx="${right - 8}" cy="${top + 7}" r="3.5" ${mediumFill} />
      `;
  }
}

function estimateCharsPerLine(pixelWidth, fontSize) {
  const safeWidth = Math.max(72, Number(pixelWidth) || 72);
  const safeFont = Math.max(10, Number(fontSize) || 10);
  return clamp(Math.floor(safeWidth / (safeFont * 0.58)), 8, 64);
}

function toTextLinesSvg(lines, { x, startY, lineHeight, color, fontSize, fontWeight = '400', textAnchor = 'start' }) {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  return lines
    .map((line, index) => (
      `<text x="${x}" y="${startY + (index * lineHeight)}" text-anchor="${textAnchor}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}">${escapeXml(line)}</text>`
    ))
    .join('');
}

function makeBlockSvg(block, color, styleVariant = 'editorial') {
  const profile = getIllustrationStyleProfile(styleVariant);
  const iconType = normalizeIconType(block?.illustration?.icon || '');
  const sceneType = normalizeSceneType(block?.illustration?.scene || '');
  const iconMotif = truncate(block?.illustration?.motif || '', 26);
  const groupLabel = truncate(block?.group || '', 24);
  const paddingX = 22;
  const topPadding = 18;
  const bottomPadding = 16;
  const iconSize = clamp(Math.round(Math.min(block.width, block.height) * 0.38), 40, 82);
  const iconPanelWidth = iconSize + 30;
  const iconX = block.x + block.width - iconSize - 20;
  const iconY = block.y + 16;
  const textX = block.x + paddingX;
  const textRight = block.x + block.width - iconPanelWidth - 14;
  const textWidth = Math.max(90, textRight - textX);
  const blockSlug = slugify(block?.id || block?.title || 'block', 'block');
  const cardGradientId = `card-grad-${blockSlug}`;
  const accentGradientId = `accent-grad-${blockSlug}`;
  const iconGradientId = `icon-grad-${blockSlug}`;
  const photoClipId = `photo-clip-${blockSlug}`;
  const photoUrl = buildScenePhotoUrl({
    sceneType,
    iconType,
    motif: iconMotif,
    id: block?.id || blockSlug,
  });
  const showGroupLabel = Boolean(groupLabel) && textWidth > 120;
  const groupPillWidth = showGroupLabel
    ? clamp(Math.round((groupLabel.length * 7.1) + 20), 52, Math.max(52, Math.floor(textWidth - 6)))
    : 0;
  const groupYOffset = showGroupLabel ? 24 : 0;

  const titleFont = clamp(Math.round(block.height * 0.18), 16, 28);
  const bodyFont = clamp(Math.round(block.height * 0.125), 12, 18);
  const titleLineHeight = Math.round(titleFont * 1.2);
  const bodyLineHeight = Math.round(bodyFont * 1.35);
  const maxTitleLines = block.height <= 90 ? 1 : 2;
  const titleChars = estimateCharsPerLine(textWidth, titleFont);
  const titleLines = wrapText(block.title, titleChars, maxTitleLines);
  const titleStartY = block.y + topPadding + groupYOffset + titleFont;

  const bodyStartY = titleStartY + (titleLines.length * titleLineHeight) + 8;
  const bodyBottomLimit = block.y + block.height - bottomPadding - (iconMotif ? 16 : 0);
  const availableBodyHeight = Math.max(0, bodyBottomLimit - bodyStartY);
  const maxBodyLines = Math.max(0, Math.floor(availableBodyHeight / bodyLineHeight));
  const bodyChars = estimateCharsPerLine(textWidth, bodyFont);
  const bodyLines = maxBodyLines > 0 ? wrapText(block.body, bodyChars, Math.min(3, maxBodyLines)) : [];

  const titleSvg = toTextLinesSvg(titleLines, {
    x: textX,
    startY: titleStartY,
    lineHeight: titleLineHeight,
    color: '#0b1220',
    fontSize: titleFont,
    fontWeight: '720',
  });

  const bodySvg = toTextLinesSvg(bodyLines, {
    x: textX,
    startY: bodyStartY,
    lineHeight: bodyLineHeight,
    color: '#334155',
    fontSize: bodyFont,
  });

  return `
    <g>
      <defs>
        <linearGradient id="${cardGradientId}" x1="0%" y1="0%" x2="100%" y2="120%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.14" />
        </linearGradient>
        <linearGradient id="${accentGradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.86" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.56" />
        </linearGradient>
        <linearGradient id="${iconGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${color}" stop-opacity="${Math.max(0.12, profile.panelOpacity + 0.08)}" />
          <stop offset="100%" stop-color="${color}" stop-opacity="${Math.max(0.03, profile.panelOpacity - 0.02)}" />
        </linearGradient>
        <clipPath id="${photoClipId}">
          <rect x="${iconX - 10}" y="${iconY - 7}" width="${iconSize + 20}" height="${iconSize + 32}" rx="${profile.roundedPanel}" />
        </clipPath>
      </defs>

      <rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" rx="20" fill="url(#${cardGradientId})" stroke="${color}" stroke-width="2.2" stroke-opacity="0.45" filter="url(#cardShadow)" />
      <rect x="${block.x}" y="${block.y}" width="${block.width}" height="9" rx="20" fill="url(#${accentGradientId})" />
      <path d="M ${block.x + 16} ${block.y + 2} L ${block.x + block.width - 20} ${block.y + 2} L ${block.x + block.width - 34} ${block.y + 16} L ${block.x + 30} ${block.y + 16} Z" fill="#ffffff" fill-opacity="0.2" />
      <image href="${escapeXml(photoUrl)}" x="${iconX - 10}" y="${iconY - 7}" width="${iconSize + 20}" height="${iconSize + 32}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${photoClipId})" opacity="0.6" />
      <rect x="${iconX - 10}" y="${iconY - 7}" width="${iconSize + 20}" height="${iconSize + 32}" rx="${profile.roundedPanel}" fill="url(#${iconGradientId})" stroke="${color}" stroke-opacity="0.2" />
      ${profile.drawGrid ? `<path d="M ${iconX - 2} ${iconY + 8} L ${iconX + iconSize + 2} ${iconY + 8} M ${iconX - 2} ${iconY + 20} L ${iconX + iconSize + 2} ${iconY + 20} M ${iconX - 2} ${iconY + 32} L ${iconX + iconSize + 2} ${iconY + 32}" stroke="${color}" stroke-opacity="0.12" stroke-width="1" />` : ''}
      ${makeSceneBackdrop(sceneType, iconX - 4, iconY - 1, iconSize + 8, iconSize + 20, color)}
      <circle cx="${iconX + iconSize / 2}" cy="${iconY + iconSize / 2}" r="${iconSize / 2}" fill="${color}" fill-opacity="${Math.max(profile.circleOpacity, 0.12)}" />
      <circle cx="${iconX + iconSize / 2}" cy="${iconY + iconSize / 2}" r="${(iconSize / 2) - 3}" fill="none" stroke="#ffffff" stroke-opacity="0.34" stroke-width="1.2" />
      ${makeThematicIllustration(sceneType, iconType, iconX, iconY, iconSize, iconSize, color, styleVariant)}
      ${showGroupLabel ? `<rect x="${textX}" y="${block.y + 14}" width="${groupPillWidth}" height="20" rx="10" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.24" />` : ''}
      ${showGroupLabel ? `<text x="${textX + 10}" y="${block.y + 28}" font-size="11.5" font-weight="650" fill="#1e293b">${escapeXml(groupLabel)}</text>` : ''}
      ${titleSvg}
      ${bodySvg}
      ${iconMotif ? `<text x="${iconX + iconSize / 2}" y="${iconY + iconSize + 18}" text-anchor="middle" font-size="${profile.motifFontSize}" font-weight="560" fill="#475569">${escapeXml(iconMotif)}</text>` : ''}
    </g>
  `;
}

export function renderInfographicSvg(structure, options = {}) {
  const normalized = normalizeStructureObject(structure, {
    text: options.text || '',
    detailLevel: options.detailLevel,
    layoutMode: structure.layout,
  });

  const layoutResult = resolveLayout(normalized);
  const layoutItems = layoutResult.items || [];
  const requestedLinks = Array.isArray(normalized.links) ? normalized.links : [];
  const effectiveLinks = requestedLinks.length > 0 ? requestedLinks : (layoutResult.links || []);
  const idMap = buildIdMap(layoutItems);
  const illustrationStyle = normalizeIllustrationStyle(options?.illustrationStyle || '');

  const colorMap = buildColorMap(layoutItems);

  const blocksSvg = layoutItems.map((item) => {
    const color = colorMap.get(item.group || `level-${item.level}`) || GROUP_PALETTE[0];
    return makeBlockSvg(item, color, illustrationStyle);
  }).join('');

  const titleLines = wrapText(normalized.title || 'Infografik', 40, 2);
  const titleTspans = titleLines
    .map((line, index) => `<tspan x="120" dy="${index === 0 ? 0 : 44}">${escapeXml(line)}</tspan>`)
    .join('');

  const summary = truncate(normalized.summary || '', 180);
  const titleBaseY = 132;
  const titleBottomY = titleBaseY + ((titleLines.length - 1) * 44);
  const headerSafeBottom = 206;
  const summaryY = titleBottomY + 28;
  const showSummary = Boolean(summary) && summaryY <= (headerSafeBottom - 18);
  const summaryLine = showSummary
    ? `<text x="120" y="${summaryY}" font-size="18" fill="#334155">${escapeXml(summary)}</text>`
    : '';

  const focus = truncate(options.focus || '', 120);
  const focusY = (showSummary ? summaryY + 26 : titleBottomY + 26);
  const showFocus = Boolean(focus) && focusY <= (headerSafeBottom - 8);
  const focusLine = showFocus
    ? `<text x="120" y="${focusY}" font-size="15" fill="#0f766e">Fokus: ${escapeXml(focus)}</text>`
    : '';

  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
      <defs>
        <style>
          text { font-family: "Avenir Next", "Nunito Sans", "Segoe UI", "Helvetica Neue", sans-serif; letter-spacing: 0.1px; }
        </style>
        <linearGradient id="paperBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f8fafc" />
          <stop offset="44%" stop-color="#f5f3ff" />
          <stop offset="100%" stop-color="#eff6ff" />
        </linearGradient>
        <radialGradient id="orbA" cx="0%" cy="0%" r="70%">
          <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.24" />
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="orbB" cx="100%" cy="100%" r="72%">
          <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#a78bfa" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="headerBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#f1f5f9" />
        </linearGradient>
        <linearGradient id="headerAccent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0ea5e9" />
          <stop offset="55%" stop-color="#8b5cf6" />
          <stop offset="100%" stop-color="#f97316" />
        </linearGradient>
        <filter id="cardShadow" x="-20%" y="-24%" width="160%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#0f172a" flood-opacity="0.08" />
          <feDropShadow dx="0" dy="10" stdDeviation="11" flood-color="#0f172a" flood-opacity="0.12" />
        </filter>
        <filter id="headerShadow" x="-8%" y="-20%" width="120%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.12" />
        </filter>
        <pattern id="softGrid" x="0" y="0" width="38" height="38" patternUnits="userSpaceOnUse">
          <path d="M 38 0 L 0 0 0 38" fill="none" stroke="#64748b" stroke-width="0.7" stroke-opacity="0.08" />
        </pattern>
        <linearGradient id="noiseFade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0f172a" stop-opacity="0.08" />
          <stop offset="100%" stop-color="#0f172a" stop-opacity="0.02" />
        </linearGradient>
        <filter id="paperNoise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.035" />
          </feComponentTransfer>
        </filter>
        <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" fill-opacity="0.72" />
        </marker>
      </defs>

      <rect width="1920" height="1080" fill="url(#paperBg)" />
      <rect width="1920" height="1080" fill="url(#softGrid)" />
      <circle cx="160" cy="140" r="280" fill="url(#orbA)" />
      <circle cx="1770" cy="960" r="320" fill="url(#orbB)" />
      <rect width="1920" height="1080" fill="url(#noiseFade)" filter="url(#paperNoise)" />

      <rect x="90" y="52" width="1740" height="170" rx="24" fill="url(#headerBg)" stroke="#cbd5e1" stroke-width="1.8" filter="url(#headerShadow)" />
      <rect x="90" y="52" width="1740" height="8" rx="24" fill="url(#headerAccent)" />
      <text x="120" y="90" font-size="14" font-weight="700" letter-spacing="1.1" fill="#475569">LERNINFOGRAFIK</text>
      <text x="120" y="132" font-size="50" font-weight="760" fill="#0f172a">${titleTspans}</text>
      ${summaryLine}
      ${focusLine}

      ${makeConnectionsSvg(effectiveLinks, idMap)}
      ${blocksSvg}

      <text x="120" y="1052" font-size="13" fill="#64748b">Stil: ${escapeXml(illustrationStyle)}</text>
      <text x="1810" y="1052" text-anchor="end" font-size="13" fill="#64748b">Layout: ${escapeXml(normalized.layout)}</text>
    </svg>
  `.trim();

  return dedupeFillAttributes(svgMarkup);
}
