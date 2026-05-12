# ptah-license-server-e2e

[Back to Main](../../CLAUDE.md)

## Purpose

Jest end-to-end suite that boots the license server and verifies the auth flow, license verify endpoint, and Paddle webhook handling against a live HTTP surface.

## Entry Points

- `src/auth-flow.e2e-spec.ts` — WorkOS auth flow integration
- `src/license-verify.e2e-spec.ts` — `/api/v1/licenses/verify` Ed25519 signature path
- `src/paddle-webhook.e2e-spec.ts` — Paddle webhook signature verification + subscription state transitions
- `src/support/` — shared fixtures and HTTP helpers

## Build & Run

- `nx e2e ptah-license-server-e2e` — `@nx/jest:jest` against `jest.config.cts`.
- `implicitDependencies: ['ptah-license-server']` ensures the server builds first when invoked via affected graph.

## Guidelines

- Use a dedicated test database (`DATABASE_URL` override). Reset Prisma schema between suites via `nx prisma:reset ptah-license-server`.
- Webhook tests must compute the HMAC signature with the same secret the server has loaded — load both from one fixture.
- Keep tests independent; clean Paddle/Trial fixtures in afterEach to avoid order coupling.
