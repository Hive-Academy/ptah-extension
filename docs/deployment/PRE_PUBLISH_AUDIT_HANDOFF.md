# Pre-Publish Security & Configuration Audit - Handoff Document

**Date**: 2026-03-12
**Branch**: `feature/sdk-only-migration`
**Status**: Uncommitted fixes ready for review before publishing

---

## 1. Current Infrastructure Architecture

```
Internet
   │
   ├── ptah.live (Landing Page)
   │     └── DO App Platform (Static Site, free tier)
   │         - Angular 20 SPA
   │         - Build: scripts/do-build.sh
   │         - Spec: .do/app.yaml
   │         - SSL: DO-managed (Let's Encrypt via Cloudflare)
   │
   └── api.ptah.live (License Server API)
         └── DigitalOcean Droplet ($6/month, 167.71.9.106)
             ├── Caddy (auto-HTTPS, reverse proxy)
             │     └── caddy/Caddyfile
             ├── NestJS License Server (port 3000)
             │     └── apps/ptah-license-server/Dockerfile
             └── PostgreSQL 16
                   └── docker-compose.prod.yml
```

**DNS Configuration (DO Networking, ns1/ns2/ns3.digitalocean.com)**:

- `ptah.live` (A records) → DO App Platform ingress IPs (Cloudflare anycast)
- `api.ptah.live` (A record) → 167.71.9.106 (Droplet)

---

## 2. Changes Made This Session (Uncommitted)

### Fix 1: OAuth Redirect URL Bug

**File**: `apps/ptah-landing-page/src/app/pages/auth/services/auth-api.service.ts`
**Problem**: `redirectToOAuth()` uses `window.location.href` (browser redirect) which bypasses Angular's `HttpClient` interceptor. In production, this sent users to `ptah.live/api/auth/oauth/github` instead of `api.ptah.live/api/auth/oauth/github`.
**Fix**: Added `environment.apiBaseUrl` prefix to the redirect URL.

```typescript
// Before (broken):
let url = `${this.baseUrl}/oauth/${provider}`;
// After (fixed):
let url = `${environment.apiBaseUrl}${this.baseUrl}/oauth/${provider}`;
```

### Fix 2: SSE EventSource URL Bug

**File**: `apps/ptah-landing-page/src/app/services/sse-events.service.ts`
**Problem**: `EventSource` is a browser API that also bypasses Angular's `HttpClient` interceptor. SSE connections would go to `ptah.live/api/v1/events/subscribe` instead of `api.ptah.live/api/v1/events/subscribe`.
**Fix**: Added `environment.apiBaseUrl` prefix to the EventSource URL.

```typescript
// Before (broken):
const url = `${this.sseBaseUrl}/subscribe?ticket=...`;
// After (fixed):
const url = `${environment.apiBaseUrl}${this.sseBaseUrl}/subscribe?ticket=...`;
```

### Fix 3: SPA Routing (catchall_document)

**File**: `.do/app.yaml`
**Problem**: Refreshing or directly navigating to any Angular route (e.g., `/pricing`, `/login`, `/profile`) would 404 on DO App Platform because there's no actual file at those paths.
**Fix**: Added `catchall_document: index.html` to the static site config.

---

## 3. What Works Correctly (No Changes Needed)

### HttpClient API Calls (Interceptor Handles These)

All services using Angular `HttpClient` are correctly handled by the `apiInterceptor` at `apps/ptah-landing-page/src/app/interceptors/api.interceptor.ts`. This interceptor:

- Detects requests starting with `/api` or `/auth`
- Prepends `environment.apiBaseUrl` (`https://api.ptah.live` in production)
- Sets `withCredentials: true` for cookie-based auth

**Services correctly using HttpClient (no fix needed)**:

