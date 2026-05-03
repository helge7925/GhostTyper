import { STATUS, STATUS_LABELS } from '../lib/constants';
import { useTranslations } from '../lib/i18n';

const BADGE_STYLES = {
  [STATUS.PENDING]: 'bg-warning/20 text-warning',
  [STATUS.QUEUED]: 'bg-warning/20 text-warning',
  [STATUS.PROCESSING]: 'bg-accent/20 text-accent',
  [STATUS.TRANSCRIBED]: 'bg-info/20 text-info',
  [STATUS.ANALYZING]: 'bg-accent/20 text-accent',
  [STATUS.COMPLETED]: 'bg-success/20 text-success',
  [STATUS.ERROR]: 'bg-danger/20 text-danger',
};

export default function StatusBadge({ status }) {
  const t = useTranslations('transcriptions.status');
  // Try the translation first; fall back to the German constant when the
  // status code isn't covered by the catalog (e.g. legacy `queued`).
  const translated = t(status);
  const label = translated && translated !== status
    ? translated
    : STATUS_LABELS[status] || status;
  return (
    <span
      className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
        BADGE_STYLES[status] || 'bg-hover text-secondary'
      }`}
    >
      {label}
    </span>
  );
}
