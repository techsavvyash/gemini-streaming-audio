# Use Bun as base image
FROM oven/bun:1 AS base

# Install dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files
COPY backend/package*.json backend/bun.lock ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN cd backend && bun install
RUN cd frontend && bun install

# Build frontend stage
FROM base AS frontend-builder
WORKDIR /app

# Accept build arguments for frontend environment variables
ARG VITE_WS_URL
ARG REACT_APP_GEMINI_API_KEY

# Set environment variables for build
ENV VITE_WS_URL=$VITE_WS_URL
ENV REACT_APP_GEMINI_API_KEY=$REACT_APP_GEMINI_API_KEY

COPY frontend/ ./frontend/
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules

# Build frontend with environment variables
RUN cd frontend && bun run build

# Production stage
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy backend dependencies and environment files
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create audio_samples directory
RUN mkdir -p /app/backend/audio_samples
RUN chown nodejs:nodejs /app/backend/audio_samples

# Switch to non-root user
USER nodejs

# Expose ports - Railway will assign PORT dynamically  
# Default ports, but Railway will override with environment variables
EXPOSE 3001 3002

# Set working directory to backend
WORKDIR /app/backend


# Start the server
CMD ["bun", "run", "start"]