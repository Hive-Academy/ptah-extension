# ptah-landing-page

[Back to Main](../../CLAUDE.md)

## Purpose

Angular 21 marketing site that doubles as the licensed-user portal: login/signup, profile/sessions/contact tabs, pricing (open-source Community framing + Ptah Builders waitlist), legal pages, and the native admin dashboard. Talks to `ptah-license-server` via `/api/*` (`apiInterceptor`) and embeds Paddle checkout for legacy Pro subscribers and, once `BUILDERS_CHECKOUT_ENABLED` flips on, Ptah Builders.

## Entry Points

- `src/main.ts` — Angular bootstrap (Zone-based).
- `src/app/app.config.ts` — provides:
  - `APP_INITIALIZER` running `AuthInitializerService.initialize()` BEFORE routing (handles `?auth_hint=1` redirects from OAuth/magic-link backends).
  - `provideRouter(routes)`
  - `provideHttpClient(withInterceptors([apiInterceptor]))`
  - `provideZoneChangeDetection({ eventCoalescing: true })`
  - `provideMarkdownRendering({ extensions: 'basic' })` (basic — needed by `ExecutionNodeComponent` from `@ptah-extension/chat`)
  - `providePaddleConfig({...})` from `environment.paddle`
  - `provideGsap({ defaults: { ease: 'power2.out', duration: 0.8 } })`
- `src/app/app.routes.ts` — `/`, `/download`, `/pricing-lab` (non-production sandbox), `/pricing`, `/login`/`/signup` (GuestGuard), `/profile` (AuthGuard), redirects for `/contact`, `/sessions` -> `/profile`, `/docs` -> `https://docs.ptah.live`, legal pages (`/terms-and-conditions`, `/privacy`, `/refund`), lazy `/admin` (AdminAuthGuard, hidden from nav), `**` -> `/`. No trial gating remains: `TrialStatusGuard` and the `/trial-ended` route were removed when the product became fully functional without a license key (commit `e349b7f2b`); `/pricing` now points signups at the Ptah Builders waitlist (`POST /api/v1/waitlist`) instead of a paywall.

## Key Wiring

- Guards: `AuthGuard`, `GuestGuard`, `AdminAuthGuard` under `src/app/guards/`.
- `src/app/interceptors/api.interceptor.ts` — base URL + credentials for license-server calls.
- `src/app/services/auth-initializer.service.ts` — pre-route auth-hint hydration.
- `src/app/config/paddle.config.ts` — Paddle DI token.
- `proxy.conf.json` — dev-server proxy to local license server.

## Library Dependencies

- `@hive-academy/angular-gsap` — scroll/landing animations
- `@ptah-extension/markdown` — markdown rendering shared with the webview
- `@ptah-extension/chat` — only `ExecutionNodeComponent` is reused on marketing pages (hence basic markdown)

## Build & Run

- `nx build ptah-landing-page` — `@angular/build:application`. Production budgets: 1mb warn / 2mb error initial; 4kb warn / 8kb error per-component styles. Replaces `environments/environment.ts` with `environment.production.ts`.
- `nx serve ptah-landing-page` — dev server with `proxy.conf.json`.
- `nx serve-static ptah-landing-page` — `@nx/web:file-server` against the SPA build.
- Output: `dist/ptah-landing-page/browser/`.

## Guidelines

- Server-side admin enforcement (ADMIN_EMAILS allowlist on the license server) is the source of truth — `AdminAuthGuard` is a UX shortcut only.
- The product is free and open source with no trial/license gating — do not reintroduce a trial-status guard. `LicenseTier` includes legacy `'pro'`/`'trial_pro'` (draining, existing subscribers only) and the new paid `'builders'` tier; `/licenses/me` exposes `checkoutEnabled` to mirror the license server's `BUILDERS_CHECKOUT_ENABLED` flag.
- The `/docs` route is a redirect-only shim; do not host docs content here — see `apps/ptah-docs`.
- Keep initial bundle under 1mb (Tailwind purging + lazy-load any heavy admin route).
