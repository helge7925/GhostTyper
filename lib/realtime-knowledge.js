const MAX_TRANSCRIPT_CHARS = 240_000;
const MAX_NODE_COUNT = 180;
const MAX_EDGE_COUNT = 320;

const TASK_HINTS = [
  'todo',
  'to-do',
  'aufgabe',
  'action item',
  'muss',
  'soll',
  'bitte',
  'erledigen',
];

const DECISION_HINTS = [
  'entschieden',
  'beschlossen',
  'entscheidung',
  'freigegeben',
  'abgelehnt',
  'approved',
  'decided',
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toKey(type, label) {
  return `${type}:${normalizeWhitespace(label).toLocaleLowerCase('de-DE')}`;
}

function limitText(value, maxLength) {
  const safe = normalizeWhitespace(value);
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function appendRealtimeTranscript(existingText, chunkText) {
  const existing = String(existingText || '');
  const chunk = normalizeWhitespace(chunkText);
  if (!chunk) return existing;

  const combined = existing ? `${existing}\n${chunk}` : chunk;
  if (combined.length <= MAX_TRANSCRIPT_CHARS) return combined;
  return combined.slice(combined.length - MAX_TRANSCRIPT_CHARS);
}

function splitSentences(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractDateTokens(sentence) {
  const results = new Set();
  const dateRegex = /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g;
  const isoRegex = /\b\d{4}-\d{2}-\d{2}\b/g;
  const monthRegex = /\b(?:jan|feb|mär|apr|mai|jun|jul|aug|sep|okt|nov|dez)[a-z]*\s+\d{2,4}\b/gi;

  for (const match of sentence.matchAll(dateRegex)) results.add(match[0]);
  for (const match of sentence.matchAll(isoRegex)) results.add(match[0]);
  for (const match of sentence.matchAll(monthRegex)) results.add(match[0]);

  return [...results];
}

function extractPersonTokens(sentence) {
  const results = new Set();
  const personRegex = /\b(?:Herr|Frau|Dr\.?|Prof\.?)?\s*[A-ZÄÖÜ][a-zäöüß]{2,}(?:\s+[A-ZÄÖÜ][a-zäöüß]{2,})?\b/g;
  for (const match of sentence.matchAll(personRegex)) {
    const token = normalizeWhitespace(match[0].replace(/^(Herr|Frau|Dr\.?|Prof\.?)\s*/i, ''));
    if (!token) continue;
    if (token.length < 3 || token.length > 60) continue;
    results.add(token);
  }
  return [...results];
}

function extractProjectTokens(sentence) {
  const results = new Set();
  const projectRegex = /\b(?:Projekt|Kunde|Team|Abteilung)\s+[A-ZÄÖÜ0-9][A-Za-zÄÖÜäöüß0-9\-_]{1,40}\b/g;
  for (const match of sentence.matchAll(projectRegex)) {
    results.add(normalizeWhitespace(match[0]));
  }
  return [...results];
}

function sentenceHasHint(sentence, hints) {
  const lower = sentence.toLocaleLowerCase('de-DE');
  return hints.some((hint) => lower.includes(hint));
}

function createNode(type, label, evidence) {
  const createdAt = nowIso();
  return {
    id: toKey(type, label),
    type,
    label: limitText(label, 120),
    count: 1,
    createdAt,
    updatedAt: createdAt,
    evidence: limitText(evidence, 220),
  };
}

function upsertNode(nodeMap, type, label, evidence) {
  const key = toKey(type, label);
  const current = nodeMap.get(key);
  if (!current) {
    nodeMap.set(key, createNode(type, label, evidence));
    return key;
  }

  const updatedAt = nowIso();
  nodeMap.set(key, {
    ...current,
    count: Number(current.count || 0) + 1,
    updatedAt,
    evidence: limitText(evidence || current.evidence || '', 220),
  });
  return key;
}

function upsertEdge(edgeMap, source, target, relationType, evidence) {
  if (!source || !target || source === target) return;
  const key = `${source}|${relationType}|${target}`;
  const current = edgeMap.get(key);
  if (!current) {
    const createdAt = nowIso();
    edgeMap.set(key, {
      id: key,
      source,
      target,
      type: relationType,
      count: 1,
      createdAt,
      updatedAt: createdAt,
      evidence: limitText(evidence, 220),
    });
    return;
  }

  edgeMap.set(key, {
    ...current,
    count: Number(current.count || 0) + 1,
    updatedAt: nowIso(),
    evidence: limitText(evidence || current.evidence || '', 220),
  });
}

function normalizeGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    return { nodes: [], edges: [] };
  }
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
  };
}

