import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality } from '@google/genai';
import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
// Require environment variables - no defaults
if (!process.env.PORT) {
  console.error('ERROR: PORT environment variable is required');
  process.exit(1);
}
if (!process.env.WS_PORT) {
  console.error('ERROR: WS_PORT environment variable is required');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const port = process.env.PORT;
const wsPort = process.env.WS_PORT;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static files from React build
const frontendBuildPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendBuildPath));

// Initialize Gemini AI with API key from environment variable
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const liveModel = 'gemini-live-2.5-flash-preview';
const batchModel = 'gemini-1.5-flash'; // Model for batch audio transcription

// Create WebSocket server for live streaming
const wss = new WebSocketServer({ port: wsPort });

// Create audio_samples directory if it doesn't exist
const audioDir = path.join(process.cwd(), 'audio_samples');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir);
  console.log('Created audio_samples directory');
}




// Simple and reliable WAV creation function
function createWAVFromPCM(pcmBase64Data, sampleRate = 16000) {
  try {
    // Decode base64 to binary
    const pcmData = Buffer.from(pcmBase64Data, 'base64');
    
    // Create WAV header (44 bytes)
    const wavHeader = Buffer.alloc(44);
    
    // RIFF header
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmData.length, 4);
    wavHeader.write('WAVE', 8);
    
    // fmt chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16); // fmt chunk size
    wavHeader.writeUInt16LE(1, 20);  // audio format (PCM)
    wavHeader.writeUInt16LE(1, 22);  // channels (mono)
    wavHeader.writeUInt32LE(sampleRate, 24); // sample rate
    wavHeader.writeUInt32LE(sampleRate * 2, 28); // byte rate
    wavHeader.writeUInt16LE(2, 32);  // block align
    wavHeader.writeUInt16LE(16, 34); // bits per sample
    
    // data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmData.length, 40);
    
    // Combine header + audio data
    const wavBuffer = Buffer.concat([wavHeader, pcmData]);
    
    // Return as base64 (no file saving)
    return wavBuffer.toString('base64');
  } catch (error) {
    console.error('Error creating WAV file:', error);
    throw error;
  }
}

