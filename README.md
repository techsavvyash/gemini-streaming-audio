# Gemini Audio Transcription

Real-time audio transcription using Google Gemini API with dual-mode processing.

## Stack
- **Backend**: Node.js, WebSocket, Gemini API
- **Frontend**: React, TypeScript, Vite
- **Runtime**: Bun + PM2

## Setup

```bash
# Install dependencies
cd backend && bun install
cd ../frontend && bun install

# Configure environment
cd backend
cp .env.example .env  # Add your GEMINI_API_KEY
```

## Development

```bash
# Start both services
pm2 start ecosystem.config.js

# Or run individually
cd backend && bun run server.js
cd frontend && bun run dev
```

## Architecture

- **Real-time transcription**: Gemini Live API for immediate feedback
- **Batch transcription**: 3-second audio chunks via standard Gemini API for accuracy
- **WebSocket**: Bidirectional audio streaming on port 8888
- **Express API**: Port 3011

## PM2 Commands

```bash
pm2 status          # Check status
pm2 logs            # View logs
pm2 restart all     # Restart services
pm2 stop all        # Stop services
pm2 delete all      # Remove from PM2
```

## Environment Variables

```env
GEMINI_API_KEY=your_api_key
PORT=3011
WS_PORT=8888
```