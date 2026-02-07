import Link from 'next/link';
import StatusBadge from './StatusBadge';

export default function TranscriptionCard({ transcription }) {
  const { id, filename, status, createdAt } = transcription;

  return (
    <Link
      href={`/transcriptions/${id}`}
      className="block border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900 truncate">{filename}</h3>
        <StatusBadge status={status} />
      </div>
      <p className="text-sm text-gray-500 mt-2">
        {new Date(createdAt).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </Link>
  );
}
