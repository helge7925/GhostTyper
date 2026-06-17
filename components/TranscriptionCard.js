import Link from 'next/link';
import StatusBadge from './StatusBadge';
import AddToKnowledgeButton from './AddToKnowledgeButton';
import { useFormatter, useLocale, useTranslations } from '../lib/i18n';

const TEMPLATE_LABELS = {
  generic: { de: 'Zusammenfassung', en: 'Summary' },
  meeting: { de: 'Meeting', en: 'Meeting' },
  data_table: { de: 'Datentabelle', en: 'Data table' },
  // Legacy label so cards for pre-existing aufmass rows still render.
  aufmass: { de: 'Aufmaß', en: 'Measurements' },
};

export default function TranscriptionCard({
  transcription,
  folders = [],
  onMove,
  onToggleFavorite,
  onReindex,
  reindexing = false,
  onDelete,
  canAddToKnowledge = false,
}) {
  const {
    id,
    transcription_id,
    title,
    source_type,
    visibility,
    original_name,
    filename,
    status,
    template,
    mime_type,
    folder_id,
    is_favorite,
    chunk_count,
    index_job_status,
    index_job_error,
    created_at,
    createdAt,
  } = transcription;
  const displayName = title || original_name || filename;
  const detailHref = transcription_id ? `/transcriptions/${transcription_id}` : `/documents/${id}`;
  const date = created_at || createdAt;
  const tNav = useTranslations('nav');
  const tList = useTranslations('transcriptions');
  const tDetail = useTranslations('transcriptionDetail');
  const { locale } = useLocale();
  const { dateTime } = useFormatter();

  const isOCR = source_type === 'ocr' || mime_type?.startsWith('image/') || mime_type === 'application/pdf';
  const isTranslation = source_type === 'translation' || template === 'translation';
  const isDataTable = source_type === 'data_table';
  const isMeeting = source_type === 'meeting';
  const hasChunks = Number(chunk_count || 0) > 0;
  const effectiveIndexStatus = reindexing ? 'processing' : index_job_status;
  const indexStatusLabel = effectiveIndexStatus === 'processing' ? 'Index läuft'
    : effectiveIndexStatus === 'queued' ? 'Index wartet'
    : effectiveIndexStatus === 'completed' ? `Indexiert${hasChunks ? ` · ${chunk_count}` : ''}`
    : effectiveIndexStatus === 'error' ? 'Indexfehler'
    : hasChunks ? `Indexiert · ${chunk_count}`
    : 'Nicht indexiert';
  const indexStatusClass = effectiveIndexStatus === 'processing' || effectiveIndexStatus === 'queued'
    ? 'bg-info/10 text-info border-info/20'
    : effectiveIndexStatus === 'completed' || hasChunks
      ? 'bg-success/10 text-success border-success/20'
      : effectiveIndexStatus === 'error'
        ? 'bg-danger/10 text-danger border-danger/20'
        : 'bg-hover-subtle text-secondary border-subtle';
  const templateLabel = TEMPLATE_LABELS[template]
    ? TEMPLATE_LABELS[template][locale] || TEMPLATE_LABELS[template].de
    : template;

  let typeLabel = tNav('transcription');
  let Icon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
  );
  let iconColor = 'bg-accent/10 text-accent';

  if (isMeeting) {
    typeLabel = tNav('remoteMeeting');
    iconColor = 'bg-purple-500/10 text-purple-400';
  } else if (isDataTable) {
    typeLabel = tNav('tables');
    iconColor = 'bg-cyan-500/10 text-info';
  } else if (isOCR) {
    typeLabel = tNav('ocr');
    iconColor = 'bg-info/10 text-info';
    Icon = (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  } else if (isTranslation) {
    typeLabel = tNav('translation');
    iconColor = 'bg-success/10 text-success';
    Icon = (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
      </svg>
    );
  }

  return (
    <div className="group relative bg-surface border border-subtle rounded-xl p-4 hover:border-emphasis transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {onToggleFavorite && (
            <button 
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
              className={`shrink-0 transition-colors ${is_favorite ? 'text-accent' : 'text-secondary/30 hover:text-accent/50'}`}
              title={is_favorite ? tDetail('unfavorite') : tDetail('favorite')}
              aria-label={is_favorite ? `${displayName} — ${tDetail('unfavorite')}` : `${displayName} — ${tDetail('favorite')}`}
            >
              <svg className="w-5 h-5" fill={is_favorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          )}

          <Link href={detailHref} className="flex items-center gap-4 flex-1 min-w-0">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
              {Icon}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-primary truncate group-hover:text-accent transition-colors">{displayName}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-hover-subtle text-secondary uppercase tracking-widest font-bold shrink-0">
                  {typeLabel}
                </span>
                {visibility && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-hover-subtle text-secondary uppercase tracking-widest font-bold shrink-0">
                    {visibility === 'private' ? 'Privat' : 'Workspace'}
                  </span>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-widest font-bold shrink-0 ${indexStatusClass}`}
                  title={index_job_error || indexStatusLabel}
                >
                  {indexStatusLabel}
                </span>
              </div>
              <p className="text-xs text-secondary mt-1">
                {dateTime.format(new Date(date))}
                {templateLabel && (
                  <span className="ml-2 text-secondary/60 italic">&bull; {templateLabel}</span>
                )}
              </p>
            </div>
          </Link>
        </div>
        
        <div className="flex items-center gap-3 sm:shrink-0 ml-14 sm:ml-0">
          {folders.length > 0 && (
            <select
              value={folder_id || ''}
              onChange={(e) => onMove(e.target.value === '' ? null : parseInt(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              aria-label={`${displayName} — ${tDetail('moveToFolder')}`}
              className="bg-hover-subtle border border-subtle text-[10px] text-secondary rounded px-2 py-1 outline-none hover:border-accent/50 transition-colors cursor-pointer max-w-[120px] truncate"
            >
              <option value="">{tList('noFolder')}</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <StatusBadge status={status} />
          {canAddToKnowledge && visibility === 'workspace' && (
            <AddToKnowledgeButton documentId={id} displayName={displayName} />
          )}
          {onReindex && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReindex(); }}
              disabled={reindexing}
              className="p-2 text-secondary hover:text-accent hover:bg-accent/10 rounded-lg transition-all disabled:opacity-50 disabled:cursor-wait"
              title={reindexing ? 'Index wird erstellt' : 'Index neu erstellen'}
              aria-label={`${displayName} — ${reindexing ? 'Index wird erstellt' : 'Index neu erstellen'}`}
            >
              <svg className={`w-4 h-4 ${reindexing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
              className="p-2 text-secondary hover:text-danger hover:bg-danger/10 rounded-lg transition-all"
              title={tDetail('delete')}
              aria-label={`${displayName} — ${tDetail('delete')}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
