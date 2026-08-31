const MAX_SOURCE_TERM_LENGTH = 200;
const MAX_TARGET_TERM_LENGTH = 500;
const MAX_NOTES_LENGTH = 2000;
const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

export function normalizeGlossaryPayload(body = {}) {
  const sourceTerm = String(body.source_term ?? body.sourceTerm ?? '').trim();
  const doNotTranslate = body.do_not_translate === true || body.doNotTranslate === true;
  const targetLang = String(body.target_lang ?? body.targetLang ?? '').trim().toLowerCase();
  const targetTerm = String(body.target_term ?? body.targetTerm ?? '').trim();
  const notes = String(body.notes ?? '').trim();

  if (!sourceTerm) return { error: 'Ausgangsbegriff ist erforderlich' };
  if (sourceTerm.length > MAX_SOURCE_TERM_LENGTH) {
    return { error: `Ausgangsbegriff ist zu lang (max. ${MAX_SOURCE_TERM_LENGTH} Zeichen)` };
  }
  if (!doNotTranslate && !targetLang) return { error: 'Zielsprache ist erforderlich' };
  if (!doNotTranslate && !LANGUAGE_TAG_PATTERN.test(targetLang)) {
    return { error: 'Zielsprache muss ein gültiger Sprachcode sein (z. B. en oder de-DE)' };
  }
  if (!doNotTranslate && !targetTerm) return { error: 'Zielbegriff ist erforderlich' };
  if (targetTerm.length > MAX_TARGET_TERM_LENGTH) {
    return { error: `Zielbegriff ist zu lang (max. ${MAX_TARGET_TERM_LENGTH} Zeichen)` };
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return { error: `Notizen sind zu lang (max. ${MAX_NOTES_LENGTH} Zeichen)` };
  }

  return {
    value: {
      sourceTerm,
      targetLang: doNotTranslate ? null : targetLang,
      targetTerm: doNotTranslate ? null : targetTerm,
      doNotTranslate,
      notes: notes || null,
    },
  };
}
