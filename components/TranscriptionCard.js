import Link from 'next/link';
import StatusBadge from './StatusBadge';

export default function TranscriptionCard({ transcription }) {
  const { id, original_name, filename, status, template, created_at, createdAt } = transcription;
  const displayName = original_name || filename;
  const date = created_at || createdAt;

  return (
    <Link
      href={`/transcriptions/${id}`}
      className="block bg-white rounded-lg shadow-card hover:shadow-card-hover p-4 transition-shadow"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-google-gray-900 truncate">{displayName}</h3>
          <p className="text-xs text-google-gray-500 mt-1">
            {new Date(date).toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {template && (
              <span className="ml-2 text-google-gray-400">{template}</span>
            )}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
    </Link>
  );
}
