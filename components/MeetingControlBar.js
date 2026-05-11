import { useEffect, useState } from 'react';
import { Loader2, Square, Languages, ArrowLeftRight, Share2, Copy, Check, Tv, Volume2 } from 'lucide-react';
import { useUiFeedback } from '../lib/use-ui-feedback';

export default function MeetingControlBar({
  transcriptionId,
  currentLanguage,
  botStatus,
  translationConfig,
  inMeetingOverlayEnabled = false,
  audioInjectionLang = null,
  onChanged,
}) {
  // `useUiFeedback().confirm()` requires the consumer to render <ConfirmDialog />
  // locally — this component does not, so the promise from `confirm()` would
  // never resolve and the Stop button would silently hang. We use the browser
  // native confirm here; it also lets us spell out the Whisper-chunk caveat.
  const { showToast } = useUiFeedback();
  const [language, setLanguage] = useState(currentLanguage || 'de');
  const [updatingLanguage, setUpdatingLanguage] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [updatingTranslation, setUpdatingTranslation] = useState(false);

  const translationOn = !!translationConfig?.enabled;
  const translationFrom = translationConfig?.fromLang || 'de';
  const translationTo = translationConfig?.toLang || 'en';

  const sendTranslation = async (next) => {
    setUpdatingTranslation(true);
    try {
      const res = await fetch(`/api/meetings/${transcriptionId}/translation`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Übersetzung konnte nicht aktualisiert werden.');
      }
      showToast(next.enabled ? 'Live-Übersetzung aktiv.' : 'Live-Übersetzung deaktiviert.', 'success');
      onChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setUpdatingTranslation(false);
    }
  };

  const handleTranslationToggle = (event) => {
    if (event.target.checked) {
      sendTranslation({ enabled: true, fromLang: translationFrom, toLang: translationTo });
    } else {
      sendTranslation({ enabled: false });
    }
  };

  const handleSwapLanguages = () => {
    if (!translationOn) return;
    sendTranslation({ enabled: true, fromLang: translationTo, toLang: translationFrom });
  };

  // Overlay toggle: piggy-backs on the same /translation PUT endpoint
  // by sending the current translation config + the overlay flag.
  const [updatingOverlay, setUpdatingOverlay] = useState(false);
  // Audio-injection live-toggle. Sends the same /translation PUT
  // with `audioInjectionLang: <lang>` to start, or `null` to stop.
  const [updatingAudio, setUpdatingAudio] = useState(false);
  const handleAudioToggle = async (next) => {
    if (!translationOn) return;
    setUpdatingAudio(true);
    try {
      const res = await fetch(`/api/meetings/${transcriptionId}/translation`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          fromLang: translationFrom,
          toLang: translationTo,
          audioInjectionLang: next,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Audio-Injection konnte nicht aktualisiert werden.');
      }
      showToast(next ? `Audio-Injection: bot spricht ${next.toUpperCase()}.` : 'Audio-Injection deaktiviert.', 'success');
      onChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setUpdatingAudio(false);
    }
  };

  const handleOverlayToggle = async (event) => {
    if (!translationOn) return;
    const next = event.target.checked;
    setUpdatingOverlay(true);
    try {
      const res = await fetch(`/api/meetings/${transcriptionId}/translation`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          fromLang: translationFrom,
          toLang: translationTo,
          inMeetingOverlay: next,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Untertitel-Kachel konnte nicht aktualisiert werden.');
      }
      showToast(next ? 'Untertitel-Kachel aktiv.' : 'Untertitel-Kachel deaktiviert.', 'success');
      onChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setUpdatingOverlay(false);
    }
  };

  // Share-link state. We hydrate it once on mount via GET so a page
  // reload still surfaces an already-active share — and re-fetch every
  // time the toggle is flipped so the UI reflects what's actually in
  // the DB rather than just what we wished for locally.
  const [shareActive, setShareActive] = useState(false);
  const [shareToken, setShareToken] = useState(null);
  const [shareExpiresAt, setShareExpiresAt] = useState(null);
  const [shareUpdating, setShareUpdating] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (!translationOn) return;
    let cancelled = false;
    fetch(`/api/meetings/${transcriptionId}/share`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        setShareActive(!!payload.active);
        setShareToken(payload.token || null);
        setShareExpiresAt(payload.expiresAt || null);
      })
      .catch(() => { /* ignore — share is just unavailable */ });
    return () => { cancelled = true; };
  }, [transcriptionId, translationOn]);

  const buildShareUrl = (token) => {
    if (typeof window === 'undefined' || !token) return '';
    return `${window.location.origin}/share/${encodeURIComponent(token)}`;
  };

  const handleShareToggle = async (event) => {
    const wantOn = event.target.checked;
    setShareUpdating(true);
    try {
      const res = await fetch(`/api/meetings/${transcriptionId}/share`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: wantOn }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || 'Share-Link konnte nicht aktualisiert werden.');
      setShareActive(!!payload.active);
      setShareToken(payload.token || null);
      setShareExpiresAt(payload.expiresAt || null);
      showToast(wantOn ? 'Share-Link aktiv.' : 'Share-Link deaktiviert.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setShareUpdating(false);
    }
  };

  const handleCopyShare = async () => {
    const url = buildShareUrl(shareToken);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      showToast('Konnte Link nicht kopieren — bitte manuell aus der Adresszeile.', 'error');
    }
  };

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
    if (typeof window !== 'undefined' && !window.confirm(
      'Bot jetzt aus dem Meeting entfernen?\n\n' +
      'Wichtig: Whisper transkribiert in 20–30-Sekunden-Blöcken. Ein Block, der gerade läuft, ' +
      'wenn der Bot stoppt, geht verloren – bis zu ~30 Sekunden Audio am Ende fehlen dann ' +
      'eventuell im Transkript.\n\n' +
      'Für ein vollständiges Transkript: das Meeting natürlich beenden lassen, der Bot verlässt ' +
      'es dann automatisch nach Verarbeitung des letzten Blocks.'
    )) {
      return;
    }
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
    <div className="bg-surface border border-accent/30 rounded-2xl p-4 shadow-lg space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" aria-hidden />
          <div>
            <p className="text-sm font-medium text-primary">Bot ist im Meeting</p>
            <p className="text-[11px] text-secondary">Status: {botStatus || 'aktiv'}</p>
          </div>
        </div>
        {/* flex-wrap + justify-end so the toggle row stays right-aligned
            but breaks into a second row instead of overflowing when
            translation/overlay/audio toggles are all visible. */}
        <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
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
          <label
            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs border border-subtle bg-hover-subtle cursor-pointer"
            title="Live-Übersetzung an/aus"
          >
            <input
              type="checkbox"
              checked={translationOn}
              disabled={updatingTranslation}
              onChange={handleTranslationToggle}
              className="accent-accent"
            />
            <span className="text-secondary">Übersetzung</span>
            {translationOn && (
              <>
                <span className="text-primary font-mono">{translationFrom}↔{translationTo}</span>
                <button
                  type="button"
                  onClick={handleSwapLanguages}
                  disabled={updatingTranslation}
                  className="text-secondary hover:text-primary disabled:opacity-50"
                  aria-label="Sprachpaar tauschen"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                </button>
              </>
            )}
            {updatingTranslation && <Loader2 className="w-3 h-3 animate-spin text-secondary" />}
          </label>

          {translationOn && (
            <label
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs border border-subtle bg-hover-subtle cursor-pointer"
              title="Untertitel-Kachel im Meeting (Bot-Webcam)"
            >
              <Tv className="w-3.5 h-3.5 text-secondary" />
              <input
                type="checkbox"
                checked={inMeetingOverlayEnabled}
                disabled={updatingOverlay}
                onChange={handleOverlayToggle}
                className="accent-accent"
              />
              <span className="text-secondary">Untertitel-Kachel</span>
              {updatingOverlay && <Loader2 className="w-3 h-3 animate-spin text-secondary" />}
            </label>
          )}

          {translationOn && (
            <label
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs border border-subtle bg-hover-subtle cursor-pointer"
              title="Audio-Injection — Bot spricht Übersetzung im Meeting"
            >
              <Volume2 className="w-3.5 h-3.5 text-secondary" />
              <input
                type="checkbox"
                checked={!!audioInjectionLang}
                disabled={updatingAudio}
                onChange={(e) => handleAudioToggle(e.target.checked ? translationTo : null)}
                className="accent-accent"
              />
              <span className="text-secondary">Audio</span>
              {audioInjectionLang && (
                <select
                  value={audioInjectionLang}
                  disabled={updatingAudio}
                  onChange={(e) => handleAudioToggle(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent text-primary font-mono text-xs outline-none"
                >
                  <option value={translationFrom}>{translationFrom.toUpperCase()}</option>
                  <option value={translationTo}>{translationTo.toUpperCase()}</option>
                </select>
              )}
              {updatingAudio && <Loader2 className="w-3 h-3 animate-spin text-secondary" />}
            </label>
          )}

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

      {translationOn && (
        <div className="border-t border-subtle pt-3 space-y-2">
          <div className="flex items-center gap-3">
            <Share2 className="w-4 h-4 text-secondary shrink-0" />
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={shareActive}
                disabled={shareUpdating}
                onChange={handleShareToggle}
                className="accent-accent"
              />
              <span className="text-primary font-medium">
                Public Share-Link für Übersetzung
              </span>
            </label>
            {shareUpdating && <Loader2 className="w-3.5 h-3.5 animate-spin text-secondary" />}
          </div>
          {!shareActive && (
            <p className="text-[11px] text-secondary leading-relaxed">
              Mit Link teilen alle anderen Teilnehmer dieselbe Live-Übersetzung sehen und hören —
              ohne GhostTyper-Account. Nur das Übersetzungs-Panel wird freigegeben, nicht der Editor
              oder die Analyse.
            </p>
          )}
          {shareActive && shareToken && (
            <div className="flex items-center gap-2 bg-hover-subtle border border-subtle rounded-xl px-3 py-2">
              <input
                type="text"
                readOnly
                value={buildShareUrl(shareToken)}
                onClick={(e) => e.target.select()}
                className="flex-1 bg-transparent text-xs text-primary outline-none truncate"
              />
              <button
                type="button"
                onClick={handleCopyShare}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border border-subtle text-primary hover:bg-surface-elevated"
              >
                {shareCopied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                {shareCopied ? 'Kopiert' : 'Kopieren'}
              </button>
            </div>
          )}
          {shareActive && shareExpiresAt && (
            <p className="text-[10px] text-secondary">
              Gültig bis {new Date(shareExpiresAt).toLocaleString()}. Jeder mit dem Link sieht das
              Original- und das Übersetzungs-Transkript live.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
