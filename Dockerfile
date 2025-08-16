# Use Bun as base image
FROM oven/bun:1 AS base

# Install dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files
COPY backend/package*.json backend/bun.lock ./backend/
COPY frontend/package*.json frontend/bun.lockb ./frontend/

# Install dependencies
RUN cd backend && bun install
RUN cd frontend && bun install

# Build frontend stage
FROM base AS frontend-builder
WORKDIR /app
COPY frontend/ ./frontend/
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules

# Build frontend
RUN cd frontend && bun run build

# Production stage
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy backend dependencies
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create audio_samples directory
RUN mkdir -p /app/backend/audio_samples
RUN chown nodejs:nodejs /app/backend/audio_samples

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3011 8888

# Set working directory to backend
WORKDIR /app/backend

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3011/ || exit 1

# Start the server
CMD ["bun", "run", "start"]