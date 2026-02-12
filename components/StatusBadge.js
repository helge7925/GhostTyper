import { STATUS, STATUS_LABELS } from '../lib/constants';

const BADGE_STYLES = {
  [STATUS.PENDING]: 'bg-accent-yellow/20 text-accent-yellow',
  [STATUS.QUEUED]: 'bg-accent-yellow/20 text-accent-yellow',
  [STATUS.PROCESSING]: 'bg-accent-orange/20 text-accent-orange',
  [STATUS.TRANSCRIBED]: 'bg-accent-cyan/20 text-accent-cyan',
  [STATUS.ANALYZING]: 'bg-accent-orange/20 text-accent-orange',
  [STATUS.COMPLETED]: 'bg-accent-green/20 text-accent-green',
  [STATUS.ERROR]: 'bg-accent-red/20 text-accent-red',
};

export default function StatusBadge({ status }) {
  return (
    <span
      className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
        BADGE_STYLES[status] || 'bg-white/[0.06] text-text-secondary'
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
