import { useState, useRef, useEffect, useCallback } from 'react';

export default function AudioRecorder({ onRecordingComplete }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [hasSignal, setHasSignal] = useState(false);
  const [visualizerUnavailable, setVisualizerUnavailable] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibratedThreshold, setCalibratedThreshold] = useState(null);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const previewAudioRef = useRef(null);
  const lastLevelUpdateRef = useRef(0);
  const smoothedLevelRef = useRef(0);
  const signalHoldRef = useRef(0);
  const calibrationTimerRef = useRef(null);
  const signalThresholdRef = useRef(1.2);
  const latestRawLevelRef = useRef(0);
  const latestPeakRef = useRef(0);
  const hasVisualizerStartedRef = useRef(false);
  const previewResetDoneRef = useRef(false);

  useEffect(() => {
    return () => {
      cleanup();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    previewResetDoneRef.current = false;
  }, [audioUrl]);

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (calibrationTimerRef.current) {
      clearInterval(calibrationTimerRef.current);
      calibrationTimerRef.current = null;
    }
    setIsCalibrating(false);
    setInputLevel(0);
    setHasSignal(false);
    latestRawLevelRef.current = 0;
    latestPeakRef.current = 0;
    hasVisualizerStartedRef.current = false;
  };

  const startVisualizer = useCallback(async (stream) => {
    try {
      if (!canvasRef.current) return false;
      setVisualizerUnavailable(false);

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      const bufferLength = analyser.fftSize;
      const dataArray = new Uint8Array(bufferLength);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const draw = () => {
        if (!canvasRef.current || !analyserRef.current) return;
        
        animationFrameRef.current = requestAnimationFrame(draw);
        analyserRef.current.getByteTimeDomainData(dataArray);
        analyserRef.current.getByteFrequencyData(freqData);

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const displayWidth = canvas.clientWidth || 300;
        const displayHeight = canvas.clientHeight || 80;
        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
          canvas.width = displayWidth;
          canvas.height = displayHeight;
        }

        const width = displayWidth;
        const height = displayHeight;

        // Background
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.fillRect(0, 0, width, height);

        // Midline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Waveform
        ctx.strokeStyle = '#ff5917';
        ctx.lineWidth = 2;
        ctx.beginPath();

        let rmsSum = 0;
        let peak = 0;
        const step = width / (bufferLength - 1);

        for (let i = 0; i < bufferLength; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          const abs = Math.abs(normalized);
          rmsSum += normalized * normalized;
          if (abs > peak) peak = abs;
        }

        // Auto-zoom for low-level microphone input so the waveform stays visible.
        const gain = Math.min(14, Math.max(2.0, 0.18 / Math.max(peak, 0.006)));

        for (let i = 0; i < bufferLength; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          const amplified = Math.max(-1, Math.min(1, normalized * gain));

          const x = i * step;
          const y = height / 2 + amplified * (height * 0.35);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        const rms = Math.sqrt(rmsSum / bufferLength);
        const db = 20 * Math.log10(rms + 1e-8);
        const dbNorm = Math.max(0, Math.min(1, (db + 60) / 60));
        const freqAvg = freqData.reduce((sum, v) => sum + v, 0) / (freqData.length || 1);
        const freqNorm = Math.max(0, Math.min(1, freqAvg / 255));
        const peakNorm = Math.max(0, Math.min(1, peak * 12));
        const rawLevel = Math.max(dbNorm * 100, freqNorm * 100, peakNorm * 100);
        latestRawLevelRef.current = rawLevel;
        latestPeakRef.current = peak;
        const smoothed = smoothedLevelRef.current * 0.72 + rawLevel * 0.28;
        smoothedLevelRef.current = smoothed;
        const level = Math.min(100, Math.round(smoothed));

        if (level > signalThresholdRef.current || peak > 0.003) {
          signalHoldRef.current = 8;
        } else {
          signalHoldRef.current = Math.max(0, signalHoldRef.current - 1);
        }
        const signalDetected = signalHoldRef.current > 0;

        const now = performance.now();
        if (now - lastLevelUpdateRef.current > 100) {
          setInputLevel(level);
          setHasSignal(signalDetected);
          lastLevelUpdateRef.current = now;
        }
      };

      draw();
      return true;
    } catch (err) {
      console.error('Visualizer error:', err);
      setVisualizerUnavailable(true);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isRecording || !streamRef.current || hasVisualizerStartedRef.current || visualizerUnavailable) {
      return undefined;
    }

    let cancelled = false;
    const stream = streamRef.current;

    const bootstrapVisualizer = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (cancelled) return;
      const started = await startVisualizer(stream);
      if (started) {
        hasVisualizerStartedRef.current = true;
      }
    };

    bootstrapVisualizer();

    return () => {
      cancelled = true;
    };
  }, [isRecording, visualizerUnavailable, startVisualizer]);

  async function startRecording() {
    setError(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    cleanup();
    setVisualizerUnavailable(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Ihr Browser unterstützt keine Audio-Aufnahme.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      smoothedLevelRef.current = 0;
      signalHoldRef.current = 0;
      signalThresholdRef.current = 1.2;
      hasVisualizerStartedRef.current = false;
      setCalibratedThreshold(null);

      const mimeTypes = [
        'audio/mp4',
        'audio/aac',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];
      
      let selectedType = '';
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedType = type;
          break;
        }
      }

      const options = selectedType ? { mimeType: selectedType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
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
          setError('Aufnahme fehlgeschlagen: Keine Daten empfangen.');
          return;
        }

        const blob = new Blob(chunksRef.current, { type });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        
        stream.getTracks().forEach(track => track.stop());
        cleanup();
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setIsPaused(false);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Start recording error:', err);
      setError('Fehler beim Zugriff auf das Mikrofon: ' + err.message);
      cleanup();
    }
  }

  function calibrateInputLevel() {
    if (!isRecording || isCalibrating || !analyserRef.current) return;

    if (calibrationTimerRef.current) {
      clearInterval(calibrationTimerRef.current);
      calibrationTimerRef.current = null;
    }

    setIsCalibrating(true);
    const samples = [];
    const startedAt = performance.now();

    calibrationTimerRef.current = setInterval(() => {
      samples.push(latestRawLevelRef.current);
      if (performance.now() - startedAt < 1200) return;

      clearInterval(calibrationTimerRef.current);
      calibrationTimerRef.current = null;

      if (samples.length > 0) {
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] || 0;
        const threshold = Math.min(18, Math.max(1, Number((median + 1.5).toFixed(1))));
        signalThresholdRef.current = threshold;
        setCalibratedThreshold(threshold);
      }
      setIsCalibrating(false);
    }, 60);
  }

  const handlePreviewLoadedMetadata = () => {
    if (!previewAudioRef.current) return;
    if (previewResetDoneRef.current) return;

    try {
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current.pause();
      previewResetDoneRef.current = true;
    } catch {
      // ignore preview reset errors
    }
  };

  function pauseRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (audioContextRef.current) audioContextRef.current.suspend();
      clearInterval(timerRef.current);
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      if (audioContextRef.current) audioContextRef.current.resume();
      timerRef.current = setInterval(() => setDuration(prev => prev + 1), 1000);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
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

  if (audioBlob) {
    return (
      <div className="space-y-4">
        <div className="bg-dark-input border border-white/[0.1] rounded-lg p-4">
          <p className="text-sm text-text-secondary mb-3">
            Aufnahme ({formatDuration(duration)})
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

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/20 text-accent-red px-4 py-3 rounded-lg text-sm text-center">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center justify-center py-8">
        {isRecording ? (
          <div className="w-full flex flex-col items-center">
            <canvas 
              ref={canvasRef} 
              width={300} 
              height={80} 
              className="mb-6 w-full max-w-[300px] h-[80px] bg-white/[0.02] border border-white/[0.05] rounded-xl"
            />
            <div className="w-full max-w-[300px] mb-4">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-text-secondary mb-1">
                <span>Mikrofonpegel</span>
                <span>{inputLevel}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${
                    hasSignal ? 'bg-accent-green' : 'bg-accent-yellow'
                  }`}
                  style={{ width: `${Math.max(inputLevel, 2)}%` }}
                />
              </div>
              <p className="text-[10px] mt-1 text-text-secondary">
                {visualizerUnavailable
                  ? 'Pegelanzeige aktuell nicht verfügbar. Aufnahme läuft trotzdem.'
                  : hasSignal
                    ? 'Signal erkannt'
                    : 'Lauscht... sprechen Sie einfach normal.'}
              </p>
              {calibratedThreshold !== null && (
                <p className="text-[10px] text-text-secondary/80 mt-0.5">
                  Mikro-Check aktiv. Sprache wird jetzt sensibler erkannt.
                </p>
              )}
            </div>
            <div className={`w-16 h-16 rounded-full mb-4 flex items-center justify-center ${isPaused ? 'bg-yellow-500/20' : 'bg-accent-red/20 animate-pulse'}`}>
              <div className={`w-6 h-6 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-accent-red'}`} />
            </div>
          </div>
        ) : (
          <div className="w-20 h-20 rounded-full bg-accent-orange/20 mb-4 flex items-center justify-center">
            <svg className="w-10 h-10 text-accent-orange" fill="currentColor" viewBox="0 0 20 20">
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
              className="gradient-accent text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors shadow-lg shadow-accent-orange/20 hover:scale-105 transform active:scale-95"
            >
              Aufnahme starten
            </button>
          ) : (
            <>
              {isPaused ? (
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="border border-white/[0.12] text-text-secondary px-6 py-2.5 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors"
                >
                  Fortsetzen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="border border-white/[0.12] text-text-secondary px-6 py-2.5 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors"
                >
                  Pause
                </button>
              )}
              <button
                type="button"
                onClick={calibrateInputLevel}
                disabled={isPaused || isCalibrating || visualizerUnavailable}
                className="border border-white/[0.12] text-text-secondary px-4 py-2.5 rounded-full text-sm font-medium hover:bg-white/[0.06] transition-colors disabled:opacity-40"
                title="Mikrofon kurz prüfen und auf die Umgebung einstellen"
              >
                {isCalibrating ? 'Lausche kurz...' : 'Mikro-Check'}
              </button>
              <button
                type="button"
                onClick={stopRecording}
                className="gradient-accent text-white px-6 py-2.5 rounded-full text-sm font-medium transition-colors shadow-lg hover:shadow-accent-orange/20 hover:scale-105 transform active:scale-95"
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
