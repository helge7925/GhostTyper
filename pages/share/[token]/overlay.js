import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

/**
 * Bot-camera overlay page.
 *
 * The Vexa bot loads this URL into its hidden 1920×1080 canvas via the
 * `getUserMedia` patch, and that canvas becomes the bot's "webcam"
 * feed in the meeting. Participants see this layout on the bot's
 * gallery tile.
 *
 * Implementation choice: this page is **fully client-side**. We skip
 * `getServerSideProps` because importing `lib/share-tokens` (and its
 * transitive `lib/db` dependency) at build-time triggers
 * "DATABASE_URL ist nicht gesetzt" during `next build`'s page-data
 * collection. Going client-side avoids that import-time coupling and
 * keeps the page reachable as a simple static asset whose runtime
 * state is hydrated via:
 *   - GET  /api/share/:token         → initial snapshot
 *   - GET  /api/share/:token/stream  → SSE updates
 *   - GET  /api/share/:token/qr.svg  → server-rendered QR (cached 60s)
 *
 * Design constraints derived from the Vexa source + Meet/Teams gallery
 * physics:
 *   - The canvas is 1920×1080 but the gallery tile downsamples it to
 *     anything from full-screen (someone pinned the bot) to ~160 px
 *     (12-tile grid on mobile). Subtitles must be readable at the
 *     small end; QR must be scannable at the small end too.
 *   - Pure HTML/CSS, no external scripts. Inline SVG via `<img>`
 *     because dangerouslySetInnerHTML at the top-level of the page
 *     wouldn't survive Next's hydration cleanly for a string we don't
 *     have at SSR time.
 *   - No interaction surface — nobody can click on the bot's camera
 *     feed, so links/buttons are irrelevant.
 *
 * Failure modes:
 *   - Token unknown / expired → render a clear "Token abgelaufen"
 *     screen so a stale overlay can't silently confuse participants.
 *   - SSE drops mid-meeting → show a small offline indicator, keep the
 *     last-known subtitle visible. EventSource auto-reconnects.
 */
