import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocumentChunks,
  buildRetrievalPrompt,
  chunkMarkdown,
  chunkPlainText,
  cosineSimilarity,
  runAutoIndex,
} from '../lib/document-index-utils.js';

test('chunkPlainText splits long text with metadata', () => {
  const text = `${'A'.repeat(1200)}. ${'B'.repeat(1200)}. ${'C'.repeat(1200)}.`;
  const chunks = chunkPlainText(text, { maxChars: 1400, overlapChars: 100 });

  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].content.length <= 1400);
  assert.equal(chunks[0].metadata.char_start, 0);
  assert.ok(chunks[0].metadata.char_end > chunks[0].metadata.char_start);
});

test('buildDocumentChunks keeps transcript timing metadata', () => {
  const chunks = buildDocumentChunks({
    title: 'Standup',
    source_type: 'meeting',
    segments: [
      { id: 1, start: 1.5, end: 2.5, speaker: 'Helge', text: 'Bitte Vertrag pruefen.' },
      { id: 2, start: 3, end: 4, speaker: 'Anna', text: 'Ich uebernehme das.' },
    ],
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].metadata.start_seconds, 1.5);
  assert.equal(chunks[0].metadata.end_seconds, 4);
  assert.deepEqual(chunks[0].metadata.segment_ids, [1, 2]);
  assert.match(chunks[0].content, /Helge:/);
});

test('cosineSimilarity ranks identical vectors highest', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [1]), 0);
});

test('buildRetrievalPrompt formats source labels', () => {
  const prompt = buildRetrievalPrompt([
    { title: 'Datei', content: 'Quelle eins' },
    { title: 'Notiz', content: 'Quelle zwei' },
  ]);

  assert.match(prompt, /\[S1\] \(Datei\)/);
  assert.match(prompt, /\[S2\] \(Notiz\)/);
});

function makeDeps(overrides = {}) {
  const calls = { indexDocument: [], resolveCortecsConfig: [], resolveDocumentIdForTranscription: [], logWarn: [] };
  const deps = {
    resolveDocumentIdForTranscription: async (...args) => {
      calls.resolveDocumentIdForTranscription.push(args);
      return overrides.documentId ?? 42;
    },
    resolveCortecsConfig: async (...args) => {
      calls.resolveCortecsConfig.push(args);
      return overrides.cortecs ?? { apiKey: 'key-123' };
    },
    indexDocument: async (...args) => {
      calls.indexDocument.push(args);
      if (overrides.indexThrows) throw new Error('embedding boom');
      return { documentId: args[0].documentId, chunks: 3 };
    },
    logWarn: (...args) => { calls.logWarn.push(args); },
    ...overrides.deps,
  };
  return { deps, calls };
}

test('runAutoIndex skips silently when no Cortecs key is configured', async () => {
  const { deps, calls } = makeDeps({ cortecs: { apiKey: '' } });
  const result = await runAutoIndex(
    { transcriptionId: 7, organizationId: 1, userId: 2 },
    deps,
  );

  assert.equal(result, null);
  assert.equal(calls.indexDocument.length, 0);
  assert.equal(calls.logWarn.length, 0);
});

test('runAutoIndex resolves documentId from transcriptionId and indexes', async () => {
  const { deps, calls } = makeDeps({ documentId: 99 });
  const result = await runAutoIndex(
    { transcriptionId: 7, organizationId: 1, userId: 2 },
    deps,
  );

  assert.deepEqual(calls.resolveDocumentIdForTranscription[0], [7, 1]);
  assert.equal(calls.indexDocument.length, 1);
  assert.equal(calls.indexDocument[0][0].documentId, 99);
  assert.equal(result.documentId, 99);
});

test('runAutoIndex uses provided documentId and cortecs without resolving', async () => {
  const { deps, calls } = makeDeps();
  await runAutoIndex(
    { documentId: 5, organizationId: 1, userId: 2, cortecs: { apiKey: 'preset' } },
    deps,
  );

  assert.equal(calls.resolveDocumentIdForTranscription.length, 0);
  assert.equal(calls.resolveCortecsConfig.length, 0);
  assert.equal(calls.indexDocument[0][0].cortecs.apiKey, 'preset');
});

test('runAutoIndex swallows indexing errors and logs a warning', async () => {
  const { deps, calls } = makeDeps({ indexThrows: true });
  const result = await runAutoIndex(
    { documentId: 5, organizationId: 1, userId: 2 },
    deps,
  );

  assert.equal(result, null);
  assert.equal(calls.logWarn.length, 1);
  assert.equal(calls.logWarn[0][0], 'document.auto_index_failed');
  assert.equal(calls.logWarn[0][1].message, 'embedding boom');
});

test('runAutoIndex returns null when org/user missing or document unresolvable', async () => {
  const { deps: d1, calls: c1 } = makeDeps();
  assert.equal(await runAutoIndex({ documentId: 5, userId: 2 }, d1), null);
  assert.equal(c1.indexDocument.length, 0);

  const { deps: d2 } = makeDeps({ documentId: null });
  const noDoc = await runAutoIndex({ transcriptionId: 7, organizationId: 1, userId: 2 }, {
    ...d2,
    resolveDocumentIdForTranscription: async () => null,
  });
  assert.equal(noDoc, null);
});

test('chunkMarkdown splits on headings and records the heading in metadata', () => {
  const md = '# Einleitung\nErster Absatz der Einleitung.\n\n## Methoden\nBeschreibung der Methode.';
  const chunks = chunkMarkdown(md);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].metadata.heading, 'Einleitung');
  assert.match(chunks[0].content, /Erster Absatz/);
  assert.equal(chunks[1].metadata.heading, 'Methoden');
  assert.match(chunks[1].content, /Beschreibung der Methode/);
});

test('chunkMarkdown falls back to size-based splitting for oversized sections', () => {
  const big = `# Titel\n${'A'.repeat(1500)}. ${'B'.repeat(1500)}.`;
  const chunks = chunkMarkdown(big, { maxChars: 1000, overlapChars: 50 });
  assert.ok(chunks.length >= 2);
  // Heading metadata is propagated to every sub-chunk of the section.
  assert.ok(chunks.every((c) => c.metadata.heading === 'Titel'));
});

test('chunkMarkdown handles heading-less plain text gracefully', () => {
  const chunks = chunkMarkdown('Nur ein einfacher Satz ohne Überschrift.');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].metadata.heading, undefined);
  assert.match(chunks[0].content, /einfacher Satz/);
});

test('buildDocumentChunks uses the markdown chunker for OCR documents', () => {
  const doc = {
    source_type: 'ocr',
    title: 'Scan.pdf',
    text: '# Rechnung\nPosition 1: 10 EUR\n\n## Summe\nGesamt: 10 EUR',
  };
  const chunks = buildDocumentChunks(doc);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[0].metadata.source_type, 'ocr');
  assert.equal(chunks[0].metadata.heading, 'Rechnung');
  assert.equal(chunks[0].metadata.title, 'Scan.pdf');
});
