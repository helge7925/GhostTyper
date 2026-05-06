import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, Languages, Clock, Wifi, WifiOff } from 'lucide-react';

/**
 * Public companion view for a shared live-translation meeting.
 *
 * Renders WITHOUT the GhostTyper layout (no sidebar, no auth gating)
 * — visitors of this URL aren't necessarily logged in. The page only
 * sees what `/api/share/[token]` returns: original segments, translated
 * segments, translation_config, and the share-link expiry.
 *
 * Live updates come over an SSE channel, audio over a chunked PCM
 * stream — both keyed by the same token. If the owner revokes the
 * share or the meeting ends + grace expires, both endpoints close
 * cleanly and the UI shows the corresponding state.
 */
export default function PublicSharePage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : null;

  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [closedReason, setClosedReason] = useState(null);
  const [audioActive, setAudioActive] = useState(false);
  const [listenLang, setListenLang] = useState(null);
  const [connected, setConnected] = useState(false);
  const audioRef = useRef(null);

  const config = snapshot?.translationConfig || null;
  const langA = config?.fromLang || 'de';
  const langB = config?.toLang || 'en';

  // Initial fetch — short-circuits NOT_FOUND / expired so the SSE
  // path doesn't have to render its own first-time error.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error('NOT_FOUND');
          throw new Error('LOAD_FAILED');
        }
        return res.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setSnapshot(payload);
        // Default the listen language to whichever side isn't the
        // original — i.e. show people the translated audio.
        setListenLang(payload.translationConfig?.toLang || 'en');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'LOAD_FAILED');
      });
    return () => { cancelled = true; };
  }, [token]);

  // SSE for live updates.
  useEffect(() => {
    if (!token || error) return;
    const es = new EventSource(`/api/share/${encodeURIComponent(token)}/stream`);
    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));
    es.addEventListener('snapshot', (event) => {
      try {
        const data = JSON.parse(event.data);
        setSnapshot(data);
        setConnected(true);
      } catch { /* ignore malformed event */ }
    });
    es.addEventListener('closed', (event) => {
      try {
        const data = JSON.parse(event.data);
        setClosedReason(data.reason || 'closed');
      } catch {
        setClosedReason('closed');
      }
      setConnected(false);
      es.close();
    });
    return () => es.close();
  }, [token, error]);

  const audioSrc = useMemo(() => {
    if (!token || !audioActive || !listenLang) return '';
    return `/api/share/${encodeURIComponent(token)}/audio?lang=${encodeURIComponent(listenLang)}`;
  }, [token, audioActive, listenLang]);

  const segments = snapshot?.segments || [];
  const translated = snapshot?.translatedSegments || [];

  // Render branches.
  if (error === 'NOT_FOUND') {
    return (
      <Centered>
        <h1 className="text-xl font-semibold text-primary mb-2">Link nicht verfügbar</h1>
        <p className="text-sm text-secondary">
          Dieser Übersetzungs-Link ist abgelaufen oder wurde widerrufen. Bitte den Meeting-Organisator nach einem neuen Link fragen.
        </p>
      </Centered>
    );
  }
  if (error) {
    return (
      <Centered>
        <h1 className="text-xl font-semibold text-primary mb-2">Konnte nicht geladen werden</h1>
        <p className="text-sm text-secondary">Bitte später erneut versuchen.</p>
      </Centered>
    );
  }
  if (!snapshot) {
    return (
      <Centered>
        <p className="text-sm text-secondary">Lade …</p>
      </Centered>
    );
  }
  if (!config?.enabled) {
    return (
      <Centered>
        <h1 className="text-xl font-semibold text-primary mb-2">Übersetzung ist deaktiviert</h1>
        <p className="text-sm text-secondary">
          Der Meeting-Organisator hat die Live-Übersetzung gerade nicht aktiv.
        </p>
      </Centered>
    );
  }

  return (
    <>
      <Head>
        <title>Live-Übersetzung · GhostTyper</title>
        {/* This page is intentionally not indexed — share-tokens
            shouldn't end up in search-engine caches. */}
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main className="min-h-screen bg-canvas text-primary">
        <header className="border-b border-subtle px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Languages className="w-5 h-5 text-accent" />
            <div>
              <p className="text-xs uppercase tracking-widest text-secondary font-bold">Live-Übersetzung</p>
              <p className="text-sm text-primary font-medium">{langA} ↔ {langB}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-secondary">
            {connected ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Wifi className="w-3.5 h-3.5" /> Verbunden
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-warning">
                <WifiOff className="w-3.5 h-3.5" /> Offline
              </span>
            )}
            {snapshot.expiresAt && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Läuft ab {new Date(snapshot.expiresAt).toLocaleString()}
              </span>
            )}
          </div>
        </header>

        <div className="px-4 py-3 border-b border-subtle bg-surface flex flex-wrap items-center gap-3">
          <span className="text-xs text-secondary">Übersetzung anhören:</span>
          <select
            value={listenLang || ''}
            onChange={(e) => {
              setListenLang(e.target.value);
              if (audioRef.current) {
                audioRef.current.load();
                if (audioActive) audioRef.current.play().catch(() => {});
              }
            }}
            className="bg-surface-elevated border border-subtle rounded-lg px-2 py-1 text-xs text-primary outline-none"
          >
            <option value={langA}>{langA}</option>
            <option value={langB}>{langB}</option>
          </select>
          {audioActive ? (
            <button
              type="button"
              onClick={() => {
                setAudioActive(false);
                if (audioRef.current) audioRef.current.pause();
              }}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs border border-subtle text-primary hover:bg-hover-subtle"
            >
              <VolumeX className="w-3.5 h-3.5" /> Audio stoppen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAudioActive(true);
                setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
              }}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs border border-accent/40 text-accent hover:bg-accent/10"
            >
              <Volume2 className="w-3.5 h-3.5" /> Audio aktivieren
            </button>
          )}
          {closedReason && (
            <span className="text-xs text-warning ml-auto">
              {closedReason === 'token_revoked_or_expired'
                ? 'Der Organisator hat die Freigabe beendet.'
                : 'Verbindung beendet.'}
            </span>
          )}
        </div>

        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          ref={audioRef}
          src={audioSrc}
          autoPlay={audioActive}
          controls={false}
          className="hidden"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 max-w-6xl mx-auto">
          <Column title="Original" segments={segments} fallbackLang={langA} accent="text-secondary" />
          <Column title="Übersetzung" segments={translated} fallbackLang={langB} accent="text-accent" />
        </div>
      </main>
    </>
  );
}

PublicSharePage.noLayout = true;

function Column({ title, segments, fallbackLang, accent }) {
  return (
    <section>
      <p className="text-[10px] uppercase tracking-widest text-secondary font-bold mb-3">{title}</p>
      <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-2">
        {segments.length === 0 ? (
          <p className="text-xs text-secondary italic">Noch keine Segmente.</p>
        ) : (
          segments.map((seg, idx) => (
            <p key={`${title}-${idx}-${seg.start}`} className="text-sm text-primary leading-relaxed">
              <span className={`text-[10px] uppercase ${accent} mr-2`}>
                {seg.language || fallbackLang}
              </span>
              {seg.text}
            </p>
          ))
        )}
      </div>
    </section>
  );
}

function Centered({ children }) {
  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="max-w-md text-center bg-surface border border-subtle rounded-2xl p-8 shadow-xl">
        {children}
      </div>
    </main>
  );
}
