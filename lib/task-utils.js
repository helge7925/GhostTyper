const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_EVIDENCE_LENGTH = 4000;

export const TASK_STATUSES = ['proposed', 'open', 'done', 'dismissed'];
export const TASK_PRIORITIES = ['low', 'medium', 'high'];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLookup(value) {
  return normalizeText(value).toLocaleLowerCase('de-DE');
}

function splitNameParts(name) {
  return normalizeText(name).split(/\s+/).filter(Boolean);
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : raw;
}

export function normalizeTaskPriority(value) {
  return TASK_PRIORITIES.includes(value) ? value : 'medium';
}

export function normalizeTaskStatus(value) {
  return TASK_STATUSES.includes(value) ? value : 'proposed';
}

export function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(1, Math.max(0, num));
}

export function normalizeExtractedTasks(payload, { maxTasks = 20 } = {}) {
  const rawTasks = Array.isArray(payload) ? payload : Array.isArray(payload?.tasks) ? payload.tasks : [];
  return rawTasks.slice(0, maxTasks).map((task) => {
    if (!task || typeof task !== 'object') return null;
    const title = normalizeText(task.title || task.aufgabe || task.task).slice(0, MAX_TITLE_LENGTH);
    if (!title) return null;
    return {
      title,
      description: normalizeText(task.description || task.beschreibung).slice(0, MAX_DESCRIPTION_LENGTH) || null,
      assigneeText: normalizeText(task.assignee_text || task.assignee || task.verantwortlich).slice(0, MAX_TITLE_LENGTH) || null,
      dueDate: normalizeDate(task.due_date || task.dueDate || task.faellig_am),
      priority: normalizeTaskPriority(task.priority || task.prioritaet),
      confidence: normalizeConfidence(task.confidence || task.konfidenz),
      evidence: normalizeText(task.evidence || task.beleg || task.source_quote).slice(0, MAX_EVIDENCE_LENGTH) || null,
      sourceSegmentIds: Array.isArray(task.source_segment_ids)
        ? task.source_segment_ids.map(Number).filter(Number.isFinite)
        : [],
    };
  }).filter(Boolean);
}

export function matchWorkspaceMember(assigneeText, members = []) {
  const raw = normalizeText(assigneeText);
  if (!raw) return null;

  const email = raw.match(EMAIL_RE)?.[0]?.toLocaleLowerCase('de-DE');
  if (email) {
    const emailMatches = members.filter((member) => normalizeLookup(member.email) === email);
    return emailMatches.length === 1 ? emailMatches[0] : null;
  }

  const lookup = normalizeLookup(raw);
  const exact = members.filter((member) => normalizeLookup(member.name) === lookup || normalizeLookup(member.email) === lookup);
  if (exact.length === 1) return exact[0];

  const nameMatches = members.filter((member) => {
    const parts = splitNameParts(member.name).map(normalizeLookup);
    return parts.includes(lookup);
  });
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

export function assignTasksToMembers(tasks, members = []) {
  return (tasks || []).map((task) => {
    const member = matchWorkspaceMember(task.assigneeText, members);
    return {
      ...task,
      assigneeUserId: member ? Number(member.id || member.user_id) : null,
    };
  });
}

export function getSegmentSourceId(segment, index) {
  const id = segment?.id ?? segment?.segment_id ?? segment?.source_id ?? index + 1;
  return Number.isFinite(Number(id)) ? Number(id) : index + 1;
}

export function formatTranscriptForTaskExtraction({ transcriptText, segments = [] }) {
  if (!Array.isArray(segments) || segments.length === 0) return String(transcriptText || '');
  const lines = segments.map((segment, index) => {
    const sourceId = getSegmentSourceId(segment, index);
    const speaker = normalizeText(segment.speaker || segment.speaker_label || segment.speaker_id || '');
    const text = normalizeText(segment.text);
    if (!text) return null;
    return `[segment:${sourceId}] ${speaker ? `${speaker}: ` : ''}${text}`;
  }).filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : String(transcriptText || '');
}

export function buildTaskExtractionMessages({ transcriptText, segments = [], members = [], language = 'de' }) {
  const memberLines = members.map((member) => `- ${member.name || member.email || `User ${member.id}`}${member.email ? ` <${member.email}>` : ''}`).join('\n');
  const transcript = formatTranscriptForTaskExtraction({ transcriptText, segments });
  const system = language === 'en'
    ? 'You extract actionable tasks from transcripts. Return strict JSON only.'
    : 'Du extrahierst konkrete Aufgaben aus Transkripten. Antworte ausschliesslich als valides JSON.';
  const user = `Extrahiere maximal 20 konkrete Aufgaben aus diesem Transkript.

Regeln:
- Nur echte Aufgaben/Verabredungen, keine allgemeinen Themen.
- Status wird spaeter geprueft; gib nur Vorschlaege zurueck.
- due_date nur als YYYY-MM-DD, sonst null.
- priority: low, medium oder high.
- confidence zwischen 0 und 1.
- assignee_text exakt aus dem Transkript oder null.
- evidence als kurzes Originalzitat.
- Wenn Segmentmarker wie [segment:123] vorhanden sind, trage die passenden Nummern in source_segment_ids ein.

Workspace-Mitglieder fuer moegliche Zuordnung:
${memberLines || '- Keine Mitgliederliste verfuegbar'}

JSON-Format:
{"tasks":[{"title":"...","description":"...","assignee_text":"...","due_date":null,"priority":"medium","confidence":0.8,"evidence":"...","source_segment_ids":[]}]}

Transkript:
---
${String(transcript || '').slice(0, 120000)}
---`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
