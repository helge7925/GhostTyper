import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations } from '../lib/i18n';
import { getSystemAudioCapabilities } from '../lib/audio-utils';
import { useWakeLock } from '../lib/use-wake-lock';
import { MonitorSpeaker, Square, Volume2 } from 'lucide-react';
import { Button } from './ui/button';

export default function SystemAudioRecorder({ onRecordingComplete }) {
  const t = useTranslations('components.systemAudioRecorder');
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock();

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);
  const [audioSourceType, setAudioSourceType] = useState(null);
  const [caps, setCaps] = useState({ tabAudio: false, systemAudio: false });

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const previewAudioRef = useRef(null);
  const previewResetDoneRef = useRef(false);
  const activeAudioUrlRef = useRef(null);

  useEffect(() => {
    setCaps(getSystemAudioCapabilities());
  }, []);

  useEffect(() => {
    if (activeAudioUrlRef.current && activeAudioUrlRef.current !== audioUrl) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
    }
    activeAudioUrlRef.current = audioUrl || null;
    previewResetDoneRef.current = false;
  }, [audioUrl]);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    releaseWakeLock();
  }, [releaseWakeLock]);

  useEffect(() => {
    return () => {
      cleanup();
      if (activeAudioUrlRef.current) {
        URL.revokeObjectURL(activeAudioUrlRef.current);
      }
    };
  }, [cleanup]);

  async function startRecording() {
    setError(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setAudioSourceType(null);
    cleanup();

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(t('notSupported'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: false,
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(track => track.stop());
        setError(t('noAudioTrack'));
        return;
      }

      const label = audioTracks[0].label || '';
      const sourceType = /system|monitor|loopback|stereo mix/i.test(label) ? 'system' : 'tab';
      setAudioSourceType(sourceType);

      const audioStream = new MediaStream(audioTracks);
      // Keep the display track alive; some browsers end audio capture when it is stopped.
      streamRef.current = stream;

      stream.getTracks().forEach(track => {
        track.onended = () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            stopRecording();
          }
        };
      });

      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
      ];

      let selectedType = '';
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedType = type;
          break;
        }
      }

      const options = selectedType ? { mimeType: selectedType } : {};
      const mediaRecorder = new MediaRecorder(audioStream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const type = mediaRecorder.mimeType || selectedType || 'audio/webm';

        if (chunksRef.current.length === 0) {
          setError(t('noData'));
          cleanup();
          return;
        }

        const blob = new Blob(chunksRef.current, { type });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        cleanup();
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      requestWakeLock();

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        releaseWakeLock();
        return;
      }
      console.error('System audio recording error:', err);
      setError(t('permissionDenied', { error: err.message }));
      releaseWakeLock();
      cleanup();
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    releaseWakeLock();
  }

  const handlePreviewLoadedMetadata = () => {
    if (!previewAudioRef.current) return;
    if (previewResetDoneRef.current) return;

    try {
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current.pause();
      previewResetDoneRef.current = true;
    } catch {}
  };

  const handleUseRecording = useCallback(() => {
    if (audioBlob) {
      onRecordingComplete(audioBlob);
    }
  }, [audioBlob, onRecordingComplete]);

  function handleDiscard() {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setDuration(0);
    setAudioSourceType(null);
  }

  function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  if (audioBlob) {
    return (
      <div className="space-y-4">
        <div className="bg-surface-elevated border border-subtle rounded-lg p-4">
          <p className="text-sm text-secondary mb-3">
            {t('recording')} ({formatDuration(duration)}){audioSourceType ? ` — ${audioSourceType === 'system' ? t('sourceSystem') : t('sourceTab')}` : ''}
          </p>
          <audio
            key={audioUrl || 'audio-preview'}
            ref={previewAudioRef}
            src={audioUrl}
            controls
            preload="metadata"
            onLoadedMetadata={handlePreviewLoadedMetadata}
            onCanPlay={handlePreviewLoadedMetadata}
            className="w-full"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={handleDiscard}
            variant="outline"
            className="flex-1"
          >
            {t('discard')}
          </Button>
          <Button
            type="button"
            onClick={handleUseRecording}
            variant="primary"
            className="flex-1"
          >
            {t('useRecording')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="border border-danger/30 text-danger px-4 py-3 rounded-lg text-sm text-center">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center justify-center py-8">
        {isRecording ? (
          <div className="w-full flex flex-col items-center">
            <div className="w-full max-w-[300px] bg-hover-subtle border border-subtle rounded-xl p-4 mb-4 text-center">
              <p className="text-sm text-secondary">
                {audioSourceType === 'system' ? t('recordingSystem') : t('recordingTab')}
              </p>
            </div>
            <div className="w-14 h-14 rounded-xl mb-4 flex items-center justify-center bg-accent/10 text-accent-ink">
              <Volume2 className="w-7 h-7" aria-hidden="true" />
            </div>
          </div>
        ) : (
          <div className="w-full max-w-sm text-center">
            <div className="w-14 h-14 rounded-xl bg-accent/10 text-accent-ink mb-4 flex items-center justify-center mx-auto">
              <MonitorSpeaker className="w-7 h-7" aria-hidden="true" />
            </div>
            <p className="text-sm text-secondary mb-3">
              {t('description')}
            </p>
            <div className="bg-hover-subtle border border-subtle rounded-lg p-3 mb-4 text-left">
              <p className="text-xs text-secondary mb-1.5 font-medium">{t('supportedLabel')}</p>
              <ul className="text-xs text-secondary/80 space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-accent-ink mt-0.5">●</span>
                  {t('tabAudioInfo')}
                </li>
                {caps.systemAudio && (
                  <li className="flex items-start gap-1.5">
                    <span className="text-accent-ink mt-0.5">●</span>
                    {t('systemAudioInfo')}
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        <p className="text-2xl font-mono text-primary mb-6">
          {formatDuration(duration)}
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          {!isRecording ? (
            <Button
              type="button"
              onClick={startRecording}
              variant="primary"
            >
              {t('start')}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={stopRecording}
              variant="destructive-solid"
            >
              <Square className="w-4 h-4" aria-hidden="true" />
              {t('stop')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
