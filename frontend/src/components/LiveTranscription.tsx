/**
 * Live Transcription Component using Gemini Live API
 * Focused on transcription (not conversation)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Session } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';
import './LiveTranscription.css';

interface TranscriptionSegment {
  text: string;
  timestamp: number;
  isFinal: boolean;
}

const LiveTranscription: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Click to start transcription');
  const [error, setError] = useState('');
  const [transcriptions, setTranscriptions] = useState<TranscriptionSegment[]>([]);
  const [currentPartial, setCurrentPartial] = useState('');
  
  // Audio context refs
  const inputAudioContextRef = useRef<AudioContext>();
  const sessionRef = useRef<Session>();
  const mediaStreamRef = useRef<MediaStream>();
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode>();
  const scriptProcessorRef = useRef<ScriptProcessorNode>();
  const clientRef = useRef<GoogleGenAI>();
  const isRecordingRef = useRef(false); // Add ref for recording state to use in callbacks
  
  // Initialize Gemini client
  useEffect(() => {
    const initClient = async () => {
      try {
        // Get API key from environment or prompt user
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY || 
                      localStorage.getItem('gemini_api_key') ||
                      prompt('Enter your Gemini API Key:');
        
        if (!apiKey) {
          setError('API key is required');
          return;
        }
        
        // Save for future use
        localStorage.setItem('gemini_api_key', apiKey);
        
        clientRef.current = new GoogleGenAI({
          apiKey: apiKey,
        });
        
        // Initialize audio context
        inputAudioContextRef.current = new (window.AudioContext || 
          (window as any).webkitAudioContext)({ sampleRate: 16000 });
        
        await initSession();
        
      } catch (err) {
        console.error('Failed to initialize client:', err);
        setError(`Failed to initialize: ${err.message}`);
      }
    };
    
    initClient();
    
    return () => {
      // Cleanup on unmount
      stopRecording();
      sessionRef.current?.close();
    };
  }, []);
  
  const initSession = async () => {
    if (!clientRef.current) {
      console.log('❌ No Gemini client initialized');
      return;
    }
    
    try {
      console.log('🔄 Initializing Gemini session...');
      setStatus('Connecting to Gemini...');
      
      // Use the transcription-optimized model
      const model = 'gemini-2.0-flash-exp'; // or 'gemini-2.5-flash-preview-native-audio-dialog'
      console.log(`📡 Connecting to model: ${model}`);
      
      sessionRef.current = await clientRef.current.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            console.log('✅ Gemini WebSocket opened successfully');
            setStatus('Connected - Ready to transcribe');
            setError('');
          },
          onmessage: async (message: LiveServerMessage) => {
            console.log('📨 Received message from Gemini:', message);
            // Handle transcription responses
            const textPart = message.serverContent?.modelTurn?.parts?.[0];
            
            if (textPart?.text) {
              // This is a text transcription
              const text = textPart.text;
              console.log(`📝 Transcription received: "${text.substring(0, 50)}..." (complete: ${!!message.serverContent?.turnComplete})`);
              
              // Check if this is a final or partial transcription
              const turnComplete = message.serverContent?.turnComplete;
              
              if (turnComplete) {
                // Final transcription - add to list
                setTranscriptions(prev => [...prev, {
                  text: text,
                  timestamp: Date.now(),
                  isFinal: true
                }]);
                setCurrentPartial(''); // Clear partial
              } else {
                // Partial transcription - update current
                setCurrentPartial(text);
              }
            }
            
            // Handle interruptions
            if (message.serverContent?.interrupted) {
              console.log('Transcription interrupted');
              setCurrentPartial('');
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('❌ Gemini session error:', e);
            setError(`Error: ${e.message}`);
          },
          onclose: (e: CloseEvent) => {
            console.log('🔌 Gemini WebSocket closed:', e.code, e.reason);
            setStatus(`Disconnected: ${e.reason || 'Connection closed'}`);
          },
        },
        config: {
          responseModalities: [Modality.TEXT], // We only want text transcription
          // Optional: Configure speech settings if needed
          // speechConfig: {
          //   languageCode: 'en-US'
          // },
        },
      });
      
      console.log('✅ Gemini session created successfully');
      
    } catch (err) {
      console.error('❌ Failed to create Gemini session:', err);
      setError(`Session error: ${err.message}`);
    }
  };
  
  const startRecording = async () => {
    if (isRecording || !sessionRef.current) {
      console.log(`⚠️ Cannot start recording: isRecording=${isRecording}, hasSession=${!!sessionRef.current}`);
      return;
    }
    
    try {
      console.log('🎤 Starting recording...');
      setStatus('Requesting microphone access...');
      
      // Get microphone access
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      
      console.log('✅ Microphone access granted');
      setStatus('Recording - Speak to transcribe...');
      
      // Create audio processing pipeline
      if (inputAudioContextRef.current) {
        console.log(`🔊 Audio context state: ${inputAudioContextRef.current.state}, sample rate: ${inputAudioContextRef.current.sampleRate}`);
        await inputAudioContextRef.current.resume();
        
        sourceNodeRef.current = inputAudioContextRef.current.createMediaStreamSource(
          mediaStreamRef.current
        );
        
        const bufferSize = 4096; // Larger buffer for better quality
        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(
          bufferSize,
          1, // Input channels
          1  // Output channels
        );
        
        // Process audio chunks and send to Gemini
        let chunkCount = 0;
        console.log('🎙️ Setting up audio processor callback...');
        
        scriptProcessorRef.current.onaudioprocess = (event) => {
          // Debug log for first few chunks
          if (chunkCount < 5) {
            console.log(`🔍 Audio callback fired: chunk #${chunkCount + 1}, isRecordingRef=${isRecordingRef.current}, session exists=${!!sessionRef.current}`);
          }
          
          // Use ref value to avoid closure issues
          if (!isRecordingRef.current) {
            if (chunkCount < 5) {
              console.log('⚠️ Not recording (ref check), skipping chunk processing');
            }
            return;
          }
          
          const inputBuffer = event.inputBuffer;
          const pcmData = inputBuffer.getChannelData(0);
          
          // Check if we're getting actual audio data
          const hasAudio = pcmData.some(sample => sample !== 0);
          
          // Log every 10th chunk to avoid spam
          chunkCount++;
          if (chunkCount <= 3 || chunkCount % 10 === 0) {
            console.log(`🎵 Audio chunk #${chunkCount}: buffer size=${pcmData.length}, sample rate=${inputBuffer.sampleRate}, has audio=${hasAudio}`);
            
            // Check first few samples
            const samplePreview = Array.from(pcmData.slice(0, 5)).map(s => s.toFixed(4)).join(', ');
            console.log(`   Sample preview: [${samplePreview}...]`);
          }
          
          // Send audio chunk to Gemini
          const audioBlob = createBlob(pcmData);
          if (chunkCount <= 3 || chunkCount % 10 === 0) {
            console.log(`📤 Sending to Gemini: blob.data length=${audioBlob.data.length}, mime=${audioBlob.mime_type}`);
          }
          
          if (!sessionRef.current) {
            console.error('❌ No session available to send audio!');
            return;
          }
          
          try {
            sessionRef.current.sendRealtimeInput({
              media: audioBlob
            });
            if (chunkCount <= 3) {
              console.log('✅ Audio sent successfully');
            }
          } catch (error) {
            console.error('❌ Error sending audio:', error);
          }
        };
        
        console.log('✅ Audio processor callback setup complete');
        
        // Connect audio pipeline
        sourceNodeRef.current.connect(scriptProcessorRef.current);
        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
        
        console.log('🔗 Audio pipeline connected:');
        console.log(`   Source node: ${sourceNodeRef.current ? 'connected' : 'missing'}`);
        console.log(`   Script processor: ${scriptProcessorRef.current ? 'connected' : 'missing'}`);
        console.log(`   Destination: ${inputAudioContextRef.current?.destination ? 'available' : 'missing'}`);
        
        setIsRecording(true);
        isRecordingRef.current = true; // Update ref too
        console.log('✅ Recording started successfully, isRecordingRef set to true');
        
        // Send a test message to verify the connection works
        console.log('🧪 Sending test audio chunk to verify connection...');
        try {
          const testData = new Float32Array(1024).fill(0);
          const testBlob = createBlob(testData);
          sessionRef.current?.sendRealtimeInput({
            media: testBlob
          });
          console.log('✅ Test audio chunk sent successfully');
        } catch (err) {
          console.error('❌ Failed to send test audio chunk:', err);
        }
      }
      
    } catch (err) {
      console.error('❌ Error starting recording:', err);
      setError(`Recording error: ${err.message}`);
      stopRecording();
    }
  };
  
  const stopRecording = useCallback(() => {
    if (!isRecording && !mediaStreamRef.current) {
      console.log('⚠️ Already stopped or no media stream');
      return;
    }
    
    console.log('⏹️ Stopping recording...');
    setStatus('Stopping recording...');
    setIsRecording(false);
    isRecordingRef.current = false; // Update ref too
    
    // Disconnect audio nodes
    if (scriptProcessorRef.current && sourceNodeRef.current) {
      scriptProcessorRef.current.disconnect();
      sourceNodeRef.current.disconnect();
      scriptProcessorRef.current = undefined;
      sourceNodeRef.current = undefined;
    }
    
    // Stop media tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = undefined;
    }
    
    // Send end of turn to finalize any pending transcription
    if (sessionRef.current) {
      console.log('📤 Sending end-of-turn signal to Gemini');
      sessionRef.current.sendRealtimeInput({ 
        media: { data: '', mime_type: 'audio/pcm' }
      });
    }
    
    console.log('✅ Recording stopped successfully');
    setStatus('Recording stopped - Click to start again');
  }, [isRecording]);
  
  const resetSession = async () => {
    stopRecording();
    sessionRef.current?.close();
    setTranscriptions([]);
    setCurrentPartial('');
    await initSession();
    setStatus('Session reset - Ready to transcribe');
  };
  
  const clearTranscriptions = () => {
    setTranscriptions([]);
    setCurrentPartial('');
  };
  
  const exportTranscriptions = () => {
    const text = transcriptions.map(t => t.text).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcription_${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  return (
    <div className="live-transcription">
      <div className="header">
        <h1>🎙️ Gemini Live Transcription</h1>
        <div className="status">
          {error ? (
            <span className="error">{error}</span>
          ) : (
            <span className="info">{status}</span>
          )}
        </div>
      </div>
      
      <div className="controls">
        <button 
          onClick={resetSession}
          disabled={isRecording}
          className="btn-secondary"
          title="Reset session"
        >
          🔄 Reset
        </button>
        
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`btn-primary ${isRecording ? 'recording' : ''}`}
        >
          {isRecording ? (
            <>⏹ Stop</>
          ) : (
            <>🔴 Start</>
          )}
        </button>
        
        <button
          onClick={clearTranscriptions}
          disabled={transcriptions.length === 0}
          className="btn-secondary"
          title="Clear transcriptions"
        >
          🗑️ Clear
        </button>
        
        <button
          onClick={exportTranscriptions}
          disabled={transcriptions.length === 0}
          className="btn-secondary"
          title="Export transcriptions"
        >
          💾 Export
        </button>
      </div>
      
      <div className="transcription-container">
        <div className="transcription-header">
          <h2>Transcription</h2>
          <span className="count">{transcriptions.length} segments</span>
        </div>
        
        <div className="transcription-content">
          {transcriptions.map((segment, index) => (
            <div key={index} className="transcription-segment">
              <span className="timestamp">
                {new Date(segment.timestamp).toLocaleTimeString()}
              </span>
              <span className="text">{segment.text}</span>
            </div>
          ))}
          
          {currentPartial && (
            <div className="transcription-segment partial">
              <span className="timestamp">...</span>
              <span className="text">{currentPartial}</span>
            </div>
          )}
          
          {transcriptions.length === 0 && !currentPartial && (
            <div className="empty-state">
              Start recording to see transcriptions appear here
            </div>
          )}
        </div>
      </div>
      
      {isRecording && (
        <div className="recording-indicator">
          <div className="pulse"></div>
          <span>Recording...</span>
        </div>
      )}
    </div>
  );
};

export default LiveTranscription;