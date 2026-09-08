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
FROM node:24-alpine AS builder

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
FROM node:24-alpine AS deps

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
#
# EVERY VERSION HERE IS EXACT ON PURPOSE — DO NOT LOOSEN (TASK_2026_392).
# This RUN does not consult the repo package.json or the lockfile, so an
# unpinned name floats to whatever the registry serves at build time. The
# versions below are the ones package-lock.json resolves for this app; keep
# them in step with the lockfile when bumping.
#
# `prisma` (the CLI) MUST equal `@prisma/client` (7.7.0), which is bundled into
# main.cjs from the lockfile and is NOT installed here. A major-version split
# between the two breaks the container before the app boots:
#   - 2026-09-04: unpinned `prisma` floated to 8.0.0-rc.12 against client 7.7.0.
#     Prisma 8 renamed `migrate` to `migration`, so the CMD below exited 2 with
#     CLI.UNKNOWN_COMMAND, `&&` short-circuited, and main.cjs never ran.
#     Prisma 8 also cannot read the v7 prisma.config.ts (CLI.CONFIG_UNREADABLE).
#   - caddy depends_on license-server: service_healthy, so it never bound
#     :80/:443 and api.ptah.live refused TCP for 4 days.
RUN npm install --omit=dev \
    @workos-inc/node@8.13.0 \
    @nestjs/config@4.0.4 \
    @nestjs/jwt@11.0.2 \
    @paddle/paddle-node-sdk@2.8.0 \
    resend@6.12.3 \
    pg@8.21.0 \
    prisma@7.7.0 \
    @sentry/nestjs@9.47.1

# -----------------------------------------------------------------------------
# Stage 3: Production - Minimal runtime image
# -----------------------------------------------------------------------------
FROM node:24-alpine AS production

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
#
# The `&&` is deliberate and stays. Serving an app against a schema whose
# migrations did not apply is worse than not serving it: partial schema means
# silent 500s and possible bad writes. Failing closed was NOT the 2026-09-04
# bug — the bug was the unpinned CLI above, and the exact pins fix it at source.
# The outage was invisible because nothing probed the deployed URL, which the
# deploy-server.yml smoke check and uptime-probe.yml now cover.
CMD ["sh", "-c", "npx prisma migrate deploy && node main.cjs"]
