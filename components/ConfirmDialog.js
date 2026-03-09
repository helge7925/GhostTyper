import { useEffect } from 'react';

export default function ConfirmDialog({
  open,
  title = 'Bitte bestätigen',
  message = 'Möchten Sie fortfahren?',
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busy) onCancel?.();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel?.();
      }}
    >
      <div className="w-full max-w-md bg-dark-card border border-white/[0.08] rounded-2xl shadow-2xl p-5">
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-text-primary">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm text-text-secondary">
          {message}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-xl border border-white/15 text-text-secondary hover:text-text-primary hover:bg-white/5 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded-xl font-semibold disabled:opacity-50 ${
              danger
                ? 'bg-accent-red/20 text-accent-red border border-accent-red/40 hover:bg-accent-red/30'
                : 'gradient-accent text-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