function trimGraph(graph) {
  const sortedNodes = [...graph.nodes]
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    .slice(0, MAX_NODE_COUNT);
  const nodeIds = new Set(sortedNodes.map((node) => node.id));
  const sortedEdges = [...graph.edges]
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    .slice(0, MAX_EDGE_COUNT);

  return {
    nodes: sortedNodes,
    edges: sortedEdges,
  };
}

export function updateKnowledgeGraph(existingGraph, chunkText) {
  const safeChunk = normalizeWhitespace(chunkText);
  const base = normalizeGraph(existingGraph);
  if (!safeChunk) return base;

  const nodeMap = new Map(base.nodes.map((node) => [node.id, node]));
  const edgeMap = new Map(base.edges.map((edge) => [edge.id, edge]));

  const meetingNodeId = upsertNode(nodeMap, 'topic', 'Live-Meeting', safeChunk);

  const sentences = splitSentences(safeChunk);
  for (const sentence of sentences) {
    const persons = extractPersonTokens(sentence);
    const projects = extractProjectTokens(sentence);
    const dates = extractDateTokens(sentence);
    const hasTask = sentenceHasHint(sentence, TASK_HINTS);
    const hasDecision = sentenceHasHint(sentence, DECISION_HINTS);

    const personIds = persons.map((person) => upsertNode(nodeMap, 'person', person, sentence));
    const projectIds = projects.map((project) => upsertNode(nodeMap, 'project', project, sentence));
    const dateIds = dates.map((dateLabel) => upsertNode(nodeMap, 'date', dateLabel, sentence));

    personIds.forEach((personId) => upsertEdge(edgeMap, personId, meetingNodeId, 'participates_in', sentence));
    projectIds.forEach((projectId) => upsertEdge(edgeMap, meetingNodeId, projectId, 'covers', sentence));

    if (hasDecision) {
      const decisionId = upsertNode(nodeMap, 'decision', sentence, sentence);
      upsertEdge(edgeMap, meetingNodeId, decisionId, 'contains_decision', sentence);
      personIds.forEach((personId) => upsertEdge(edgeMap, personId, decisionId, 'influences', sentence));
      projectIds.forEach((projectId) => upsertEdge(edgeMap, decisionId, projectId, 'about', sentence));
      dateIds.forEach((dateId) => upsertEdge(edgeMap, decisionId, dateId, 'at', sentence));
    }

    if (hasTask) {
      const taskId = upsertNode(nodeMap, 'task', sentence, sentence);
      upsertEdge(edgeMap, meetingNodeId, taskId, 'contains_task', sentence);
      personIds.forEach((personId) => upsertEdge(edgeMap, personId, taskId, 'owns', sentence));
      projectIds.forEach((projectId) => upsertEdge(edgeMap, taskId, projectId, 'for', sentence));
      dateIds.forEach((dateId) => upsertEdge(edgeMap, taskId, dateId, 'due_on', sentence));
    }
  }

  return trimGraph({
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  });
}

function topNodes(graph, type, limit) {
  return graph.nodes
    .filter((node) => node.type === type)
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
    .slice(0, limit);
}

function collectHighlights(transcript) {
  const sentences = splitSentences(transcript);
  const highlights = [];
  for (const sentence of sentences) {
    if (sentenceHasHint(sentence, DECISION_HINTS) || sentenceHasHint(sentence, TASK_HINTS)) {
      highlights.push(limitText(sentence, 180));
    }
  }
  return [...new Set(highlights)].slice(-8);
}

