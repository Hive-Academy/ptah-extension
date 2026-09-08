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
#   .github/workflows/deploy-server.yml builds this image, pushes it to ghcr.io
#   and runs it on the DigitalOcean droplet via docker-compose.prod.yml behind
#   caddy. It is NOT App Platform — nothing here is auto-detected.
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

# Copy the generated package.json + lockfile from the build output. Nx emits
# this pair (`generatePackageJson: true`) carrying only the runtime dependencies
# the bundle needs, already resolved to exact versions from the root lockfile.
COPY --from=builder /app/dist/apps/ptah-license-server/package.json ./
COPY --from=builder /app/dist/apps/ptah-license-server/package-lock.json ./

# Install that generated set EXACTLY — direct and transitive. This is the whole
# dependency tree for the app, versioned by the build rather than by hand.
#
# It replaces a `npm install --omit=dev <8 bare names>` (TASK_2026_392). Naming a
# package on an `npm install` line resolves it to `latest` and OVERWRITES the
# exact version Nx had already pinned. Five of those eight were redundant, and
# the override is how `prisma` reached 8.0.0-rc.12 on 2026-09-04 against
# @prisma/client 7.7.0. Prisma 8 renamed `migrate` to `migration`, so the CMD
# below exited 2 with CLI.UNKNOWN_COMMAND, `&&` short-circuited, and main.cjs
# never ran. caddy declares depends_on service_healthy, so it never bound
# :80/:443 and api.ptah.live refused TCP for four days.
#
# `--ignore-scripts`: a lifecycle script in ANY transitive dependency runs
# arbitrary code as part of the build (sonar docker:S6505). The builder stage
# above already installs this way. Verified safe for this dependency set, not
# assumed — with scripts disabled, `prisma validate` passes, `prisma migrate
# diff` emits the full DDL, and `prisma migrate deploy` reaches P1001 against an
# unreachable database, which means the schema engine loaded and only the
# connection failed. Nothing here needs a postinstall.
RUN npm ci --omit=dev --ignore-scripts

# The one package the generated manifest cannot carry. `generatePackageJson`
# emits root `dependencies` only, and the prisma CLI is a devDependency — as it
# should be, since it is a tool rather than something main.cjs imports. But the
# CMD below runs `npx prisma migrate deploy`, so the image needs it.
#
# EXACT VERSION ON PURPOSE — DO NOT LOOSEN. The CLI must stay equal to
# `@prisma/client` in the generated manifest (7.7.0); a major split between them
# breaks the container before the app boots, which is what happened on
# 2026-09-04. `--no-save` keeps the generated manifest authoritative.
#
# Three further packages used to be named here — @workos-inc/node,
# @nestjs/config and @nestjs/jwt. They were missing from the generated manifest
# only because they were misfiled under root `devDependencies` despite being
# runtime imports. Fixed at the source in package.json, so Nx now emits them.
RUN npm install --omit=dev --no-save --ignore-scripts prisma@7.7.0

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
