# Docker Multi-Stage Builds for NestJS + Nx

## Overview

NestJS applications in Nx monorepos require careful Docker configuration because:

1. The build depends on workspace-level config files (`nx.json`, `tsconfig.base.json`)
2. The app may depend on shared libraries under `libs/`
3. Prisma needs system-level dependencies (`openssl`, `libc6-compat`) and a generate step
4. Webpack externals must be explicitly installed in the production image
5. The final image should be minimal, run as non-root, and include health checks

This guide covers both development and production Dockerfiles plus Docker Compose for local development.

---

## Development Dockerfile

Use this for local development with hot reload via volume mounts.

```dockerfile
# =============================================================================
# Development Dockerfile
# =============================================================================
# BUILD:   docker build -f apps/my-api/Dockerfile.dev -t my-api:dev .
# NOTE:    Run from monorepo root (context = .)
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# System dependencies for Prisma and native modules
RUN apk add --no-cache openssl libc6-compat

# Copy package files from monorepo root
COPY package.json package-lock.json ./

# Copy Nx workspace configuration
COPY nx.json tsconfig.base.json ./

# Copy project configuration files (not source - that comes via volume mount)
COPY apps/my-api/project.json ./apps/my-api/
COPY apps/my-api/tsconfig*.json ./apps/my-api/
COPY apps/my-api/webpack.config.js ./apps/my-api/

# Copy Prisma schema and config for client generation
# prisma.config.ts must be at the app root for Prisma 7+ CLI commands
COPY apps/my-api/prisma ./apps/my-api/prisma/
COPY apps/my-api/prisma.config.ts ./apps/my-api/

# Install all dependencies (dev + prod)
RUN npm ci --ignore-scripts

# Generate Prisma client (must run from app directory for Prisma 7+)
RUN cd apps/my-api && npx prisma generate

# Copy source code (overwritten by volume mount in docker-compose)
COPY apps/my-api/src ./apps/my-api/src/

# Copy shared libraries the app depends on
COPY libs ./libs/

EXPOSE 3000

ENV NODE_ENV=development

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api || exit 1

# Start Nx dev server with hot reload
CMD ["npx", "nx", "serve", "my-api"]
```

### Key Decisions

| Decision                                 | Rationale                                           |
| ---------------------------------------- | --------------------------------------------------- |
| `--ignore-scripts` on npm ci             | Prevents postinstall issues in Docker build context |
| Copy config files separately from source | Allows Docker layer caching for deps                |
| `start-period=60s` on health check       | Nx serve takes time to compile on first run         |
| Source copy despite volume mount         | Container works standalone if volumes not mounted   |

---

## Production Dockerfile (3 Stages)

### Stage 1: Builder

Installs all dependencies, builds the application, and generates the Prisma client.

```dockerfile
# =============================================================================
# Production Dockerfile - Multi-Stage Build
# =============================================================================
# BUILD:   docker build -f apps/my-api/Dockerfile -t my-api:latest .
# RUN:     docker run -p 3000:3000 --env-file .env my-api:latest
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Install dependencies and build the application
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# System dependencies required by Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Copy Nx workspace configuration
COPY nx.json tsconfig.base.json ./

# Copy the application project files
COPY apps/my-api ./apps/my-api/

# Copy shared libraries the app imports
COPY libs ./libs/

# Install ALL dependencies (including devDependencies for build tools)
RUN npm ci

# Generate Prisma client (before build so it's available to TypeScript)
RUN cd apps/my-api && npx prisma generate

# Build the application with Nx
RUN npx nx build my-api --configuration=production
```

### Stage 2: Dependencies

Creates a clean `node_modules` with only production dependencies plus webpack externals.

```dockerfile
# -----------------------------------------------------------------------------
# Stage 2: Dependencies - Install production dependencies only
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# System dependencies required by Prisma
RUN apk add --no-cache openssl libc6-compat

# Copy generated package.json from build output
# NxAppWebpackPlugin with generatePackageJson: true creates this
COPY --from=builder /app/dist/apps/my-api/package.json ./
COPY --from=builder /app/dist/apps/my-api/package-lock.json ./

# Install production dependencies + webpack externals
# Webpack externals are packages excluded from the bundle that must be
# installed as runtime dependencies. They are not in the generated
# package.json because webpack marked them as external.
RUN npm install --omit=dev \
    @prisma/client \
    prisma
```

**Adapting for your project**: Add your webpack externals to the `npm install` line. Common additions:

```dockerfile
# Payment SDK
RUN npm install --omit=dev \
    @prisma/client \
    prisma \
    @paddle/paddle-node-sdk \
    @workos-inc/node \
    resend \
    pg
```

### Stage 3: Production Runtime

Minimal image with non-root user, health check, and migration-before-start.

```dockerfile
# -----------------------------------------------------------------------------
# Stage 3: Production - Minimal runtime image
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Runtime system dependencies only
RUN apk add --no-cache openssl libc6-compat

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder /app/dist/apps/my-api ./

# Copy Prisma schema and migrations for runtime migrate deploy
COPY --from=builder /app/apps/my-api/prisma ./prisma/
COPY --from=builder /app/apps/my-api/prisma.config.ts ./

# Copy generated Prisma client (if using custom output path)
COPY --from=builder /app/apps/my-api/src/generated-prisma-client ./src/generated-prisma-client/

# Regenerate Prisma client in production image
# This ensures engine binaries match the Alpine runtime (not the build OS)
RUN npx prisma generate --schema=prisma/schema.prisma

# Set ownership to non-root user
RUN chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Expose application port
EXPOSE 3000

# Production environment
ENV NODE_ENV=production
ENV PORT=3000

# Memory optimization for constrained containers (512MB)
# Set to ~85-90% of container memory limit
ENV NODE_OPTIONS="--max-old-space-size=450"

# Health check for orchestrator / load balancer
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api || exit 1

# Run migrations then start server
# prisma migrate deploy: applies pending migrations without interactive prompts
# Safe for production: never creates or modifies migration files
CMD ["sh", "-c", "npx prisma migrate deploy && node main.js"]
```

