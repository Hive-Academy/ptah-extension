# =============================================================================
# Ptah License Server - Production Dockerfile
# =============================================================================
#
# Multi-stage build for optimal production image:
#   - Stage 1: Install dependencies and build
#   - Stage 2: Production dependencies only
#   - Stage 3: Minimal runtime image
#
# BUILD:
#   docker build -f apps/ptah-license-server/Dockerfile -t ptah-license-server:latest .
#
# RUN:
#   docker run -p 3000:3000 --env-file .env ptah-license-server:latest
#
# DEPLOY:
#   DigitalOcean App Platform detects this Dockerfile automatically
#
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Install dependencies and build the application
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Set working directory to monorepo root
WORKDIR /app

# Install system dependencies required by Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Copy Nx workspace configuration
COPY nx.json tsconfig.base.json ./

# Copy the license server project files
COPY apps/ptah-license-server ./apps/ptah-license-server/

# Copy shared libraries
COPY libs ./libs/

# Install ALL dependencies (including devDependencies for build)
# --ignore-scripts: skip native module compilation (e.g., node-pty is Electron-only)
# Then explicitly install esbuild so its platform-specific binary is available for Nx build.
RUN npm ci --ignore-scripts && npm rebuild esbuild

# Generate Prisma client
RUN cd apps/ptah-license-server && npx prisma generate

# Build the application
RUN npx nx build ptah-license-server --configuration=production

# -----------------------------------------------------------------------------
# Stage 2: Dependencies - Install production dependencies only
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Install system dependencies required by Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy generated package.json from build output
# NxAppWebpackPlugin generates this with only required dependencies
COPY --from=builder /app/dist/apps/ptah-license-server/package.json ./
COPY --from=builder /app/dist/apps/ptah-license-server/package-lock.json ./

# Also copy root package-lock.json for dependency resolution
COPY package-lock.json ./root-package-lock.json

# Install production dependencies
# Note: We add the external packages that esbuild excludes but are needed at runtime
# @sentry/nestjs: error tracking and performance monitoring (TASK_2025_251)
RUN npm install --omit=dev \
    @workos-inc/node \
    @nestjs/config \
    @nestjs/jwt \
    @paddle/paddle-node-sdk \
    resend \
    pg \
    prisma \
    @sentry/nestjs

# -----------------------------------------------------------------------------
# Stage 3: Production - Minimal runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache openssl libc6-compat

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from builder
COPY --from=builder /app/dist/apps/ptah-license-server ./

# Copy Prisma schema and migrations for runtime migrate deploy
COPY --from=builder /app/apps/ptah-license-server/prisma ./prisma/
COPY --from=builder /app/apps/ptah-license-server/prisma.config.ts ./

# Copy generated Prisma client
COPY --from=builder /app/apps/ptah-license-server/src/generated-prisma-client ./src/generated-prisma-client/

# Generate Prisma client in production image (ensures engine binaries are correct)
RUN npx prisma generate --schema=prisma/schema.prisma

# Change ownership to non-root user
RUN chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Sentry DSN for error tracking (set via docker-compose or deployment config)
# When empty, Sentry initialization is skipped gracefully
ENV SENTRY_DSN=""

# Memory optimization for 512MB container
ENV NODE_OPTIONS="--max-old-space-size=450"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://localhost:3000/api/health || exit 1

# Run migrations and start server
# Note: Prisma migrate deploy is safe for production (only applies pending migrations)
CMD ["sh", "-c", "npx prisma migrate deploy && node main.cjs"]
