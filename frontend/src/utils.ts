/**
 * Audio utility functions for Gemini Live API
 */

let blobCounter = 0;

export function createBlob(pcmData: Float32Array): { data: string; mime_type: string } {
  blobCounter++;
  
  // Convert Float32Array to Int16Array (PCM format)
  const int16Data = new Int16Array(pcmData.length);
  let maxAmplitude = 0;
  for (let i = 0; i < pcmData.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcmData[i]));
    maxAmplitude = Math.max(maxAmplitude, Math.abs(sample));
    int16Data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  
  // Convert to base64
  const uint8Data = new Uint8Array(int16Data.buffer);
  const base64 = btoa(String.fromCharCode(...uint8Data));
  
  // Log every 10th blob to avoid spam
  if (blobCounter % 10 === 0) {
    console.log(`🎵 Audio blob #${blobCounter}: input samples=${pcmData.length}, output bytes=${uint8Data.length}, max amplitude=${maxAmplitude.toFixed(3)}, base64 length=${base64.length}`);
  }
  
  return {
    data: base64,
    mime_type: 'audio/pcm;rate=16000'
  };
}

export function decode(base64: string): ArrayBuffer {
  console.log(`🔊 Decoding audio: base64 length=${base64.length}`);
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  console.log(`🔊 Decoded to ${bytes.length} bytes`);
  return bytes.buffer;
}

export async function decodeAudioData(
  arrayBuffer: ArrayBuffer,
  audioContext: AudioContext,
  sampleRate: number,
  channels: number
): Promise<AudioBuffer> {
  console.log(`🎧 Decoding audio data: buffer size=${arrayBuffer.byteLength}, sample rate=${sampleRate}, channels=${channels}`);
  
  try {
    // Try to decode directly - clone the buffer first
    const bufferCopy = arrayBuffer.slice(0);
    const buffer = await audioContext.decodeAudioData(bufferCopy);
    console.log(`✅ Audio decoded successfully: duration=${buffer.duration}s`);
    return buffer;
  } catch (e) {
    console.warn(`⚠️ Direct decode failed, using manual conversion:`, e);
    
    // Calculate number of samples (16-bit = 2 bytes per sample)
    const numSamples = Math.floor(arrayBuffer.byteLength / 2);
    
    if (numSamples === 0) {
      console.error('❌ No audio samples to decode (buffer too small)');
      // Return a silent buffer with at least 1 sample
      const silentBuffer = audioContext.createBuffer(channels, 1, sampleRate);
      return silentBuffer;
    }
    
    // If direct decode fails, create buffer manually
    const audioBuffer = audioContext.createBuffer(
      channels,
      numSamples,
      sampleRate
    );
    
    const int16Data = new Int16Array(arrayBuffer);
    const float32Data = new Float32Array(int16Data.length);
    
    // Convert Int16 to Float32
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 0x8000;
    }
    
    // Copy to audio buffer
    for (let channel = 0; channel < channels; channel++) {
      audioBuffer.copyToChannel(float32Data, channel);
    }
    
    console.log(`✅ Manual audio decode complete: duration=${audioBuffer.duration}s, samples=${numSamples}`);
    return audioBuffer;
  }
}