export default function OverlayPage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : null;

  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);

  // Initial snapshot fetch — same call the companion-tab uses.
  useEffect(() => {
    if (!token) return undefined;
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
        if (payload.status && !['pending', 'processing'].includes(payload.status)) {
          setMeetingEnded(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'LOAD_FAILED');
      });
    return () => { cancelled = true; };
  }, [token]);

  // SSE for live updates.
  useEffect(() => {
    if (!token || error || meetingEnded) return undefined;
    const es = new EventSource(`/api/share/${encodeURIComponent(token)}/stream`);
    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));
    es.addEventListener('snapshot', (event) => {
      try {
        const data = JSON.parse(event.data);
        setSnapshot(data);
        setConnected(true);
        if (data.status && !['pending', 'processing'].includes(data.status)) {
          setMeetingEnded(true);
        }
      } catch { /* ignore malformed event */ }
    });
    es.addEventListener('closed', () => {
      setConnected(false);
      setMeetingEnded(true);
      es.close();
    });
    return () => es.close();
  }, [token, error, meetingEnded]);

  const config = snapshot?.translationConfig || null;
  const langA = (config?.fromLang || 'de').toUpperCase();
  const langB = (config?.toLang || 'en').toUpperCase();

  const latest = useMemo(() => {
    const segs = snapshot?.translatedSegments;
    if (!Array.isArray(segs) || segs.length === 0) return null;
    return segs[segs.length - 1];
  }, [snapshot]);

  const shareUrlForDisplay = useMemo(() => {
    if (typeof window === 'undefined' || !token) return '';
    return `${window.location.origin}/share/${encodeURIComponent(token)}`;
  }, [token]);

  // Token unknown / expired → static error page.
  if (error === 'NOT_FOUND') {
    return (
      <ShellHtml>
        <div style={errorBoxStyle}>
          <p style={{ fontSize: 64, fontWeight: 700, margin: 0 }}>Übersetzungs-Link ungültig</p>
          <p style={{ fontSize: 28, marginTop: 24, opacity: 0.7 }}>
            Bitte einen neuen Link generieren.
          </p>
        </div>
      </ShellHtml>
    );
  }
  if (error) {
    return (
      <ShellHtml>
        <div style={errorBoxStyle}>
          <p style={{ fontSize: 64, fontWeight: 700, margin: 0 }}>Verbindung verloren</p>
        </div>
      </ShellHtml>
    );
  }
  if (!snapshot) {
    return (
      <ShellHtml>
        <div style={errorBoxStyle}>
          <p style={{ fontSize: 56, fontWeight: 400, opacity: 0.4, margin: 0 }}>Lade …</p>
        </div>
      </ShellHtml>
    );
  }

  return (
    <ShellHtml>
      {/* TOP BAND — QR + share URL.
          QR is fetched from /api/share/[token]/qr.svg (cached 60s). */}
      <div style={topBandStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/share/${encodeURIComponent(token)}/qr.svg`}
          alt=""
          width={360}
          height={360}
          style={qrBoxStyle}
        />
        <div style={qrCaptionStyle}>
          <p style={{ fontSize: 24, opacity: 0.7, margin: 0, letterSpacing: 4 }}>
            ÜBERSETZUNG MITLESEN
          </p>
          <p style={{ fontSize: 32, fontWeight: 600, margin: '8px 0 0' }}>
            {shareUrlForDisplay}
          </p>
        </div>
      </div>

      {/* MIDDLE BAND — current translated segment. */}
      <div style={subtitleAreaStyle}>
        {latest ? (
          <p style={subtitleTextStyle}>{latest.text}</p>
        ) : (
          <p style={subtitleIdleStyle}>
            {meetingEnded ? 'Meeting beendet' : 'Warte auf Sprache …'}
          </p>
        )}
      </div>

      {/* BOTTOM BAND — language pair + connection indicator. */}
      <div style={bottomBandStyle}>
        <span style={langBadgeStyle}>{langA} ↔ {langB}</span>
        <span style={statusDotStyle(connected, meetingEnded)} aria-hidden />
      </div>
    </ShellHtml>
  );
}

OverlayPage.noLayout = true;

function ShellHtml({ children }) {
  return (
    <>
      <Head>
        <title>Live-Übersetzung Overlay</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main style={shellStyle}>{children}</main>
    </>
  );
}

const shellStyle = {
  position: 'fixed',
  inset: 0,
  background: '#000',
  color: '#FFF',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Inter, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  padding: '48px 64px',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

const topBandStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 48,
  flexShrink: 0,
};

const qrBoxStyle = {
  width: 360,
  height: 360,
  flexShrink: 0,
  background: '#000',
  padding: 8,
  display: 'block',
};

const qrCaptionStyle = {
  flex: 1,
  minWidth: 0,
};

const subtitleAreaStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 0',
  minHeight: 0,
};

const subtitleTextStyle = {
  fontSize: 96,
  fontWeight: 700,
  lineHeight: 1.15,
  textAlign: 'center',
  margin: 0,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  letterSpacing: '-0.01em',
};

const subtitleIdleStyle = {
  fontSize: 56,
  fontWeight: 400,
  opacity: 0.4,
  margin: 0,
};

const bottomBandStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
  paddingTop: 24,
};

const langBadgeStyle = {
  fontSize: 36,
  letterSpacing: 8,
  fontWeight: 600,
  background: '#FF5917',
  padding: '12px 24px',
  borderRadius: 12,
  display: 'inline-block',
};

const statusDotStyle = (connected, ended) => ({
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: ended ? '#666' : connected ? '#3FCF5F' : '#FFB840',
  boxShadow: ended ? 'none' : '0 0 16px currentColor',
  color: ended ? '#666' : connected ? '#3FCF5F' : '#FFB840',
});

const errorBoxStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  textAlign: 'center',
};
