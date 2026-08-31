export default function LoadingSpinner({ label = 'Lädt…' }) {
  return (
    <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
      <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
