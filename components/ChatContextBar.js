import { BookOpen, FileText, Loader2, Sparkles, X } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

/**
 * Compact "the AI sees:" bar shown directly above the chat composer. Lists the
 * attached sources (documents / knowledge bases) as removable chips, plus a
 * non-removable chip for the conversation's origin snapshot (transcription, OCR,
 * …) when present. Attaching is handled separately by ChatSourcePicker (📎).
 */
export default function ChatContextBar({ items = [], onRemove, snapshot = null, pending = [], disabled = false }) {
  const t = useTranslations('chatPage');

  if ((!items || items.length === 0) && !snapshot && (!pending || pending.length === 0)) return null;

  return (
    <div className="px-4 pt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-medium text-secondary mr-0.5">{t('sourcesLabel')}</span>

      {snapshot && (
        <span className="inline-flex items-center gap-1 max-w-[240px] px-2 py-0.5 rounded-full bg-info/10 text-info text-[11px] border border-info/20">
          <Sparkles className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate" title={`${snapshot.label}${snapshot.title ? ` – ${snapshot.title}` : ''}`}>
            {snapshot.label}{snapshot.title ? ` – ${snapshot.title}` : ''}
          </span>
        </span>
      )}

      {items.map((item) => (
        <span key={item.id} className="inline-flex items-center gap-1 max-w-[220px] pl-2 pr-1 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] border border-accent/20">
          {item.context_type === 'knowledge_base' ? <BookOpen className="w-2.5 h-2.5 shrink-0" /> : <FileText className="w-2.5 h-2.5 shrink-0" />}
          <span className="truncate" title={item.title}>{item.title || t('sourceFallback', { index: item.document_id || item.knowledge_base_id })}</span>
          <button
            type="button"
            onClick={() => onRemove(item)}
            disabled={disabled}
            aria-label={t('contextRemove')}
            className="shrink-0 rounded-full p-0.5 hover:bg-accent/20 disabled:opacity-40"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}

      {pending.map((up) => (
        <span key={up.id} className="inline-flex items-center gap-1 max-w-[220px] px-2 py-0.5 rounded-full bg-subtle text-secondary text-[11px] border border-subtle">
          <Loader2 className="w-2.5 h-2.5 shrink-0 animate-spin" />
          <span className="truncate" title={up.name}>{up.name}</span>
          <span className="opacity-70">· {t('uploadProcessing')}</span>
        </span>
      ))}
    </div>
  );
}
