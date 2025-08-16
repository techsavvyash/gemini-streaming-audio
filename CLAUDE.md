# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Development
```bash
# Install dependencies
cd backend && bun install
cd frontend && bun install

# Start single server with PM2 (builds frontend and serves it)
pm2 start ecosystem.config.js

# Development workflow
cd backend && bun run build:start    # Build frontend and start server
cd backend && bun run dev           # Start server in dev mode (for backend changes)

# Frontend development (when working on frontend only)
cd frontend && bun run dev          # Run Vite dev server
cd frontend && bun run build        # Build for production
cd frontend && bun run lint         # Run ESLint
```

### PM2 Management
```bash
pm2 status          # Check service status
pm2 logs            # View logs
pm2 restart all     # Restart service
pm2 stop all        # Stop service
pm2 delete all      # Remove service from PM2
```

### Docker
```bash
# Build the Docker image
docker build -t gemini-audio-app .

# Run the container
docker run -p 3011:3011 -p 8888:8888 \
  -e GEMINI_API_KEY=your_api_key_here \
  gemini-audio-app

# Run with environment file
docker run -p 3011:3011 -p 8888:8888 \
  --env-file backend/.env \
  gemini-audio-app

# Run in detached mode
docker run -d -p 3011:3011 -p 8888:8888 \
  --name gemini-audio \
  -e GEMINI_API_KEY=your_api_key_here \
  gemini-audio-app

# View logs
docker logs gemini-audio

# Stop container
docker stop gemini-audio

# Remove container
docker rm gemini-audio
```

## Architecture Overview

This is a real-time audio transcription application using Google Gemini API with dual-mode processing:

### Single Server Architecture
- **Express server** on port 3011 serves both API endpoints and React app
- **WebSocket server** on port 8888 for real-time audio streaming
- **Static file serving**: React build files served from `frontend/dist/`
- **Dual transcription approach**:
  - Real-time: Gemini Live API (`gemini-live-2.5-flash-preview`) for immediate feedback
  - Batch: Standard Gemini API (`gemini-1.5-flash`) processes 3-second chunks for accuracy
- **Audio processing**: PCM to WAV conversion using `wavefile` library
- **File storage**: Audio samples saved to `backend/audio_samples/` directory

### Frontend (React + TypeScript + Vite)
- **Real-time audio capture** using Web Audio API
- **WebSocket client** for bidirectional communication
- **Dual display**: Shows both real-time and corrected transcriptions
- **Audio context**: 16kHz sample rate for optimal Gemini compatibility
- **Built and served** by Express server (no separate dev server needed in production)

### Key Components
- `backend/server.js`: Main server with WebSocket handling and Gemini integration
- `frontend/src/GdmLiveAudioSecure.tsx`: Main audio capture and transcription component
- `ecosystem.config.js`: PM2 configuration for production deployment

## Environment Configuration

Required environment variables in `backend/.env`:
```env
GEMINI_API_KEY=your_api_key_here
PORT=3011
WS_PORT=8888
```

## Development Notes

- Uses **Bun runtime** for both backend and frontend
- **Single server deployment**: Express serves React build files and handles WebSocket connections
- Backend processes audio in real-time while buffering for batch processing every 3 seconds
- Frontend captures audio at 16kHz sample rate and sends PCM data via WebSocket
- Audio files are automatically saved with timestamps for debugging and analysis
- The application handles both live transcription (immediate) and corrected transcription (delayed but more accurate)
- For frontend development, you can still use `bun run dev` in the frontend directory for hot reloading

## Docker Deployment

The Dockerfile uses a multi-stage build process:
1. **Dependencies stage**: Installs dependencies for both frontend and backend
2. **Frontend builder stage**: Builds the React application
3. **Production stage**: Combines backend code with built frontend and sets up runtime

Key Docker features:
- Uses official Bun image for optimal performance
- Non-root user for security
- Health check endpoint
- Proper volume handling for audio samples
- Optimized layer caching