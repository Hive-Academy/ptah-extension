---
name: nestjs-deployment
description: 'NestJS deployment and production hardening patterns for containerized applications. Use when creating Docker multi-stage builds for NestJS/Nx apps, configuring webpack bundling with external packages, setting up database migration strategies for deployment, implementing health checks and monitoring, hardening production security (CORS, rate limiting, validation), configuring environment-driven logging and error handling, or deploying to cloud platforms (DigitalOcean, AWS, GCP, Railway). Covers the full path from local development to production deployment.'
---

# NestJS Deployment Patterns

Patterns for taking NestJS applications from development to production with Docker, proper bundling, database migrations, and security hardening. Extracted from production deployments on DigitalOcean App Platform but adaptable to any cloud provider.

## Activation scope

This skill activates **per-module during Stage B** of the SaaS bootstrap, typically against a `deploy-docker` or `deploy-ci` roadmap item. It is NOT part of the Stage A foundation produced by `saas-workspace-initializer` — Stage A only sets up minimal lint/test CI. Reach for this skill when productionizing the deployment pipeline, not before there is anything to deploy.

## Deployment Checklist

Before shipping to production, verify every item:

- [ ] Multi-stage Docker build (builder, deps, runtime)
- [ ] Webpack externals for problematic packages
- [ ] Database migration on deploy (`prisma migrate deploy`)
- [ ] Health check endpoint (`/api` or `/api/health`)
- [ ] Non-root container user
- [ ] Environment-driven configuration (`ConfigService`)
- [ ] Rate limiting (`@nestjs/throttler`)
- [ ] CORS restricted to frontend URL
- [ ] Input validation pipeline (`ValidationPipe`)
- [ ] Production logging levels (no debug/verbose)
- [ ] Memory limits (`--max-old-space-size`)
- [ ] `.dockerignore` excludes unnecessary files

## Architecture

```
[Development]
  Dockerfile.dev
    -> Full dependencies (dev + prod)
    -> Volume mounts for hot reload
    -> nx serve for development server
    -> Health check on /api

[Production]
  Dockerfile (multi-stage)
    Stage 1: Builder
      -> Install ALL deps, copy source
      -> npx nx build app-name
      -> Generate Prisma client

    Stage 2: Dependencies
      -> Copy generated package.json from builder
      -> npm install --omit=dev
      -> Explicitly install webpack externals

    Stage 3: Runtime
      -> node:20-alpine minimal image
      -> Non-root user (nestjs:nodejs)
      -> Copy: node_modules, built app, Prisma files
      -> Regenerate Prisma client (Alpine binaries)
      -> Health check, memory limits
      -> CMD: prisma migrate deploy && node main.js
```

## Quick Start: Minimal Production Dockerfile

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/my-api ./apps/my-api/
COPY libs ./libs/
RUN npm ci
RUN cd apps/my-api && npx prisma generate
RUN npx nx build my-api --configuration=production

# Stage 2: Production deps
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY --from=builder /app/dist/apps/my-api/package.json ./
RUN npm install --omit=dev

# Stage 3: Runtime
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist/apps/my-api ./
COPY --from=builder /app/apps/my-api/prisma ./prisma/
RUN npx prisma generate --schema=prisma/schema.prisma
RUN chown -R nestjs:nodejs /app
USER nestjs
EXPOSE 3000
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=450"
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node main.js"]
```

## Quick Start: Production main.ts

```typescript
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import cookieParser = require('cookie-parser');

async function bootstrap() {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const logLevels: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[] = isProduction ? ['log', 'error', 'warn'] : ['log', 'error', 'warn', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: logLevels,
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.setGlobalPrefix('api', {
    exclude: ['webhooks/{*path}'],
  });

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);
  Logger.log(`Application running on http://localhost:${port}/api`);
}

bootstrap();
```

## Decision Matrix

| Need                            | Pattern                | Reference                                                     |
| ------------------------------- | ---------------------- | ------------------------------------------------------------- |
| Docker build for NestJS + Nx    | Multi-stage Dockerfile | [docker-multistage.md](references/docker-multistage.md)       |
| Packages break when bundled     | Webpack externals      | [webpack-bundling.md](references/webpack-bundling.md)         |
| DB schema sync on deploy        | Migration on startup   | [database-migrations.md](references/database-migrations.md)   |
| CORS, rate limiting, validation | Production hardening   | [production-hardening.md](references/production-hardening.md) |
| Health checks, logging, memory  | Production hardening   | [production-hardening.md](references/production-hardening.md) |

## References

Load these for detailed implementation guidance:

- [docker-multistage.md](references/docker-multistage.md) - Multi-stage Docker builds for dev and production, docker-compose, .dockerignore
- [production-hardening.md](references/production-hardening.md) - Security, CORS, rate limiting, validation, logging, health checks, memory management
- [database-migrations.md](references/database-migrations.md) - Prisma migration strategy, PrismaService pattern, deploy workflow, rollback
- [webpack-bundling.md](references/webpack-bundling.md) - NestJS webpack config, externals for problematic packages, package.json generation
