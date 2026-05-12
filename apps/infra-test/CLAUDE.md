# infra-test

[Back to Main](../../CLAUDE.md)

## Purpose

Standalone Node scripts that exercise live infrastructure via HTTP/SDK calls — admin-endpoint triggers, AI SDK probe scripts, and CLI headless smoke. Not a library and not a service; each script is run manually or from CI to validate real integrations.

## Entry Points

- `src/main.ts` — trial-reminder admin trigger. Loads `apps/ptah-license-server/.env` then `.env`, POSTs to `/admin/trial-reminder/trigger` with `X-Admin-Secret`. Used to test the real `TrialReminderService` cron path against a running license server.
- `src/test-claude-sdk-models.ts`, `src/test-codex-sdk.ts`, `src/test-codex-models.ts`, `src/test-copilot-models.ts` — AI provider SDK probes for model enumeration.
- `src/test-cli-headless.ts` — headless CLI smoke driver.
- `src/test-sdk-context-usage.ts`, `src/test-sdk-context-window.ts` — context-window/usage assertions against provider SDKs.

## Build & Run

- `nx build infra-test` — esbuild Node bundle to `dist/apps/infra-test/` (`bundle: false`, `generatePackageJson: true`, CJS). Use `nx run infra-test:prune` for a Docker-ready output.
- `nx serve infra-test` — `@nx/js:node` against the build output.
- Most scripts are invoked directly via `npx ts-node` or the documented npm scripts (`npm run test:trial-cron`, etc.); the build target exists so the trial-reminder script can ship as a self-contained dist.

## Required Environment

- `LICENSE_SERVER_URL` (default `http://localhost:3000`)
- `ADMIN_SECRET` — must match the license server's `.env`
- Provider API keys when running SDK probe scripts

## Guidelines

- Never duplicate business logic from `ptah-license-server` here. The point of this app is to drive the real service over HTTP — if a script needs new functionality, expose it on the server.
- Treat every script as one-shot: log to stdout, exit non-zero on failure, no daemons.
- Don't commit secrets — read everything from env or `.env` files outside the repo.
