/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';

const GdmLiveAudio: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [transcription, setTranscription] = useState('');

  const clientRef = useRef<GoogleGenAI>();
  const sessionRef = useRef<Session>();
  const inputAudioContextRef = useRef(new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000}));
  const mediaStreamRef = useRef<MediaStream | undefined>();
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const responseQueueRef = useRef<LiveServerMessage[]>([]);

  const statusStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '5vh',
    left: 0,
    right: 0,
    zIndex: 10,
    textAlign: 'center',
  };

  const controlsStyle: React.CSSProperties = {
    zIndex: 10,
    position: 'absolute',
    bottom: '10vh',
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '10px',
  };

  const buttonStyle: React.CSSProperties = {
    outline: 'none',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    color: 'white',
    borderRadius: '12px',
    background: 'rgba(255, 255, 255, 0.1)',
    width: '64px',
    height: '64px',
    cursor: 'pointer',
    fontSize: '24px',
    padding: 0,
    margin: 0,
  };

  const buttonHoverStyle: React.CSSProperties = {
    ...buttonStyle,
    background: 'rgba(255, 255, 255, 0.2)',
  };

  const buttonDisabledStyle: React.CSSProperties = {
    ...buttonStyle,
    display: 'none',
  };

  // Convert Float32Array to base64-encoded PCM16
  const convertToPCM16Base64 = (float32Array: Float32Array): string => {
    // Convert Float32 to Int16
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Convert to base64
    const uint8Array = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  };

  const stopRecording = () => {
    if (!isRecording && !mediaStreamRef.current && !inputAudioContextRef.current)
      return;

    setStatus('Stopping recording...');

    setIsRecording(false);

    if (scriptProcessorNodeRef.current && sourceNodeRef.current && inputAudioContextRef.current) {
      scriptProcessorNodeRef.current.disconnect();
      sourceNodeRef.current.disconnect();
    }

    scriptProcessorNodeRef.current = null;
    sourceNodeRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = undefined;
    }

    setStatus('Recording stopped. Click Start to begin again.');
  };

  const startRecording = async () => {
    console.log('Start recording clicked, isRecording:', isRecording);
    if (isRecording) {
      return;
    }

    console.log('Resuming input audio context...');
    inputAudioContextRef.current.resume();

    setStatus('Requesting microphone access...');

    try {
      console.log('Getting user media...');
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Mono
          sampleRate: 16000, // 16kHz as required
          echoCancellation: true,
          noiseSuppression: true
        },
        video: false,
      });
      console.log('Got media stream');

      setStatus('Microphone access granted. Starting capture...');

      sourceNodeRef.current = inputAudioContextRef.current.createMediaStreamSource(
        mediaStreamRef.current,
      );

      // Larger buffer size for better audio quality
      const bufferSize = 4096;
      scriptProcessorNodeRef.current = inputAudioContextRef.current.createScriptProcessor(
        bufferSize,
        1, // Input channels (mono)
        1, // Output channels (mono)
      );

      // Clear audio buffer
      audioBufferRef.current = [];
      
      // Set recording state before setting up processor
      setIsRecording(true);

      scriptProcessorNodeRef.current.onaudioprocess = (audioProcessingEvent) => {
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        
        // Store audio data
        audioBufferRef.current.push(new Float32Array(pcmData));
        
        // Send audio in the correct format (base64-encoded PCM16)
        const base64Audio = convertToPCM16Base64(pcmData);
        
        try {
          sessionRef.current?.sendRealtimeInput({
            audio: {
              data: base64Audio,
              mimeType: "audio/pcm;rate=16000"
            }
          });
          console.log('Sent audio chunk, samples:', pcmData.length);
        } catch (error) {
          console.error('Error sending audio:', error);
        }
      };

      sourceNodeRef.current.connect(scriptProcessorNodeRef.current);
      scriptProcessorNodeRef.current.connect(inputAudioContextRef.current.destination);

      setStatus('🔴 Recording... Speak now');
    } catch (err: any) {
      console.error('Error starting recording:', err);
      setStatus(`Error: ${err.message}`);
      stopRecording();
    }
  };

  const reset = () => {
    console.log('Resetting session...');
    stopRecording();
    // Session will be re-initialized in useEffect on next render
    window.location.reload();
  };

  useEffect(() => {
    console.log('Component mounted, starting initialization...');
    
    const initialize = async () => {
      try {
        const apiKey = "AIzaSyADpfeVPppUoH4sgSB2Atma_YAMPuic-ZU"
        console.log('Using API key:', apiKey ? 'Present' : 'Missing');
        
        if (!apiKey) {
          throw new Error('GEMINI_API_KEY environment variable is not set');
        }

        console.log('Creating GoogleGenAI client...');
        clientRef.current = new GoogleGenAI({
          apiKey,
        });
        console.log('GoogleGenAI client created');

        const model = 'gemini-live-2.5-flash-preview';
        console.log('Connecting to Gemini Live API with model:', model);
        
        sessionRef.current = await clientRef.current.live.connect({
          model: model,
          callbacks: {
            onopen: () => {
              console.log('Session opened successfully!');
              setStatus('Connected - Ready to record');
            },
            onmessage: (message: LiveServerMessage) => {
              console.log('Received message:', message);
              responseQueueRef.current.push(message);
              
              // Handle transcription
              if (message.serverContent?.outputTranscription) {
                console.log('Transcription:', message.serverContent.outputTranscription.text);
                setTranscription(message.serverContent.outputTranscription.text);
              }
              
              // Handle text response
              if (message.text) {
                console.log('Received text:', message.text);
                setStatus('Response: ' + message.text);
              }
              
              // Handle input transcription
              if (message.serverContent?.inputTranscription) {
                console.log('Input transcription:', message.serverContent.inputTranscription.text);
                setStatus('You said: ' + message.serverContent.inputTranscription.text);
              }
              
              // Handle turn complete
              if (message.serverContent?.turnComplete) {
                console.log('Turn complete');
              }
            },
            onerror: (e: ErrorEvent) => {
              console.error('Session error:', e);
              setError(e.message);
            },
            onclose: (e: CloseEvent) => {
              console.log('Session closed:', e);
              setStatus('Disconnected: ' + e.reason);
            },
          },
          config: {
            responseModalities: [Modality.TEXT],
            inputAudioTranscription: {}
          },
        });
        
        console.log('Session initialized successfully');
        
      } catch (error: any) {
        console.error('Error during initialization:', error);
        setError(`Initialization failed: ${error.message}`);
      }
    };

    initialize();
    
    // Cleanup function
    return () => {
      console.log('Component unmounting, closing session...');
      if (sessionRef.current) {
        sessionRef.current.close();
      }
    };
  }, []); // Empty dependency array - runs only once on mount

  return (
    <div>
      <div style={controlsStyle}>
        <button
          id="resetButton"
          onClick={reset}
          disabled={isRecording}
          style={isRecording ? buttonDisabledStyle : buttonStyle}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="40px"
            viewBox="0 -960 960 960"
            width="40px"
            fill="#ffffff">
            <path
              d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
          </svg>
        </button>
        <button
          id="startButton"
          onClick={startRecording}
          disabled={isRecording}
          style={isRecording ? buttonDisabledStyle : buttonStyle}>
          <svg
            viewBox="0 0 100 100"
            width="32px"
            height="32px"
            fill="#c80000"
            xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" />
          </svg>
        </button>
        <button
          id="stopButton"
          onClick={stopRecording}
          disabled={!isRecording}
          style={!isRecording ? buttonDisabledStyle : buttonStyle}>
          <svg
            viewBox="0 0 100 100"
            width="32px"
            height="32px"
            fill="#000000"
            xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="100" height="100" rx="15" />
          </svg>
        </button>
      </div>

      <div style={statusStyle}>
        {error && <div style={{color: '#ff6b6b'}}>{error}</div>}
        {!error && status && <div>{status}</div>}
        {transcription && <div style={{marginTop: '10px', fontSize: '18px'}}>{transcription}</div>}
      </div>
    </div>
  );
};

export default GdmLiveAudio;