- `auth.service.ts` — `/api/auth/me`, `/api/auth/logout`
- `paddle-checkout.service.ts` — `/api/v1/subscriptions/*`, `/api/v1/licenses/me`
- `subscription-state.service.ts` — `/api/v1/licenses/me`
- `sse-events.service.ts` (ticket endpoint) — `POST /api/auth/stream/ticket`
- `profile-page.component.ts` — `/api/v1/licenses/*`, `/api/v1/subscriptions/*`
- `sessions-grid.component.ts` — `/api/v1/sessions/*`
- `pricing-grid.component.ts` — `/api/v1/subscriptions/portal-session`
- `contact-form.component.ts` — `/api/v1/contact`
- `trial-ended-page.component.ts` — `/api/v1/licenses/*`
- `trial-status.guard.ts` — `/api/v1/licenses/me`

---

## 4. Security Configuration Inventory (For Audit)

### 4.1 Authentication

- **Method**: HTTP-only JWT cookie (`ptah_auth`)
- **Cookie settings**: `httpOnly: true`, `secure: isProduction`, `sameSite: 'lax'`
- **JWT expiration**: Configured via `JWT_EXPIRATION` env var (example: `7d`)
- **Auth providers**: WorkOS (GitHub OAuth, Google OAuth), Email/password, Magic link
- **OAuth state**: CSRF protection via `workos_state` HTTP-only cookie (5-min TTL, single-use)
- **Auth hint**: localStorage `ptah_auth_hint` syncs frontend UI state with HTTP-only cookie

### 4.2 CORS

- **Config location**: `apps/ptah-license-server/src/main.ts:66-73`
- **Allowed origin**: `FRONTEND_URL` env var (defaults to `https://ptah.live`)
- **Credentials**: `true` (required for cookie auth)
- **Allowed methods**: GET, POST, PUT, PATCH, DELETE, OPTIONS
- **Allowed headers**: Content-Type, Authorization, X-Admin-API-Key

### 4.3 HTTP Security Headers (Helmet)

- **Config**: `apps/ptah-license-server/src/main.ts:39-43`
- **CSP**: Disabled (API server, not serving HTML)
- **COEP**: Disabled (allows API consumption from any origin)
- **Default Helmet**: HSTS, X-Frame-Options, X-Content-Type-Options, etc.

### 4.4 Input Validation

- **NestJS ValidationPipe**: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- Strips unknown properties, rejects non-whitelisted fields

### 4.5 HTTPS/TLS

