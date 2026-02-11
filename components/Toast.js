import { useEffect } from 'react';

export default function Toast({ message, type = 'info', duration = 5000, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const styles = {
    info: 'bg-accent-orange/20 border-accent-orange/40 text-accent-orange',
    success: 'bg-green-500/20 border-green-500/40 text-green-400',
    error: 'bg-accent-red/20 border-accent-red/40 text-accent-red',
  };

  return (
    <div
      className={`fixed top-20 right-6 z-50 max-w-sm border rounded-lg px-4 py-3 shadow-lg transition-opacity duration-300 ${styles[type] || styles.info}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-sm font-medium flex-1">{message}</span>
        <button onClick={onClose} className="text-current opacity-60 hover:opacity-100 flex-shrink-0">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
