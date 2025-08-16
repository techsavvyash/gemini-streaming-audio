import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality } from '@google/genai';
import WebSocket, { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import pkg from 'wavefile';
const { WaveFile } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const wsPort = process.env.WS_PORT || 8888;

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

// Helper function to convert base64 PCM to WAV format using wavefile library
function createWAVFromPCM(pcmBase64Data, sampleRate = 16000, saveFilename = null) {
  try {
    // Decode base64 to binary
    const pcmData = Buffer.from(pcmBase64Data, 'base64');
    
    // Convert PCM buffer to Int16Array (16-bit samples)
    const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);
    
    // Create a new WaveFile instance
    const wav = new WaveFile();
    
    // Set the WAV file from the samples
    wav.fromScratch(1, sampleRate, '16', samples);
    
    // Get WAV buffer
    const wavBuffer = wav.toBuffer();
    
    // Save to file if filename provided
    if (saveFilename) {
      const filepath = path.join(audioDir, saveFilename);
      fs.writeFileSync(filepath, wavBuffer);
      console.log(`WAV file saved: ${filepath}`);
      console.log(`  - Duration: ~${samples.length / sampleRate} seconds`);
      console.log(`  - Samples: ${samples.length}`);
      console.log(`  - Size: ${wavBuffer.length} bytes`);
    }
    
    // Return as base64
    return Buffer.from(wavBuffer).toString('base64');
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
      // Combine all audio chunks
      const combinedPCMBase64 = currentBuffer.join('');
      
      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `batch_${currentChunkId}_${timestamp}.wav`;
      
      // Convert PCM to WAV format and save to file
      const wavBase64 = createWAVFromPCM(combinedPCMBase64, 16000, filename);
      
      // Use the generateContent method directly on ai.models
      const result = await ai.models.generateContent({
        model: batchModel,
        contents: [
          {
            parts: [
              {
                text: "Transcribe this audio accurately. Only return the transcription text, nothing else."
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
      
      const transcriptionText = result.text;
      
      if (transcriptionText) {
        const correctedData = { 
          type: 'corrected_transcription', 
          text: transcriptionText.trim(),
          chunkId: currentChunkId,
          timestamp: Date.now()
        };
        
        ws.send(JSON.stringify(correctedData));
        console.log('CORRECTED transcription sent (via standard API):', correctedData);
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
    realtimeSession = await ai.live.connect({
      model: liveModel,
      callbacks: {
        onopen: () => {
          console.log('Real-time Gemini session connected');
          ws.send(JSON.stringify({ type: 'status', message: 'Connected to Gemini' }));
          
          // Start batch processing interval (every 3 seconds)
          batchInterval = setInterval(processBatchAudio, 3000);
          console.log('Started batch processing interval (every 3 seconds)');
        },
        onmessage: (message) => {
          // Send real-time transcription immediately
          if (message.serverContent && message.serverContent.inputTranscription) {
            const transcriptionText = message.serverContent.inputTranscription.text;
            
            // Send as real-time
            const realtimeData = { 
              type: 'realtime_transcription', 
              text: transcriptionText
            };
            ws.send(JSON.stringify(realtimeData));
            console.log('REALTIME transcription sent:', realtimeData);
          }
        },
        onerror: (error) => {
          console.error('Real-time session error:', error);
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        },
        onclose: (event) => {
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
        inputAudioTranscription: {}
      }
    });
    
  } catch (error) {
    console.error('Failed to connect to Gemini:', error);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to connect to Gemini: ' + error.message }));
  }

  // Handle messages from client
  let audioChunkCount = 0;
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'audio' && realtimeSession) {
        audioChunkCount++;
        if (audioChunkCount % 10 === 0) {
          console.log(`Received ${audioChunkCount} audio chunks so far`);
        }
        
        // Add to buffer for batch processing
        audioBuffer.push(data.audio);
        
        // Send to real-time session for immediate feedback
        await realtimeSession.sendRealtimeInput({
          audio: {
            data: data.audio,
            mimeType: "audio/pcm;rate=16000"
          }
        });
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
    console.log('Client disconnected');
    
    // Process any remaining audio
    if (audioBuffer.length > 0) {
      processBatchAudio();
    }
    
    // Clear batch interval
    if (batchInterval) {
      clearInterval(batchInterval);
      batchInterval = null;
    }
    
    // Close session
    if (realtimeSession) {
      realtimeSession.close();
    }
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