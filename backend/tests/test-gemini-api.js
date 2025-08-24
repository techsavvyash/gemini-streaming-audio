import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Test configuration
const TEST_CONFIG = {
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-1.5-flash', // Use the same model as your server
  audioDir: path.join(process.cwd(), 'audio_samples'),
  testTimeout: 30000, // 30 seconds
};

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: TEST_CONFIG.apiKey });

/**
 * Test Gemini API with a WAV file
 * @param {string} wavFilePath - Path to the WAV file to test
 * @returns {Promise<Object>} Test result
 */
async function testGeminiWithWAV(wavFilePath) {
  console.log(`\n🧪 Testing Gemini API with: ${path.basename(wavFilePath)}`);
  
  try {
    // Check if file exists
    if (!fs.existsSync(wavFilePath)) {
      throw new Error(`WAV file not found: ${wavFilePath}`);
    }

    // Read and encode the WAV file
    const audioBuffer = fs.readFileSync(wavFilePath);
    const base64Audio = audioBuffer.toString('base64');
    
    console.log(`📁 File size: ${(audioBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`🔢 Base64 length: ${base64Audio.length} characters`);

    // Test the API call
    console.log('🚀 Calling Gemini API...');
    const startTime = Date.now();
    
    const result = await ai.models.generateContent({
      model: TEST_CONFIG.model,
      contents: [
        {
          parts: [
            {
              text: "Transcribe this audio accurately. Only return the transcription text, nothing else."
            },
            {
              inlineData: {
                mimeType: "audio/wav",
                data: base64Audio
              }
            }
          ]
        }
      ]
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Extract transcription from the correct response structure
    const transcription = result.candidates[0].content.parts[0].text;
    
    console.log('✅ API call successful!');
    console.log(`⏱️  Response time: ${responseTime}ms`);
    console.log(`📝 Transcription: "${transcription}"`);
    
    return {
      success: true,
      file: path.basename(wavFilePath),
      transcription,
      responseTime,
      fileSize: audioBuffer.length,
      base64Length: base64Audio.length
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.response) {
      console.error('🔍 Error details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    return {
      success: false,
      file: path.basename(wavFilePath),
      error: error.message,
      details: error.response?.data || null
    };
  }
}

/**
 * Find all WAV files in the audio_samples directory
 * @returns {string[]} Array of WAV file paths
 */
function findWAVFiles() {
  try {
    if (!fs.existsSync(TEST_CONFIG.audioDir)) {
      console.log(`📁 Creating audio_samples directory: ${TEST_CONFIG.audioDir}`);
      fs.mkdirSync(TEST_CONFIG.audioDir, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(TEST_CONFIG.audioDir);
    const wavFiles = files
      .filter(file => file.endsWith('.wav'))
      .map(file => path.join(TEST_CONFIG.audioDir, file))
      .sort(); // Sort for consistent testing order

    return wavFiles;
  } catch (error) {
    console.error('❌ Error reading audio_samples directory:', error.message);
    return [];
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🚀 Starting Gemini API Tests');
  console.log('=' .repeat(50));
  
  // Check API key
  if (!TEST_CONFIG.apiKey) {
    console.error('❌ GEMINI_API_KEY not found in environment variables');
    console.log('💡 Please create a .env file with your API key');
    process.exit(1);
  }

  console.log(`🔑 API Key: ${TEST_CONFIG.apiKey.substring(0, 10)}...`);
  console.log(`🤖 Model: ${TEST_CONFIG.model}`);
  console.log(`📁 Audio Directory: ${TEST_CONFIG.audioDir}`);

  // Find WAV files
  const wavFiles = findWAVFiles();
  
  if (wavFiles.length === 0) {
    console.log('\n📝 No WAV files found for testing');
    console.log('💡 Record some audio in the frontend to generate test files');
    console.log('💡 Or add WAV files manually to the audio_samples directory');
    return;
  }

  console.log(`\n📁 Found ${wavFiles.length} WAV file(s) for testing:`);
  wavFiles.forEach(file => {
    console.log(`   - ${path.basename(file)}`);
  });

  // Run tests
  const results = [];
  for (const wavFile of wavFiles) {
    const result = await testGeminiWithWAV(wavFile);
    results.push(result);
    
    // Add delay between tests to avoid rate limiting
    if (wavFiles.indexOf(wavFile) < wavFiles.length - 1) {
      console.log('⏳ Waiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Summary
  console.log('\n📊 Test Summary');
  console.log('=' .repeat(50));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  
  if (successful.length > 0) {
    console.log('\n📝 Successful Transcriptions:');
    successful.forEach(result => {
      console.log(`   ${result.file}: "${result.transcription}" (${result.responseTime}ms)`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\n❌ Failed Tests:');
    failed.forEach(result => {
      console.log(`   ${result.file}: ${result.error}`);
    });
  }

  // Overall result
  if (failed.length === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  });
}

export { testGeminiWithWAV, findWAVFiles, runTests };
