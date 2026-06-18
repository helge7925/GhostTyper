export function buildFollowupPrompts(message, { max = 3 } = {}) {
  const content = String(message?.content || '').toLocaleLowerCase('de-DE');
  const prompts = [];
  if (content.includes('aufgabe') || content.includes('todo') || content.includes('to-do')) {
    prompts.push('Welche Aufgaben und Verantwortlichkeiten ergeben sich daraus?');
  }
  if (content.includes('frist') || content.includes('datum') || content.includes('termin')) {
    prompts.push('Welche Fristen oder Termine sollte ich beachten?');
  }
  prompts.push('Fasse die wichtigsten Punkte als kurze Liste zusammen.');
  prompts.push('Welche offenen Fragen bleiben?');
  prompts.push('Welche nächsten Schritte empfiehlst du?');
  return Array.from(new Set(prompts)).slice(0, max);
}
