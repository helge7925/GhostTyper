import Link from 'next/link';
import StatusBadge from './StatusBadge';

export default function TranscriptionCard({ transcription }) {
  const { id, original_name, filename, status, template, created_at, createdAt } = transcription;
  const displayName = original_name || filename;
  const date = created_at || createdAt;

  return (
    <Link
      href={`/transcriptions/${id}`}
      className="block bg-dark-card border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.12] transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-text-primary truncate">{displayName}</h3>
          <p className="text-xs text-text-secondary mt-1">
            {new Date(date).toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {template && (
              <span className="ml-2 text-text-secondary/60">{template}</span>
            )}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
    </Link>
  );
}
