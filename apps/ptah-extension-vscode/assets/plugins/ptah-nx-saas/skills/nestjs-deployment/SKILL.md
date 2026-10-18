---
name: nestjs-deployment
description: 'Productionizes NestJS apps for containers. Use for multi-stage Docker builds of NestJS or Nx apps, webpack externals, migrations at deploy time, health checks, CORS and rate limiting, production logging, or deploying to a cloud platform.'
---

# NestJS Deployment Patterns

## Apply

- Use this during a Stage B deployment task after the app and its runtime dependencies are known.
- Produce a runtime image with the compiled app, production dependencies, and migration assets; verify packages that cannot be bundled before choosing externals.
- Run `prisma migrate deploy` in the container start command before serving traffic. Keep readiness dependent on required services and preserve a rollback path.
- Keep validation, CORS, throttling, security headers, health checks, and structured logging active in production.

## Load by task

- For image stages, runtime files, compose, and ignore rules, load [Docker builds](references/docker-multistage.md).
- For CORS, validation, throttling, logging, health checks, and memory, load [production hardening](references/production-hardening.md).
- For Prisma deploy migrations and rollback, load [database migrations](references/database-migrations.md).
- For native packages or libraries that break when bundled, load [webpack bundling](references/webpack-bundling.md).
