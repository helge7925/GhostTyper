import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from '../lib/i18n';
import {
  createGlossaryEntry,
  getGlossarySuggestionsForText,
  saveTranslationMemoryCorrection,
} from '../lib/api';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight glossary hits inside a string. Whole-word, case-insensitive,
 * Unicode-aware — mirrors the server-side termPattern so what lights up matches
 * what the prompt/masking layer actually acted on.
 */
function highlightTerms(text, terms) {
  const clean = [...new Set((terms || []).map((term) => String(term || '').trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const source = String(text ?? '');
  if (clean.length === 0 || !source) return source;
  let pattern;
  try {
    pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${clean.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  } catch {
    return source;
  }
  const lowerSet = new Set(clean.map((term) => term.toLowerCase()));
  return source.split(pattern).map((part, index) => (
    lowerSet.has(String(part).toLowerCase())
      ? <mark key={index} className="bg-accent/20 text-accent rounded px-0.5">{part}</mark>
      : <span key={index}>{part}</span>
  ));
}

function TierBadge({ tier, label }) {
  const isPersonal = tier === 'personal';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest rounded px-1.5 py-0.5 border ${
      isPersonal
        ? 'text-accent bg-accent/10 border-accent/20'
        : 'text-secondary bg-hover-subtle border-subtle'
    }`}>
      {label}
    </span>
  );
}

function SegmentReviewRow({ segment, sourceLang, targetLang, onError }) {
  const t = useTranslations('translatePage.terms');
  const [value, setValue] = useState(segment.t || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  const highlightTermsForSource = useMemo(() => [...(segment.a || []), ...(segment.m || [])], [segment]);
  const highlightTermsForTarget = useMemo(() => segment.m || [], [segment]);

  async function handleSaveCorrection() {
    if (!value.trim() || !sourceLang || !targetLang) return;
    setSaving(true);
    try {
      await saveTranslationMemoryCorrection({
        sourceLang,
        targetLang,
        sourceText: segment.s,
        targetText: value,
      });
      setSaved(true);
      setEditing(false);
    } catch (err) {
      onError?.(err.message || t('correctionError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-3 border-b border-subtle last:border-0">
      <div className="text-sm text-primary leading-relaxed whitespace-pre-wrap break-words">
        {highlightTerms(segment.s, highlightTermsForSource)}
      </div>
      <div className="space-y-2">
        {editing ? (
          <textarea
            value={value}
            onChange={(e) => { setValue(e.target.value); setSaved(false); }}
            rows={Math.min(6, Math.max(2, Math.ceil((value.length || 40) / 60)))}
            className="w-full bg-surface-elevated border border-subtle rounded-xl px-3 py-2 text-sm text-primary outline-none focus:ring-1 focus:ring-accent"
          />
        ) : (
          <div className="text-sm text-secondary leading-relaxed whitespace-pre-wrap break-words">
            {highlightTerms(value, highlightTermsForTarget)}
          </div>
        )}
        <div className="flex items-center gap-3">
          {editing ? (
            <button
              type="button"
              onClick={handleSaveCorrection}
              disabled={saving || !value.trim()}
              className="text-xs font-bold text-accent uppercase disabled:opacity-40"
            >
              {saving ? '…' : t('saveCorrection')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-bold text-secondary hover:text-primary uppercase"
            >
              {t('editCorrection')}
            </button>
          )}
          {saved && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-success">
              ✓ {t('correctionSaved')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Post-translation term coverage panel, shared by the text and file flows.
 *
 * - Applied fixed translations (with personal/workspace tier badge)
 * - Masked do-not-translate terms
 * - do-not-translate violations (survival guard could not preserve a term)
 * - a TM/retry info line
 * - suggested new terms with one-click add-to-glossary (text flow only, when a
 *   `sourceText` is provided)
 * - an expandable source↔target segment review with inline verified-TM
 *   corrections (file flow, when `meta.segments` is present)
 */
export default function TranslationTermPanel({
  meta,
  sourceText = null,
  canManageWorkspace = false,
  onError = () => {},
}) {
  const t = useTranslations('translatePage.terms');
  const [suggestions, setSuggestions] = useState([]);
  const [addScope, setAddScope] = useState('personal');
  const [addedTerms, setAddedTerms] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const applied = useMemo(() => meta?.applied || [], [meta]);
  const masked = useMemo(() => meta?.masked || [], [meta]);
  const violations = useMemo(() => meta?.dntViolations || [], [meta]);
  const segments = useMemo(() => meta?.segments || [], [meta]);
  const tmHits = Number(meta?.tmHits || 0);
  const retriedCount = Number(meta?.retriedSegments ?? (meta?.retried ? 1 : 0));

  const excludeTerms = useMemo(() => [
    ...applied.map((entry) => entry.source),
    ...masked.map((entry) => entry.term),
    ...violations.map((entry) => entry.term),
  ], [applied, masked, violations]);

  useEffect(() => {
    let cancelled = false;
    if (!sourceText || !sourceText.trim()) {
      setSuggestions([]);
      return undefined;
    }
    getGlossarySuggestionsForText(sourceText, { exclude: excludeTerms, limit: 12 })
      .then((payload) => {
        if (!cancelled) setSuggestions(payload?.suggestions || []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => { cancelled = true; };
  }, [sourceText, excludeTerms]);

  const handleAddTerm = useCallback(async (term) => {
    const scope = canManageWorkspace && addScope === 'workspace' ? 'workspace' : 'personal';
    try {
      await createGlossaryEntry({ source_term: term, do_not_translate: true }, scope);
      setAddedTerms((prev) => [...prev, term]);
      setSuggestions((prev) => prev.filter((entry) => entry.term !== term));
    } catch (err) {
      onError?.(err.message || t('addError'));
    }
  }, [addScope, canManageWorkspace, onError, t]);

  const hasCoverage = applied.length > 0 || masked.length > 0 || violations.length > 0;
  const hasSuggestions = suggestions.length > 0;
  const hasInfoLine = tmHits > 0 || retriedCount > 0;
  const hasSegments = segments.length > 0;

  if (!meta || (!hasCoverage && !hasSuggestions && !hasInfoLine && !hasSegments && addedTerms.length === 0)) {
    return null;
  }

  return (
    <div className="bg-surface border border-subtle rounded-2xl p-5 shadow-md space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-secondary uppercase tracking-widest">{t('title')}</h3>
      </div>

      {violations.length > 0 && (
        <div className="bg-danger/10 border border-danger/20 text-danger rounded-xl px-3 py-2 text-xs">
          <span className="font-bold">{t('violationsTitle')}:</span>{' '}
          {violations.map((entry) => entry.term).join(', ')}
          <p className="mt-1 opacity-80">{t('violationsHint')}</p>
        </div>
      )}

      {applied.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-secondary uppercase tracking-widest mb-2">{t('appliedTitle')}</p>
          <ul className="flex flex-wrap gap-2">
            {applied.map((entry) => (
              <li key={`${entry.source}-${entry.tier}`} className="inline-flex items-center gap-1.5 bg-hover-subtle border border-subtle rounded-lg px-2 py-1 text-xs text-primary">
                <span className="font-medium">{entry.source}</span>
                <span className="text-secondary">→ {entry.target}</span>
                <TierBadge tier={entry.tier} label={entry.tier === 'personal' ? t('tierPersonal') : t('tierWorkspace')} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {masked.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-secondary uppercase tracking-widest mb-2">{t('maskedTitle')}</p>
          <ul className="flex flex-wrap gap-2">
            {masked.map((entry) => (
              <li key={`${entry.term}-${entry.tier}`} className="inline-flex items-center gap-1.5 bg-hover-subtle border border-subtle rounded-lg px-2 py-1 text-xs text-primary">
                <span className="font-medium">{entry.term}</span>
                <TierBadge tier={entry.tier} label={entry.tier === 'personal' ? t('tierPersonal') : t('tierWorkspace')} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasInfoLine && (
        <p className="text-xs text-secondary">
          {tmHits > 0 && <span>{t('tmHits', { count: tmHits })}</span>}
          {tmHits > 0 && retriedCount > 0 && <span> · </span>}
          {retriedCount > 0 && <span>{t('retried', { count: retriedCount })}</span>}
        </p>
      )}

      {sourceText && (hasSuggestions || addedTerms.length > 0) && (
        <div className="border-t border-subtle pt-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{t('suggestedTitle')}</p>
            {canManageWorkspace && (
              <div className="inline-flex rounded-lg border border-subtle p-0.5" role="group" aria-label={t('scopeLabel')}>
                <button
                  type="button"
                  onClick={() => setAddScope('personal')}
                  className={`px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-widest transition-colors ${addScope === 'personal' ? 'bg-accent text-white' : 'text-secondary'}`}
                >
                  {t('scopePersonal')}
                </button>
                <button
                  type="button"
                  onClick={() => setAddScope('workspace')}
                  className={`px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-widest transition-colors ${addScope === 'workspace' ? 'bg-accent text-white' : 'text-secondary'}`}
                >
                  {t('scopeWorkspace')}
                </button>
              </div>
            )}
          </div>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((entry) => (
              <li key={entry.term}>
                <button
                  type="button"
                  onClick={() => handleAddTerm(entry.term)}
                  className="inline-flex items-center gap-1.5 bg-hover-subtle hover:bg-hover-strong border border-subtle hover:border-accent/40 rounded-lg px-2 py-1 text-xs text-primary transition-all"
                  title={t('addTitle')}
                >
                  <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  <span className="font-medium">{entry.term}</span>
                </button>
              </li>
            ))}
            {addedTerms.map((term) => (
              <li key={`added-${term}`} className="inline-flex items-center gap-1 bg-success/10 border border-success/20 text-success rounded-lg px-2 py-1 text-xs">
                ✓ {term}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-secondary">{t('addHint')}</p>
        </div>
      )}

      {hasSegments && (
        <div className="border-t border-subtle pt-4">
          <button
            type="button"
            onClick={() => setReviewOpen((prev) => !prev)}
            className="flex items-center gap-2 text-xs font-semibold text-secondary hover:text-primary uppercase tracking-widest"
            aria-expanded={reviewOpen}
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${reviewOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            {t('reviewTitle', { count: segments.length })}
          </button>
          {reviewOpen && (
            <div className="mt-3">
              <div className="hidden md:grid grid-cols-2 gap-3 pb-2 border-b border-subtle text-[10px] font-bold uppercase tracking-widest text-secondary">
                <span>{t('reviewSource')}</span>
                <span>{t('reviewTarget')}</span>
              </div>
              {segments.map((segment, index) => (
                <SegmentReviewRow
                  key={index}
                  segment={segment}
                  sourceLang={meta?.sourceLang}
                  targetLang={meta?.targetLang}
                  onError={onError}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
