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
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);

  useEffect(() => {
    return () => {
      cleanup();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
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
  };

  const startVisualizer = async (stream) => {
    try {
      if (!canvasRef.current) return;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContext();
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      
      analyser.fftSize = 256;
      source.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        if (!canvasRef.current || !analyserRef.current) return;
        
        animationFrameRef.current = requestAnimationFrame(draw);
        analyserRef.current.getByteFrequencyData(dataArray);

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 255.0;
          const barHeight = v * height * 1.2;

          // Mistral Orange: #ff5917
          ctx.fillStyle = `rgba(255, 89, 23, ${Math.max(0.3, v + 0.2)})`;
          
          const h = Math.max(barHeight, 3); 
          ctx.fillRect(x, height - h, barWidth - 1, h);

          x += barWidth;
        }
      };

      draw();
    } catch (err) {
      console.error('Visualizer error:', err);
    }
  };

  async function startRecording() {
    setError(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    cleanup();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Ihr Browser unterstützt keine Audio-Aufnahme.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Start visualizer
      await startVisualizer(stream);

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