- **Landing page**: DO App Platform manages SSL (Let's Encrypt via Cloudflare)
- **API server**: Caddy auto-HTTPS (Let's Encrypt, ACME HTTP-01 challenge)
- **Caddy config**: TLS 1.2+ with modern cipher suite (Caddy defaults)

### 4.6 Webhook Security

- **Paddle webhooks**: Raw body stored for HMAC SHA256 signature verification
- **Webhook endpoint**: `/webhooks/paddle` (excluded from `/api` global prefix)
- **Webhook secret**: `PADDLE_WEBHOOK_SECRET` env var

### 4.7 License Signing

- **Method**: Ed25519 response signing to prevent MITM attacks
- **Private key**: `LICENSE_SIGNING_PRIVATE_KEY` env var (base64-encoded DER PKCS8)
- **Public key**: Embedded in VS Code extension (`libs/shared/src/lib/constants/environment.constants.ts`)

### 4.8 Cookie Cross-Origin Configuration

- **Auth cookie**: `sameSite: 'lax'`, `withCredentials: true` on frontend
- **IMPORTANT**: Frontend (`ptah.live`) and API (`api.ptah.live`) are different subdomains
- **Cookie domain**: Not explicitly set in auth controller — defaults to `api.ptah.live`
- **AUDIT ITEM**: Verify that cookies set by `api.ptah.live` are sent back to `api.ptah.live` with `withCredentials: true` (they should be, since the interceptor adds this)

---

## 5. Environment Configuration

### Production Environment Files

| File                            | Purpose                               | Gitignored?    |
| ------------------------------- | ------------------------------------- | -------------- |
| `.env.prod`                     | Production secrets for docker-compose | Yes            |
| `.env.prod.example`             | Template with placeholder values      | No (committed) |
| `apps/ptah-license-server/.env` | Local dev DB connection               | Yes            |
| `.env`                          | Root env vars                         | Yes            |

### Frontend Environment Files (Compiled Into Bundle)

| File                                     | apiBaseUrl                  | Paddle Env   |
| ---------------------------------------- | --------------------------- | ------------ |
| `environments/environment.ts` (dev)      | `''` (empty, proxy handles) | `sandbox`    |
| `environments/environment.production.ts` | `https://api.ptah.live`     | `production` |

### Key Production Env Vars (from .env.prod.example)

- `FRONTEND_URL=https://ptah.live` — CORS origin
- `WORKOS_REDIRECT_URI=https://api.ptah.live/api/auth/callback` — OAuth callback
- `WORKOS_LOGOUT_REDIRECT_URI=https://ptah.live` — Post-logout redirect

---

## 6. Deployment Topology

### Landing Page (DO App Platform)

```yaml
# .do/app.yaml
name: starfish-app
region: fra
domains:
  - domain: ptah.live
    type: PRIMARY # Auto-redirects starfish-app-dx44f.ondigitalocean.app → ptah.live
static_sites:
  - name: landing
    github:
      repo: Hive-Academy/ptah-extension
      branch: main
      deploy_on_push: false
    build_command: bash scripts/do-build.sh
    output_dir: dist/ptah-landing-page/browser
    environment_slug: node-js
    catchall_document: index.html # SPA routing — all Angular routes serve index.html
```

### API Server (Droplet + Docker)

```yaml
# docker-compose.prod.yml (on Droplet)
services:
  postgres: # PostgreSQL 16 (256MB limit)
  license-server: # NestJS app (512MB limit), auto-migrates on start
  caddy: # Reverse proxy, auto-HTTPS for api.ptah.live
```

### Caddy Reverse Proxy

```caddyfile
# caddy/Caddyfile
api.ptah.live {
    request_body { max_size 10MB }
    reverse_proxy license-server:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
    encode gzip
}
```

---

## 7. Angular Routes (Landing Page)

| Route                   | Component               | Guards                       | Notes                                 |
| ----------------------- | ----------------------- | ---------------------------- | ------------------------------------- |
| `/`                     | LandingPageComponent    | None                         | Home page                             |
| `/docs`                 | DocsPageComponent       | None                         | Documentation                         |
| `/pricing`              | PricingPageComponent    | TrialStatusGuard             | Redirects expired trials              |
| `/login`                | AuthPageComponent       | GuestGuard                   | Redirects logged-in users to /profile |
| `/signup`               | AuthPageComponent       | GuestGuard                   | Same as login, different mode         |
| `/profile`              | ProfilePageComponent    | AuthGuard + TrialStatusGuard | User dashboard                        |
| `/contact`              | Redirect → /profile     | —                            | Legacy redirect                       |
| `/sessions`             | Redirect → /profile     | —                            | Legacy redirect                       |
| `/terms-and-conditions` | TermsPageComponent      | None                         | Legal                                 |
| `/privacy`              | PrivacyPageComponent    | None                         | Legal                                 |
| `/refund`               | RefundPageComponent     | None                         | Legal                                 |
| `/trial-ended`          | TrialEndedPageComponent | AuthGuard                    | No trial check                        |
| `/**`                   | Redirect → `/`          | —                            | 404 catch-all                         |

---

## 8. Recommended Audit Checklist

### Security

- [ ] **Cookie domain scope**: Verify `ptah_auth` cookie set by `api.ptah.live` works correctly with `withCredentials: true` from `ptah.live`
- [ ] **CORS configuration**: Confirm `FRONTEND_URL=https://ptah.live` is set in production `.env.prod`
- [ ] **JWT secret strength**: Verify production `JWT_SECRET` is a proper 256-bit random hex
- [ ] **Admin API key**: Verify `ADMIN_API_KEY` and `ADMIN_SECRET` are set to strong values
- [ ] **Paddle webhook secret**: Verify `PADDLE_WEBHOOK_SECRET` is configured
- [ ] **License signing key**: Verify Ed25519 key pair is generated and configured
- [ ] **Rate limiting**: Check if rate limiting is configured on API endpoints (auth especially)
- [ ] **Caddy security headers**: Review if additional headers needed (CSP not applicable for API)
- [ ] **OAuth redirect validation**: Confirm `returnUrl` validation in auth controller prevents open redirect
- [ ] **Magic link TTL**: Verify `MAGIC_LINK_TTL_MS=300000` (5 min) is appropriate
- [ ] **WorkOS redirect URI**: Confirm `WORKOS_REDIRECT_URI` matches exactly what's configured in WorkOS dashboard
- [ ] **Paddle price IDs**: Verify production price IDs in `environment.production.ts` match Paddle dashboard

### Configuration

- [ ] **DO App Platform**: Update app spec with `doctl apps update 7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3 --spec .do/app.yaml`
- [ ] **Build verification**: Trigger fresh build on DO App Platform after pushing fixes
- [ ] **SSE connection**: Test real-time events work cross-origin after fix
- [ ] **OAuth flow end-to-end**: Test GitHub and Google login on `ptah.live`
- [ ] **SPA routing**: Test direct navigation to `/pricing`, `/login`, `/profile` on `ptah.live`
- [ ] **Paddle checkout**: Test subscription flow end-to-end
- [ ] **Email delivery**: Verify magic link and verification emails send correctly via Resend

### Production Readiness

- [ ] **Error monitoring**: Is Sentry or equivalent configured?
- [ ] **Health check endpoint**: Verify `/api/health` returns 200
- [ ] **Database backups**: Is PostgreSQL backup strategy in place?
- [ ] **Log rotation**: Docker json-file driver with max-size 10m, max-file 3 configured
- [ ] **Resource limits**: Verify Droplet can handle expected traffic (512MB for NestJS, 256MB for PostgreSQL)
- [ ] **DNS TTL**: Review TTL values for A records (currently managed by DO)
- [ ] **Secrets rotation plan**: Document how to rotate JWT_SECRET, ADMIN_API_KEY, etc.

---

## 9. Files to Focus On During Audit

### Critical Security Files

```
apps/ptah-license-server/src/main.ts                           # CORS, helmet, validation
apps/ptah-license-server/src/app/auth/auth.controller.ts       # All auth flows, cookie config
apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts # JWT extraction & validation
apps/ptah-license-server/src/app/auth/services/token/          # Magic link, ticket services
apps/ptah-license-server/src/paddle/paddle.service.ts          # Webhook verification
caddy/Caddyfile                                                # TLS, proxy headers
docker-compose.prod.yml                                        # Container security
.env.prod.example                                              # Secret requirements
```

### Critical Configuration Files

```
.do/app.yaml                                                   # DO App Platform spec
apps/ptah-landing-page/src/environments/environment.production.ts  # Frontend prod config
apps/ptah-landing-page/src/app/interceptors/api.interceptor.ts     # API URL rewriting
apps/ptah-landing-page/src/app/pages/auth/services/auth-api.service.ts  # OAuth redirects
apps/ptah-landing-page/src/app/services/sse-events.service.ts      # SSE connection
apps/ptah-landing-page/proxy.conf.json                             # Dev-only proxy (NOT production)
```

---

## 10. Quick Commands

```bash
# Build landing page locally
nx build ptah-landing-page --configuration=production --skip-nx-cache

# Update DO App Platform spec
doctl apps update 7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3 --spec .do/app.yaml

# Deploy landing page (trigger build on DO)
doctl apps create-deployment 7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3

# SSH to Droplet
ssh root@167.71.9.106

# On Droplet: rebuild & restart license server
cd /opt/ptah && docker compose -f docker-compose.prod.yml up -d --build

# On Droplet: check logs
docker logs ptah_license_server_prod --tail 100 -f
docker logs ptah_caddy --tail 50 -f

# Run license server locally
npm run docker:db:start && nx serve ptah-license-server
```