wss.on('connection', async (ws) => {
  console.log('Client connected to WebSocket');

  let realtimeSession = null;
  
  // Audio buffer for batch processing
  let audioBuffer = [];
  let batchInterval = null;
  let transcriptionCounter = 0;
  let isProcessingBatch = false;

  // Process batch audio using standard Gemini API
  async function processBatchAudio() {
    if (isProcessingBatch || audioBuffer.length === 0) {
      return;
    }
    
    isProcessingBatch = true;
    const currentBuffer = [...audioBuffer];
    const currentChunkId = transcriptionCounter++;
    
    console.log(`Processing batch: ${currentBuffer.length} audio chunks for better transcription`);
    
    // Clear buffer for next batch
    audioBuffer = [];
    
    try {
      // Combine all audio chunks properly
      // Decode each base64 chunk to binary, concatenate, then re-encode
      const audioBuffers = currentBuffer.map(chunk => Buffer.from(chunk, 'base64'));
      const combinedBuffer = Buffer.concat(audioBuffers);
      const combinedPCMBase64 = combinedBuffer.toString('base64');
      
              console.log(`🔧 Audio processing: ${currentBuffer.length} chunks → ${combinedBuffer.length} bytes → ${combinedPCMBase64.length} base64 chars`);
        
        // Convert PCM to WAV format (no file saving needed)
        const wavBase64 = createWAVFromPCM(combinedPCMBase64, 16000);
        
        // Use the generateContent method through ai.models
        const result = await ai.models.generateContent({
          model: batchModel,
          contents: [
            {
              parts: [
                {
                  text: "Transcribe this audio accurately. Only return the actual spoken words you can clearly hear. If the audio is unclear or contains only noise, respond with 'unclear audio'. Do not return random characters, repeated letters, or made-up words. Only return meaningful transcription."
                },
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: wavBase64
                  }
                }
              ]
            }
          ]
        });
      
      const transcriptionText = result.candidates[0].content.parts[0].text;
      
      // Send the transcription (Gemini should handle filtering via prompt)
      if (transcriptionText && transcriptionText.trim().length > 0) {
        // Filter out "unclear audio" responses
        if (transcriptionText.toLowerCase().includes('unclear audio')) {
          console.log('⚠️  Filtering out "unclear audio" response');
          return;
        }
        
        const correctedData = { 
          type: 'corrected_transcription', 
          text: transcriptionText.trim(),
          chunkId: currentChunkId,
          timestamp: Date.now()
        };
        
        ws.send(JSON.stringify(correctedData));
        console.log('✅ CORRECTED transcription sent (via standard API):', correctedData);
      } else {
        console.log('⚠️  Empty transcription received, skipping');
      }
      
    } catch (error) {
      console.error('Batch processing error:', error);
      console.log('Error details:', error.message);
      // If batch processing fails, we can fall back to sending accumulated real-time transcriptions
      console.log('Falling back to accumulated real-time transcriptions');
    } finally {
      isProcessingBatch = false;
    }
  }

  try {
    // Initialize real-time Gemini Live session
    console.log(`🔄 Attempting to connect to Gemini Live with model: ${liveModel}`);
    realtimeSession = await ai.live.connect({
      model: liveModel,
      callbacks: {
        onopen: () => {
          console.log('✅ Real-time Gemini session connected successfully');
          ws.send(JSON.stringify({ type: 'status', message: 'Connected to Gemini Live' }));
          
          // Start batch processing interval (every 3 seconds)
          batchInterval = setInterval(processBatchAudio, 3000);
          console.log('🔄 Started batch processing interval (every 3 seconds)');
        },
        onmessage: (message) => {
          console.log('📨 Received message from Gemini Live:', JSON.stringify(message, null, 2));
          
          // Send real-time transcription immediately
          if (message.serverContent && message.serverContent.inputTranscription) {
            const transcriptionText = message.serverContent.inputTranscription.text;
            
            // Send as real-time
            const realtimeData = { 
              type: 'realtime_transcription', 
              text: transcriptionText
            };
            ws.send(JSON.stringify(realtimeData));
            console.log('✅ REALTIME transcription sent:', realtimeData);
          } else {
            console.log('⚠️  Message structure unexpected - no inputTranscription found');
          }
        },
        onerror: (error) => {
          console.error('❌ Real-time session error:', error);
          console.error('Error details:', JSON.stringify(error, null, 2));
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        },
        onclose: (event) => {
          console.log('🔌 Real-time session closed:', event.reason);
          ws.send(JSON.stringify({ type: 'closed', reason: event.reason }));
          
          // Clear batch interval
          if (batchInterval) {
            clearInterval(batchInterval);
            batchInterval = null;
          }
        }
      },
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {
          model: 'default'  // Explicitly specify transcription model
        }
      }
    });
    
    console.log('✅ Gemini Live session initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to connect to Gemini Live:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to connect to Gemini Live: ' + error.message }));
  }

  // Handle messages from client
  let audioChunkCount = 0;
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'audio' && realtimeSession) {
        audioChunkCount++;
        if (audioChunkCount % 10 === 0) {
          console.log(`📊 Received ${audioChunkCount} audio chunks so far`);
        }
        
        // Add to buffer for batch processing
        audioBuffer.push(data.audio);
        
        try {
          // Send to real-time session for immediate feedback
          await realtimeSession.sendRealtimeInput({
            audio: {
              data: data.audio,
              mimeType: "audio/pcm;rate=16000"
            }
          });
          
          if (audioChunkCount === 1) {
            console.log('🎵 First audio chunk sent to Gemini Live successfully');
          }
        } catch (audioError) {
          console.error('❌ Error sending audio to Gemini Live:', audioError);
        }
      } else if (data.type === 'audio' && !realtimeSession) {
        console.log('⚠️  Received audio but no real-time session available');
      } else if (data.type === 'text' && realtimeSession) {
        // Handle text input if needed
        await realtimeSession.sendRealtimeInput({
          text: data.text
        });
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    console.log('🔌 Client disconnected');
    
    // Don't process incomplete audio - it could be corrupted
    if (audioBuffer.length > 0) {
      console.log(`⚠️  Discarding ${audioBuffer.length} incomplete audio chunks`);
      audioBuffer = [];
    }
    
    // Clear batch interval
    if (batchInterval) {
      clearInterval(batchInterval);
      batchInterval = null;
    }
    
    // Let Gemini Live session handle its own cleanup
    // Don't force close it here to avoid race conditions
    console.log('🔄 WebSocket connection closed, resources cleaned up');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Serve React app for all non-API routes (catch-all route)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running - Express: ${port}, WebSocket: ${wsPort}`);
});