import { STATUS, STATUS_LABELS } from '../lib/constants';

const BADGE_STYLES = {
  [STATUS.PENDING]: 'bg-yellow-100 text-yellow-800',
  [STATUS.PROCESSING]: 'bg-blue-100 text-blue-800',
  [STATUS.COMPLETED]: 'bg-green-100 text-green-800',
  [STATUS.ERROR]: 'bg-red-100 text-red-800',
};

export default function StatusBadge({ status }) {
  return (
    <span
      className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
        BADGE_STYLES[status] || 'bg-gray-100 text-gray-800'
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
