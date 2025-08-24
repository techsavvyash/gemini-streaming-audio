#!/usr/bin/env node

/**
 * Simple test runner for Gemini API tests
 * Usage: node tests/run-tests.js
 */

import { runTests } from './test-gemini-api.js';

console.log('🎯 Gemini API Test Runner');
console.log('========================');

// Check if we're in the right directory
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Change to backend directory if needed
if (!__dirname.includes('backend')) {
  console.log('📁 Changing to backend directory...');
  process.chdir(join(__dirname, '..'));
}

// Run the tests
runTests().catch(error => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});
