# ptah-license-server

[Back to Main](../../CLAUDE.md)

## Purpose

NestJS 11 backend that issues and verifies Ptah licenses, manages subscriptions and trials, handles Paddle and Resend webhooks, runs the WorkOS-backed auth flow, and exposes the native admin dashboard backend. Sentry-instrumented; Prisma over PostgreSQL.

## Boundaries

**Belongs here**: HTTP API, NestJS modules under `src/<feature>/`, Prisma schema + generated client, Paddle/Resend webhook handlers, WorkOS PKCE OAuth, scheduled trial-reminder cron, audit log, admin endpoints.
**Does NOT belong**: extension/UI logic, frontend (use `apps/ptah-landing-page`), CLI/agent logic.

## Entry Points

- `src/instrument.ts` — Sentry init (must be the first import).
- `src/main.ts` — `NestFactory.create(AppModule, { rawBody: true, logger })`, helmet, cookie-parser, raw-body scoped to `/webhooks/resend`, global `ValidationPipe`, CORS gated to `FRONTEND_URL` (default `https://ptah.live`) with credentials, global prefix `api` with `webhooks/paddle` and `webhooks/resend` excluded, `enableShutdownHooks()` for Sentry flush.

## Key Wiring

- `src/app/app.module.ts` — root module. Imports:
  - `ConfigModule.forRoot({ isGlobal: true })`
  - `SentryModule`
  - `ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }])` with `ThrottlerGuard` applied globally via `APP_GUARD`
  - `EventEmitterModule.forRoot()`
  - `PrismaModule`, `AuditModule` (global cross-cutting admin audit log)
  - Feature modules: `LicenseModule`, `AuthModule` (WorkOS PKCE), `PaddleModule`, `EventsModule`, `SubscriptionModule`, `TrialReminderModule`, `ContactModule`, `SessionModule`, `HealthModule`, `AdminModule`, `MarketingModule`.
- Webhook signature verification: `/webhooks/paddle` (HMAC SHA256 via `rawBody`), `/webhooks/resend` (scoped `bodyParser.raw({ type: '*/*' })` applied before global pipes).
- Prisma client is generated into `src/generated-prisma-client/`.
- Auth uses HTTP-only cookies for PKCE state (`cookie-parser`).

## Library Dependencies

- External NestJS: `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `@nestjs/event-emitter`, `@nestjs/throttler`, `@nestjs/jwt`, `helmet`, `body-parser`, `cookie-parser`.
- Externals not bundled (listed in `project.json`): `@workos-inc/node`, `@paddle/paddle-node-sdk`, `resend`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `@nestjs/microservices`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@sentry/nestjs`.
- No internal `@ptah-extension/*` imports — the server is standalone.

## Build & Run

- `nx build ptah-license-server` — esbuild CJS bundle to `dist/apps/ptah-license-server/`, `generatePackageJson: true`, `node20`.
- `nx serve ptah-license-server` — `@nx/js:node` dev runner.
- `nx run ptah-license-server:prune` — emits a trimmed package.json + lockfile + workspace_modules for Docker deploys.
- Prisma targets: `prisma:generate`, `prisma:migrate`, `prisma:deploy`, `prisma:studio`, `prisma:reset`, `prisma:resolve`, `prisma:status`, `prisma:validate`, `prisma:format`, `prisma:pull`, `prisma:push`, `prisma:seed`. Backed by `@nx-tools/nx-prisma`.

## Required Environment

- `DATABASE_URL` (PostgreSQL)
- `FRONTEND_URL` (defaults to `https://ptah.live`)
- `PORT` (default 3000)
- WorkOS, Paddle, Resend, Sentry secrets (see corresponding modules)
- `ADMIN_SECRET` for admin-triggered endpoints (consumed by `infra-test`)

## Guidelines

- Sentry instrument import (`./instrument`) must stay at the top of `main.ts` — any earlier import breaks monkey-patching.
- New webhook routes that need raw bodies must register a scoped `bodyParser.raw` before the global `ValidationPipe`, AND be excluded from the global `api` prefix in `setGlobalPrefix`.
- Per-endpoint throttling overrides the global default via `@Throttle`.
- Prisma migrations: run `nx prisma:migrate ptah-license-server` for dev; `nx prisma:deploy` in CI.
- Never log raw webhook bodies (they contain signing secrets and PII).