export function buildLiveDocumentMarkdown({ title, template = 'generic', transcript, graph }) {
  const safeTitle = normalizeWhitespace(title) || 'Live-Session';
  const safeTranscript = String(transcript || '').trim();
  const normalizedGraph = normalizeGraph(graph);

  const topTasks = topNodes(normalizedGraph, 'task', 8);
  const topDecisions = topNodes(normalizedGraph, 'decision', 8);
  const highlights = collectHighlights(safeTranscript);

  const lines = [`# ${safeTitle}`];

  if (template === 'meeting') {
    lines.push('', '## Zusammenfassung');
    if (highlights.length > 0) highlights.forEach((entry) => lines.push(`- ${entry}`));
    else lines.push('- Noch keine verwertbaren Highlights erkannt.');

    lines.push('', '## Entscheidungen');
    if (topDecisions.length > 0) topDecisions.forEach((entry) => lines.push(`- ${entry.label}`));
    else lines.push('- Noch keine Entscheidungen erkannt.');

    lines.push('', '## Aufgaben');
    if (topTasks.length > 0) topTasks.forEach((entry) => lines.push(`- [ ] ${entry.label}`));
    else lines.push('- Noch keine Aufgaben erkannt.');
  } else if (template === 'aufmass') {
    lines.push('', '## Aufmaß-Zusammenfassung');
    if (highlights.length > 0) highlights.forEach((entry) => lines.push(`- ${entry}`));
    else lines.push('- Noch keine verwertbaren Aufmaß-Hinweise erkannt.');

    lines.push('', '## Erkannte Positionen');
    const projects = topNodes(normalizedGraph, 'project', 10);
    if (projects.length > 0) {
      projects.forEach((entry) => lines.push(`- ${entry.label}`));
    } else {
      lines.push('- Noch keine Positionen erkannt.');
    }

    lines.push('', '## Offene Aufgaben');
    if (topTasks.length > 0) topTasks.forEach((entry) => lines.push(`- [ ] ${entry.label}`));
    else lines.push('- Noch keine offenen Aufgaben erkannt.');
  } else if (template === 'knowledge_graph') {
    lines.push('', '## Graph-Highlights');
    if (highlights.length > 0) highlights.forEach((entry) => lines.push(`- ${entry}`));
    else lines.push('- Noch keine Graph-Highlights erkannt.');

    lines.push('', '## Knoten (Top)');
    normalizedGraph.nodes
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 15)
      .forEach((node) => lines.push(`- ${node.label} (${node.type})`));
    if (!normalizedGraph.nodes?.length) lines.push('- Noch keine Knoten erkannt.');

    lines.push('', '## Beziehungen (Top)');
    normalizedGraph.edges
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 15)
      .forEach((edge) => lines.push(`- ${edge.source} -> ${edge.target} (${edge.type})`));
    if (!normalizedGraph.edges?.length) lines.push('- Noch keine Beziehungen erkannt.');
  } else if (template === 'mindmap') {
    lines.push('', '## Mindmap-Highlights');
    if (highlights.length > 0) highlights.forEach((entry) => lines.push(`- ${entry}`));
    else lines.push('- Noch keine Mindmap-Highlights erkannt.');

    lines.push('', '## Hauptäste');
    normalizedGraph.nodes
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 12)
      .forEach((node) => lines.push(`- ${node.label}`));
    if (!normalizedGraph.nodes?.length) lines.push('- Noch keine Äste erkannt.');

    lines.push('', '## Verknüpfungen');
    normalizedGraph.edges
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 12)
      .forEach((edge) => lines.push(`- ${edge.source} -> ${edge.target}`));
    if (!normalizedGraph.edges?.length) lines.push('- Noch keine Verknüpfungen erkannt.');
  } else {
    lines.push('', '## Live-Zusammenfassung');
    if (highlights.length > 0) highlights.forEach((entry) => lines.push(`- ${entry}`));
    else lines.push('- Noch keine verwertbaren Highlights erkannt.');

    lines.push('', '## Entscheidungen (auto)');
    if (topDecisions.length > 0) topDecisions.forEach((entry) => lines.push(`- ${entry.label}`));
    else lines.push('- Noch keine Entscheidungen erkannt.');

    lines.push('', '## Aufgaben (auto)');
    if (topTasks.length > 0) topTasks.forEach((entry) => lines.push(`- [ ] ${entry.label}`));
    else lines.push('- Noch keine Aufgaben erkannt.');
  }

  lines.push('', '## Live-Transkript', '');
  lines.push(safeTranscript || '_Noch kein Transkript vorhanden._');

  return lines.join('\n');
}
