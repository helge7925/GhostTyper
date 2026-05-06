import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

/**
 * Companion-tab UI for live-translation meetings. Renders the original
 * Voxtral segments next to the translated segments and exposes an
 * <audio> element that streams TTS via /api/transcriptions/[id]/audio.
 *
 * The two language buckets come from `translation_config`. The user
 * picks which side they want to *hear*; the visual transcript shows
 * both sides regardless. This way a DE-speaker keeps the Original-DE
 * column as a sanity-check while listening to the EN translation.
 *
 * The <audio> element is intentionally NOT autoplay — most browsers
 * block autoplay without a user gesture. We render a "Audio aktivieren"
 * toggle that the user clicks once; from then on the stream plays
 * continuously as PCM bytes arrive on the chunked HTTP body.
 */
export default function TranslationCompanionPanel({ transcription }) {
  const t = useTranslations('meeting.detail.translation');
  const config = transcription?.translation_config || null;
  const langA = config?.fromLang || 'de';
  const langB = config?.toLang || 'en';

  const [listenLang, setListenLang] = useState(langB);
  const [audioActive, setAudioActive] = useState(false);
  const audioRef = useRef(null);

  // Reset listen language if the configured pair changes mid-meeting.
  useEffect(() => {
    setListenLang((current) => {
      if (current === langA || current === langB) return current;
      return langB;
    });
  }, [langA, langB]);

  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  const translated = Array.isArray(transcription?.translated_segments) ? transcription.translated_segments : [];

  const audioSrc = useMemo(() => {
    if (!audioActive || !transcription?.id) return '';
    return `/api/transcriptions/${transcription.id}/audio?lang=${encodeURIComponent(listenLang)}`;
  }, [audioActive, transcription?.id, listenLang]);

  return (
    <div className="bg-surface border border-accent/20 rounded-2xl p-4 shadow-lg space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-subtle pb-3">
        <div className="text-xs text-secondary uppercase tracking-widest font-bold">
          {langA} ↔ {langB}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-secondary">{t('listenInLabel')}</span>
          <select
            value={listenLang}
            onChange={(e) => {
              setListenLang(e.target.value);
              // Force the <audio> element to reload with the new src.
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
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-subtle text-primary hover:bg-hover-subtle"
            >
              <VolumeX className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAudioActive(true);
                // Tiny delay so the <audio src> binds before play()
                setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-accent/40 text-accent hover:bg-accent/10"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>{t('audioStartHint').split('—')[0].trim()}</span>
            </button>
          )}
        </div>
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={audioSrc}
        controls={audioActive}
        autoPlay={audioActive}
        className={audioActive ? 'w-full' : 'hidden'}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-secondary uppercase tracking-widest mb-2">
            {t('originalColumn')}
          </p>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
            {segments.length === 0 ? (
              <p className="text-xs text-secondary italic">{t('noSegmentsYet')}</p>
            ) : (
              segments.map((seg, idx) => (
                <p
                  key={`o-${idx}-${seg.start}`}
                  className="text-sm text-primary leading-relaxed"
                >
                  <span className="text-[10px] uppercase text-secondary mr-2">{seg.language || langA}</span>
                  {seg.text}
                </p>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-secondary uppercase tracking-widest mb-2">
            {t('translatedColumn')}
          </p>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
            {translated.length === 0 ? (
              <p className="text-xs text-secondary italic">{t('noSegmentsYet')}</p>
            ) : (
              translated.map((seg, idx) => (
                <p
                  key={`t-${idx}-${seg.start}`}
                  className="text-sm text-primary leading-relaxed"
                >
                  <span className="text-[10px] uppercase text-accent mr-2">{seg.language || langB}</span>
                  {seg.text}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
