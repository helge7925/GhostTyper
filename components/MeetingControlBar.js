import { useState } from 'react';
import { Loader2, Square, Languages } from 'lucide-react';
import { useUiFeedback } from '../lib/use-ui-feedback';

export default function MeetingControlBar({ transcriptionId, currentLanguage, botStatus, onChanged }) {
  const { showToast, confirm } = useUiFeedback();
  const [language, setLanguage] = useState(currentLanguage || 'de');
  const [updatingLanguage, setUpdatingLanguage] = useState(false);
  const [stopping, setStopping] = useState(false);

  const handleLanguage = async (next) => {
    if (next === language) return;
    setUpdatingLanguage(true);
    try {
      const res = await fetch(`/api/meetings/${transcriptionId}/config`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Sprache konnte nicht umgestellt werden.');
      }
      setLanguage(next);
      showToast(`Sprache auf ${next} umgestellt.`, 'success');
      onChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setUpdatingLanguage(false);
    }
  };

  const handleStop = async () => {
    const ok = await confirm({
      title: 'Bot stoppen',
      message: 'Bot aus dem Meeting entfernen? Bisher transkribierte Inhalte bleiben erhalten.',
      confirmLabel: 'Stoppen',
      danger: true,
    });
    if (!ok) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/meetings/${transcriptionId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Bot konnte nicht gestoppt werden.');
      }
      showToast('Bot-Stop angefordert.', 'success');
      onChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="bg-surface border border-accent/30 rounded-2xl p-4 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" aria-hidden />
          <div>
            <p className="text-sm font-medium text-primary">Bot ist im Meeting</p>
            <p className="text-[11px] text-secondary">Status: {botStatus || 'aktiv'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 bg-hover-subtle border border-subtle rounded-xl px-2 py-1.5">
            <Languages className="w-3.5 h-3.5 text-secondary" />
            <select
              value={language}
              disabled={updatingLanguage}
              onChange={(e) => handleLanguage(e.target.value)}
              className="bg-transparent text-xs text-primary outline-none disabled:opacity-50"
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="auto">Auto</option>
            </select>
            {updatingLanguage && <Loader2 className="w-3.5 h-3.5 animate-spin text-secondary" />}
          </div>
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs border border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {stopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
            Bot stoppen
          </button>
        </div>
      </div>
    </div>
  );
}
