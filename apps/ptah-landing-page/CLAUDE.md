# ptah-landing-page

[Back to Main](../../CLAUDE.md)

## Purpose

Angular 21 marketing site that doubles as the licensed-user portal: login/signup, profile/sessions/contact tabs, pricing, trial-ended page, legal pages, and the native admin dashboard. Talks to `ptah-license-server` via `/api/*` (`apiInterceptor`) and embeds Paddle checkout.

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
- `src/app/app.routes.ts` — `/`, `/download`, `/pricing` (TrialStatusGuard), `/login`/`/signup` (GuestGuard), `/profile` (AuthGuard + TrialStatusGuard), redirects for `/contact`, `/sessions`, `/docs` -> `https://docs.ptah.live`, legal pages, `/trial-ended` (AuthGuard), lazy `/admin` (AdminAuthGuard, hidden from nav), `**` -> `/`.

## Key Wiring

- Guards: `AuthGuard`, `GuestGuard`, `TrialStatusGuard`, `AdminAuthGuard` under `src/app/guards/`.
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
- New routes that require trial status must opt in via `TrialStatusGuard`.
- The `/docs` route is a redirect-only shim; do not host docs content here — see `apps/ptah-docs`.
- Keep initial bundle under 1mb (Tailwind purging + lazy-load any heavy admin route).
