import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignTasksToMembers,
  buildTaskExtractionMessages,
  formatTranscriptForTaskExtraction,
  matchWorkspaceMember,
  normalizeExtractedTasks,
  normalizeTaskStatus,
} from '../lib/task-utils.js';

const members = [
  { id: 1, name: 'Anna Schmidt', email: 'anna@example.com' },
  { id: 2, name: 'Alex Meier', email: 'alex.meier@example.com' },
  { id: 3, name: 'Alex Schulz', email: 'alex.schulz@example.com' },
];

test('matchWorkspaceMember matches exact email case-insensitively', () => {
  assert.equal(matchWorkspaceMember('Bitte an ANNA@example.com', members).id, 1);
});

test('matchWorkspaceMember leaves ambiguous first names unassigned', () => {
  assert.equal(matchWorkspaceMember('Alex', members), null);
});

test('assignTasksToMembers keeps assignee text and sets reliable user id', () => {
  const [task] = assignTasksToMembers([{ title: 'Pruefen', assigneeText: 'Anna Schmidt' }], members);
  assert.equal(task.assigneeText, 'Anna Schmidt');
  assert.equal(task.assigneeUserId, 1);
});

test('normalizeExtractedTasks validates shape and safe defaults', () => {
  const tasks = normalizeExtractedTasks({ tasks: [
    { title: ' Vertrag pruefen ', priority: 'urgent', confidence: 2, due_date: '2026-07-01' },
    { description: 'missing title' },
  ] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Vertrag pruefen');
  assert.equal(tasks[0].priority, 'medium');
  assert.equal(tasks[0].confidence, 1);
  assert.equal(tasks[0].dueDate, '2026-07-01');
});

test('buildTaskExtractionMessages requests strict task JSON', () => {
  const messages = buildTaskExtractionMessages({ transcriptText: 'Anna uebernimmt den Vertrag.', members });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[1].content, /"tasks"/);
  assert.match(messages[1].content, /Anna Schmidt/);
});

test('formatTranscriptForTaskExtraction preserves segment ids for source links', () => {
  const transcript = formatTranscriptForTaskExtraction({
    transcriptText: 'Fallback',
    segments: [{ id: 42, speaker: 'Anna', text: 'Bitte Vertrag pruefen.' }],
  });
  assert.match(transcript, /\[segment:42\] Anna: Bitte Vertrag pruefen\./);
});

test('normalizeTaskStatus supports review state transitions', () => {
  assert.equal(normalizeTaskStatus('proposed'), 'proposed');
  assert.equal(normalizeTaskStatus('open'), 'open');
  assert.equal(normalizeTaskStatus('done'), 'done');
  assert.equal(normalizeTaskStatus('dismissed'), 'dismissed');
  assert.equal(normalizeTaskStatus('unknown'), 'proposed');
});
