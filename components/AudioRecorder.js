import { useState, useRef, useEffect, useCallback } from 'react';

export default function AudioRecorder({ onRecordingComplete }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Ihr Browser unterstützt keine Audio-Aufnahme.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(track => track.stop());
        clearInterval(timerRef.current);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
      setError(null);
      setAudioBlob(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Mikrofon-Berechtigung wurde verweigert. Bitte erlauben Sie den Zugriff in Ihren Browser-Einstellungen.');
      } else {
        setError('Fehler beim Starten der Aufnahme. Bitte prüfen Sie Ihr Mikrofon.');
      }
    }
  }

  function pauseRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      clearInterval(timerRef.current);
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
    }
  }

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
  }

  function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  // Preview after recording
  if (audioBlob) {
    return (
      <div className="space-y-4">
        <div className="bg-dark-input border border-white/[0.1] rounded-lg p-4">
          <p className="text-sm text-text-secondary mb-3">
            Aufnahme ({formatDuration(duration)})
          </p>
          <audio src={audioUrl} controls className="w-full" />
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleDiscard}
            className="flex-1 border border-white/[0.12] text-text-secondary py-2 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors"
          >
            Verwerfen
          </button>
          <button
            type="button"
            onClick={handleUseRecording}
            className="flex-1 gradient-accent text-white py-2 rounded-full text-sm font-medium transition-colors"
          >
            Verwenden
          </button>
        </div>
      </div>
    );
  }

  // Recording UI
  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/20 text-accent-red px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center justify-center py-8">
        {isRecording ? (
          <div className={`w-20 h-20 rounded-full mb-4 flex items-center justify-center ${isPaused ? 'bg-yellow-500/20' : 'bg-accent-red/20 animate-pulse'}`}>
            <div className={`w-8 h-8 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-accent-red'}`} />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-full bg-accent-purple/20 mb-4 flex items-center justify-center">
            <svg className="w-10 h-10 text-accent-purple" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
          </div>
        )}

        <p className="text-2xl font-mono text-text-primary mb-6">
          {formatDuration(duration)}
        </p>

        <div className="flex gap-3">
          {!isRecording ? (
            <button
              type="button"
              onClick={startRecording}
              className="gradient-accent text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors"
            >
              Aufnahme starten
            </button>
          ) : (
            <>
              {isPaused ? (
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="border border-white/[0.12] text-text-secondary px-5 py-2 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors"
                >
                  Fortsetzen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="border border-white/[0.12] text-text-secondary px-5 py-2 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors"
                >
                  Pause
                </button>
              )}
              <button
                type="button"
                onClick={stopRecording}
                className="gradient-accent text-white px-5 py-2 rounded-full text-sm font-medium transition-colors"
              >
                Stopp
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