### Why Three Stages?

| Stage        | Size Contribution  | Purpose                                               |
| ------------ | ------------------ | ----------------------------------------------------- |
| Builder      | ~1.2GB (discarded) | Full toolchain: TypeScript, Nx, webpack, all npm deps |
| Dependencies | ~200MB (discarded) | Clean production node_modules without build tools     |
| Production   | ~180-250MB (final) | Minimal runtime: Alpine + production deps + built app |

A single-stage build would produce a 1.2GB+ image. Three stages reduce this to ~200MB.

---

## Docker Compose for Local Development

```yaml
services:
  # PostgreSQL database
  postgres:
    image: postgres:16-alpine
    container_name: my_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: myapp_dev_password
      POSTGRES_DB: myapp_db
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - '${POSTGRES_PORT:-5432}:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U myapp -d myapp_db']
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  # NestJS API (development)
  api:
    build:
      context: .
      dockerfile: apps/my-api/Dockerfile.dev
    container_name: my_api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - apps/my-api/.env
    environment:
      DATABASE_URL: postgresql://myapp:myapp_dev_password@postgres:5432/myapp_db
      NODE_ENV: development
      NX_DAEMON: 'false'
    volumes:
      # Mount source for hot reload
      - ./apps/my-api/src:/app/apps/my-api/src:delegated
      - ./apps/my-api/prisma:/app/apps/my-api/prisma:delegated
      - ./apps/my-api/prisma.config.ts:/app/apps/my-api/prisma.config.ts:delegated
      # Mount shared libraries
      - ./libs:/app/libs:delegated
      # Named volume for node_modules (prevents host overwrite)
      - api-node-modules:/app/node_modules
    ports:
      - '${API_PORT:-3000}:3000'
    # Run migrations before starting dev server
    command: >
      sh -c "
        cd apps/my-api &&
        echo 'Running migrations...' &&
        npx prisma migrate deploy &&
        echo 'Generating Prisma client...' &&
        npx prisma generate &&
        cd /app &&
        echo 'Starting dev server...' &&
        npx nx serve my-api
      "
    networks:
      - app-network

volumes:
  postgres-data:
  api-node-modules:

networks:
  app-network:
    driver: bridge
```

### Docker Compose Key Patterns

| Pattern                         | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `condition: service_healthy`    | API waits for PostgreSQL to accept connections             |
| `:delegated` volume flag        | Improves filesystem performance on macOS                   |
| Named volume for `node_modules` | Prevents host OS node_modules from overwriting container's |
| `NX_DAEMON: 'false'`            | Disables Nx daemon in containers (avoids orphan processes) |
| `env_file` + `environment`      | `.env` for secrets, inline for Docker-specific overrides   |
| Migrations in `command`         | Ensures schema is current before app starts                |

---

## .dockerignore

Place at the monorepo root to exclude unnecessary files from the Docker build context:

```
# Dependencies (reinstalled in container)
node_modules
**/node_modules

# Build outputs
dist
**/dist

# Version control
.git
.gitignore

# IDE and editor files
.vscode
.idea
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Environment files (passed at runtime, not baked in)
.env
.env.*
!.env.example

# Test files
**/*.spec.ts
**/*.test.ts
**/__tests__
coverage
**/coverage

# Documentation
*.md
!README.md
LICENSE

# CI/CD configs
.github
.gitlab-ci.yml
.circleci

# Docker files (prevent recursive inclusion)
Dockerfile*
docker-compose*
.dockerignore

# Nx cache
.nx
tmp
```

### Why .dockerignore Matters

Without `.dockerignore`, Docker sends the entire monorepo as build context. For a typical Nx workspace:

- **Without**: ~800MB+ context (includes `node_modules`, `.git`, `dist`)
- **With**: ~50MB context (source code and config only)

This directly impacts `docker build` speed and layer cache efficiency.

---

## Cloud Platform Deployment

Regardless of provider (DigitalOcean, AWS ECS, Google Cloud Run, Railway), the workflow is the same:

1. Build image: `docker build -f apps/my-api/Dockerfile -t my-api .`
2. Push to container registry (ECR, GCR, Docker Hub, etc.)
3. Configure environment variables (especially `DATABASE_URL`, mark as SECRET)
4. Set health check path to `/api`
5. Set memory limits to match `NODE_OPTIONS`

**DigitalOcean App Platform**: Set Dockerfile path to `apps/my-api/Dockerfile` and build context to `.` (monorepo root). Environment variables are configured in the console.

**AWS ECS / Fargate**: Push to ECR, configure health check in target group, set memory in task definition.

**Railway / Render**: Auto-detect Dockerfile or specify in config. Health check auto-detected from `HEALTHCHECK`.

---

## Troubleshooting

| Symptom                                 | Cause                                        | Fix                                                                    |
| --------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `@prisma/client did not initialize yet` | Generated for build OS, not Alpine           | Add `RUN npx prisma generate --schema=prisma/schema.prisma` in Stage 3 |
| `Cannot find module '@some/sdk'`        | Webpack external not installed in deps stage | Add package to `npm install` in Stage 2                                |
| `Cannot find module '@my-org/shared'`   | `libs/` not copied to builder                | Add `COPY libs ./libs/` in Stage 1                                     |
| Container restarts repeatedly           | Health check failing                         | Increase `start-period`, verify endpoint path, check `docker logs`     |
