import React, { useState, useEffect, useRef } from 'react';

const GdmLiveAudioSecure: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const [realtimeTranscription, setRealtimeTranscription] = useState('');
  const [correctedTranscription, setCorrectedTranscription] = useState('');
  const [showRealtime, setShowRealtime] = useState(true);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioContextRef = useRef(new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000}));
  const mediaStreamRef = useRef<MediaStream | undefined>();
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptionChunks = useRef<Map<number, string>>(new Map());
  const recordingStartTimeRef = useRef<number>(0);
  const recordingIntervalRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);

  // Styles - Simple greyscale
  const containerStyle: React.CSSProperties = {
    background: '#f5f5f5',
    color: '#333',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '32px',
    fontWeight: '300',
    marginBottom: '30px',
    color: '#222',
  };

  const statusStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
  };

  const buttonRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '20px',
    marginBottom: '40px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '12px 24px',
    background: '#fff',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  };

  const recordButtonStyle: React.CSSProperties = {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: isRecording ? '#666' : '#fff',
    color: isRecording ? '#fff' : '#333',
    border: '2px solid #333',
    cursor: isConnected ? 'pointer' : 'not-allowed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '20px',
    opacity: isConnected ? 1 : 0.4,
  };

  const transcriptionContainerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '800px',
  };

  const tabStyle: React.CSSProperties = {
    display: 'flex',
    gap: '10px',
    marginBottom: '10px',
  };

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    background: active ? '#333' : '#fff',
    color: active ? '#fff' : '#333',
    border: '1px solid #333',
    borderRadius: '4px 4px 0 0',
    fontSize: '14px',
    cursor: 'pointer',
  });

  const transcriptionBoxStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: '0 4px 4px 4px',
    padding: '20px',
    height: '400px',
    overflowY: 'auto',
    fontSize: '18px',
    lineHeight: '1.6',
    color: '#333',
  };

  const realtimeTextStyle: React.CSSProperties = {
    color: '#666',
    fontStyle: 'italic',
  };

  const correctedTextStyle: React.CSSProperties = {
    color: '#222',
    fontWeight: '400',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: '5px',
  };

  const errorStyle: React.CSSProperties = {
    background: '#f8f8f8',
    color: '#666',
    padding: '10px',
    borderRadius: '4px',
    marginBottom: '20px',
    border: '1px solid #ddd',
  };

  // Convert Float32Array to base64-encoded PCM16
  const convertToPCM16Base64 = (float32Array: Float32Array): string => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    const uint8Array = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  };

  const connectToServer = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      setIsConnected(false);
      setStatus('Disconnected');
      return;
    }

    // Multiple fallback strategies for WebSocket URL
    // Priority: 1) VITE_WS_URL env var, 2) Build-time __WS_URL__, 3) Default to 8888 (server port)
    // IMPORTANT: Ensure Railway URL takes precedence and no fallback to localhost
    const envWsUrl = import.meta.env.VITE_WS_URL;
    const buildTimeUrl = typeof __WS_URL__ !== 'undefined' ? __WS_URL__ : '';
    
    let socketUrl;
    if (envWsUrl) {
      socketUrl = envWsUrl;
      console.log('Using environment variable VITE_WS_URL:', envWsUrl);
    } else if (buildTimeUrl) {
      socketUrl = buildTimeUrl;
      console.log('Using build-time __WS_URL__:', buildTimeUrl);
    } else {
      // Only fallback to localhost if no Railway URL is configured
      socketUrl = `ws://${window.location.hostname}:8888`;
      console.log('Falling back to localhost WebSocket');
    }
      
    console.log('=== WebSocket Connection Debug ===');
    console.log('Connecting to server:', socketUrl);
    console.log('Available environment variables:', {
      VITE_WS_URL: import.meta.env.VITE_WS_URL,
      __WS_URL__: typeof __WS_URL__ !== 'undefined' ? __WS_URL__ : 'undefined',
      hostname: window.location.hostname
    });
    console.log('Expected Railway URL: wss://crossover.proxy.rlwy.net:15510');
    console.log('URL matches Railway?', socketUrl === 'wss://crossover.proxy.rlwy.net:15510');
    console.log('=== End Debug ===');
    
    const ws = new WebSocket(socketUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('WebSocket connected to backend');
      setStatus('Connected');
      setIsConnected(true);
      setError('');
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Message received from backend:', message);
        
        switch (message.type) {
          case 'status':
            console.log('Status message:', message.message);
            break;
            
          case 'realtime_transcription':
            // Handle real-time transcription
            console.log('====== REALTIME TRANSCRIPTION RECEIVED ======');
            console.log('Text:', message.text);
            console.log('Full message:', message);
            if (message.text) {
              setRealtimeTranscription(prev => prev ? prev + ' ' + message.text : message.text);
            }
            break;
            
          case 'corrected_transcription':
            // Handle corrected/batch transcription
            console.log('====== CORRECTED TRANSCRIPTION RECEIVED ======');
            console.log('Text:', message.text);
            console.log('ChunkId:', message.chunkId);
            console.log('Timestamp:', message.timestamp);
            console.log('Full message:', message);
            if (message.text) {
              // Store chunk with its ID for proper ordering
              transcriptionChunks.current.set(message.chunkId, message.text);
              
              // Rebuild the full corrected transcription from all chunks
              const sortedChunks = Array.from(transcriptionChunks.current.entries())
                .sort((a, b) => a[0] - b[0])
                .map(entry => entry[1]);
              
              setCorrectedTranscription(sortedChunks.join(' '));
              console.log('Updated corrected transcription:', sortedChunks.join(' '));
            }
            break;
            
          // Handle legacy format for backward compatibility
          case 'transcription':
            console.log('====== LEGACY TRANSCRIPTION FORMAT RECEIVED ======');
            console.log('Full message:', message);
            if (message.data?.text) {
              console.log('Text from data.text:', message.data.text);
              setRealtimeTranscription(prev => prev ? prev + ' ' + message.data.text : message.data.text);
            } else if (message.text) {
              console.log('Text from message.text:', message.text);
              setRealtimeTranscription(prev => prev ? prev + ' ' + message.text : message.text);
            }
            break;
            
          case 'error':
            console.error('Error from backend:', message.message);
            setError(message.message);
            break;
            
          case 'closed':
            console.log('Connection closed:', message.reason);
            setStatus('Disconnected');
            setIsConnected(false);
            break;
            
          default:
            console.log('Unknown message type:', message.type, message);
        }
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    };
    
    ws.onerror = (error) => {
      setError('Connection error');
      setIsConnected(false);
    };
    
    ws.onclose = () => {
      setStatus('Disconnected');
      setIsConnected(false);
    };
  };

  const stopRecording = () => {
    if (!isRecording) return;

    setIsRecording(false);
    
    // Stop recording timer
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    // Convert recorded audio to WAV and store
    if (audioChunksRef.current.length > 0) {
      const wavBlob = convertToWAV(audioChunksRef.current);
      setRecordedAudioBlob(wavBlob);
      console.log(`Recording completed: ${formatDuration(recordingDuration)}`);
    }

    if (scriptProcessorNodeRef.current && sourceNodeRef.current) {
      scriptProcessorNodeRef.current.disconnect();
      sourceNodeRef.current.disconnect();
    }

    scriptProcessorNodeRef.current = null;
    sourceNodeRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = undefined;
    }
  };

  const startRecording = async () => {
    if (isRecording || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    inputAudioContextRef.current.resume();

    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        },
        video: false,
      });

      sourceNodeRef.current = inputAudioContextRef.current.createMediaStreamSource(
        mediaStreamRef.current,
      );

      const bufferSize = 4096;
      scriptProcessorNodeRef.current = inputAudioContextRef.current.createScriptProcessor(
        bufferSize,
        1,
        1,
      );
      
      setIsRecording(true);
      
      // Start recording timer
      recordingStartTimeRef.current = Date.now();
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((Date.now() - recordingStartTimeRef.current) / 1000);
      }, 100);

      scriptProcessorNodeRef.current.onaudioprocess = (audioProcessingEvent) => {
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        const base64Audio = convertToPCM16Base64(pcmData);
        
        // Store audio chunks for recording
        audioChunksRef.current.push(new Float32Array(pcmData));
        
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'audio',
            audio: base64Audio
          }));
        }
      };

      sourceNodeRef.current.connect(scriptProcessorNodeRef.current);
      scriptProcessorNodeRef.current.connect(inputAudioContextRef.current.destination);

    } catch (err: any) {
      setError(`Error: ${err.message}`);
      stopRecording();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const clearTranscription = () => {
    setRealtimeTranscription('');
    setCorrectedTranscription('');
    transcriptionChunks.current.clear();
    setRecordedAudioBlob(null);
    setRecordingDuration(0);
    audioChunksRef.current = [];
  };

  // Convert Float32Array to WAV format
  const convertToWAV = (audioChunks: Float32Array[], sampleRate: number = 16000): Blob => {
    const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioBuffer = new Float32Array(totalLength);
    
    let offset = 0;
    for (const chunk of audioChunks) {
      audioBuffer.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Convert to 16-bit PCM
    const pcm16 = new Int16Array(audioBuffer.length);
    for (let i = 0; i < audioBuffer.length; i++) {
      const s = Math.max(-1, Math.min(1, audioBuffer[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Create WAV file
    const wavBuffer = new ArrayBuffer(44 + pcm16.length * 2);
    const view = new DataView(wavBuffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcm16.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, pcm16.length * 2, true);
    
    // Audio data
    const pcm8 = new Uint8Array(pcm16.buffer);
    for (let i = 0; i < pcm8.length; i++) {
      view.setUint8(44 + i, pcm8[i]);
    }
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
  };

  const downloadAudio = () => {
    if (recordedAudioBlob) {
      const url = URL.createObjectURL(recordedAudioBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording_${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>Audio Transcription</h1>
      
      <div style={statusStyle}>Status: {status}</div>
      
      {error && <div style={errorStyle}>{error}</div>}

      <div style={buttonRowStyle}>
        <button onClick={connectToServer} style={buttonStyle}>
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
        <button onClick={clearTranscription} style={buttonStyle}>
          Clear
        </button>
        {recordedAudioBlob && (
          <button onClick={downloadAudio} style={buttonStyle}>
            Download WAV
          </button>
        )}
      </div>

      <button 
        onClick={toggleRecording} 
        disabled={!isConnected}
        style={recordButtonStyle}
      >
        {isRecording ? 'Stop' : 'Record'}
      </button>
      
      {isRecording && (
        <div style={{ marginBottom: '20px', fontSize: '16px', color: '#666' }}>
          Recording: {formatDuration(recordingDuration)}
        </div>
      )}
      
      {recordedAudioBlob && (
        <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
          Last recording: {formatDuration(recordingDuration)} - Ready for download
        </div>
      )}

      <div style={transcriptionContainerStyle}>
        <div style={tabStyle}>
          <button 
            onClick={() => setShowRealtime(true)} 
            style={tabButtonStyle(showRealtime)}
          >
            Real-time (Fast)
          </button>
          <button 
            onClick={() => setShowRealtime(false)} 
            style={tabButtonStyle(!showRealtime)}
          >
            Corrected (Accurate)
          </button>
        </div>
        
        <div style={transcriptionBoxStyle}>
          {showRealtime ? (
            <div>
              <div style={labelStyle}>Real-time Transcription</div>
              <div style={realtimeTextStyle}>
                {realtimeTranscription || 'Real-time transcription will appear here...'}
              </div>
            </div>
          ) : (
            <div>
              <div style={labelStyle}>Corrected Transcription (3-second batches)</div>
              <div style={correctedTextStyle}>
                {correctedTranscription || 'Corrected transcription will appear here after 3 seconds of audio...'}
              </div>
            </div>
          )}
        </div>
        
        {isRecording && (
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#999', textAlign: 'center' }}>
            Audio is being processed in real-time and in 3-second batches for improved accuracy
          </div>
        )}
      </div>
    </div>
  );
};

export default GdmLiveAudioSecure;