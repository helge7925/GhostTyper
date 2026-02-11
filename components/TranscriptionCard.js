import Link from 'next/link';
import StatusBadge from './StatusBadge';

export default function TranscriptionCard({ transcription, folders = [], onMove, onToggleFavorite }) {

    const { id, original_name, filename, status, template, mime_type, folder_id, is_favorite, created_at, createdAt } = transcription;

    const displayName = original_name || filename;

    const date = created_at || createdAt;

  

    const isOCR = mime_type?.startsWith('image/') || mime_type === 'application/pdf';

    const isTextAssistant = template === 'text-assistant';

    const isTranslation = template === 'translation';

  

    let typeLabel = 'Transkription';

    if (isOCR) typeLabel = 'Dokument';

    if (isTextAssistant) typeLabel = 'Text-Assistent';

    if (isTranslation) typeLabel = 'Übersetzung';

  



  return (

    <div className="group relative bg-dark-card border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.12] transition-colors">

      <div className="flex items-center gap-4">

        {onToggleFavorite && (

          <button 

            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}

            className={`shrink-0 transition-colors ${is_favorite ? 'text-accent-orange' : 'text-text-secondary/30 hover:text-accent-orange/50'}`}

            title={is_favorite ? 'Von Favoriten entfernen' : 'Als Favorit markieren'}

          >

            <svg className="w-5 h-5" fill={is_favorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">

              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />

            </svg>

          </button>

        )}



        <Link href={`/transcriptions/${id}`} className="flex items-center gap-4 flex-1 min-w-0">



          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isOCR ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-accent-orange/10 text-accent-orange'}`}>

            {isOCR ? (

              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />

              </svg>

            ) : (

              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />

              </svg>

            )}

          </div>



          <div className="min-w-0 flex-1">

            <div className="flex items-center gap-2">

              <h3 className="text-sm font-medium text-text-primary truncate group-hover:text-accent-orange transition-colors">{displayName}</h3>

              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-text-secondary uppercase tracking-widest font-bold">

                {typeLabel}

              </span>

            </div>

            <p className="text-xs text-text-secondary mt-1">

              {new Date(date).toLocaleDateString('de-DE', {

                day: '2-digit',

                month: '2-digit',

                year: 'numeric',

                hour: '2-digit',

                minute: '2-digit',

              })}

              {template && (

                <span className="ml-2 text-text-secondary/60 italic">&bull; {template === 'generic' ? 'Zusammenfassung' : template}</span>

              )}

            </p>

          </div>

        </Link>

        

        <div className="flex items-center gap-3">

          {folders.length > 0 && (

            <select

              value={folder_id || ''}

              onChange={(e) => onMove(e.target.value === '' ? null : parseInt(e.target.value))}

              onClick={(e) => e.stopPropagation()}

              className="bg-white/5 border border-white/[0.06] text-[10px] text-text-secondary rounded px-2 py-1 outline-none hover:border-accent-orange/50 transition-colors cursor-pointer"

            >

              <option value="">Kein Ordner</option>

              {folders.map(f => (

                <option key={f.id} value={f.id}>{f.name}</option>

              ))}

            </select>

          )}

          <StatusBadge status={status} />

        </div>

      </div>

    </div>

  );

}
