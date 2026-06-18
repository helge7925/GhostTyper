/**
 * Sentence-aware buffering for live-translation deltas.
 *
 * Voxtral STT emits short, often mid-sentence chunks. Translating each
 * chunk in isolation gives poor grammar and choppy TTS. These helpers
 * group consecutive STT segments into "sentence units" so the bridge
 * can translate one full sentence at a time. The pure-function shape
 * here keeps the logic unit-testable without pulling in the bridge's
 * DB/Mistral/Redis imports.
 */

// Sentence terminators — covers Western punctuation plus CJK fullstops
// and exclamation/question marks. Trailing quote-closers and whitespace
// are tolerated so e.g. `." `, `?" `, `«` (German closing), `»` (French/
// Swiss closing), `”`, `’`, `)`, `]` still count as end-of-sentence.
export const SENTENCE_TERMINATORS = /[.!?…。！？]\s*["'’”»«)\]]*\s*$/;

/**
 * Walk through `segments` and yield "sentence units": runs of
 * consecutive segments whose concatenated text ends with a sentence
 * terminator. The trailing fragment (segments after the last
 * terminator) is returned separately so the caller can decide whether
 * to translate it now (safety flush) or keep it for the next tick.
 *
 * @param {Array<{text?: string}>} segments
 * @returns {{ complete: Array<Array<object>>, trailing: Array<object> }}
 */
export function splitIntoSentenceUnits(segments) {
  const units = [];
  let current = [];
  // Maintain the concatenation incrementally instead of re-joining the whole
  // `current` array on every segment — the old O(n^2) rebuild could become a
  // CPU hotspot when a poll tick processes a backlog inside the 500ms loop.
  let buffer = '';
  for (const seg of segments) {
    current.push(seg);
    buffer = buffer ? `${buffer} ${seg.text || ''}` : (seg.text || '');
    if (SENTENCE_TERMINATORS.test(buffer.trim())) {
      units.push(current);
      current = [];
      buffer = '';
    }
  }
  return { complete: units, trailing: current };
}

/** Sum of `text` lengths over an array of segments. */
export function fragmentCharLength(segments) {
  return segments.reduce((sum, s) => sum + (s.text ? s.text.length : 0), 0);
}
