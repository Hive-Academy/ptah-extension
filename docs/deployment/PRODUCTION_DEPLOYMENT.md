# Ptah Production Deployment Guide

Complete checklist for deploying Ptah to production across all layers.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  ptah.live (DigitalOcean App Platform - free static)    │
│  Angular landing page + marketing site                  │
└──────────────────────┬──────────────────────────────────┘
                       │ API calls
┌──────────────────────▼──────────────────────────────────┐
│  api.ptah.live (DigitalOcean Droplet - $6/mo)           │
│  NestJS license server + Paddle webhooks                │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  Self-hosted PostgreSQL 16 (Docker on Droplet)          │
│  Container: ptah_postgres_prod                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  VS Code Marketplace                                    │
│  Ptah Extension (.vsix) — URLs baked in at build time   │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Generate Secrets

Run these **once** before first deployment. Store the output securely (password manager, DO encrypted env vars).

```bash
# JWT signing secret (license server auth tokens)
openssl rand -hex 32

# Admin API key (protects /api/v1/admin/* endpoints)
openssl rand -hex 32

# Admin secret (protects trial reminder cron trigger)
openssl rand -hex 32
```

---

## 2. Third-Party Service Setup

### 2.1 WorkOS (Authentication)

Dashboard: <https://dashboard.workos.com/>

| Step | Action                                                      |
| ---- | ----------------------------------------------------------- |
| 1    | Create a **Production** environment                         |
| 2    | Copy **API Key** (`sk_live_...`)                            |
| 3    | Copy **Client ID** (`client_...`)                           |
| 4    | Add redirect URI: `https://api.ptah.live/api/auth/callback` |
| 5    | Enable OAuth providers (GitHub, Google)                     |
| 6    | (Optional) Verify `ptah.live` domain for SSO                |

### 2.2 Paddle (Payments)

Dashboard: <https://vendors.paddle.com/>

**Create Product & Prices:**

| Step | Action                                                                  |
| ---- | ----------------------------------------------------------------------- |
| 1    | Create product: **Ptah Pro**                                            |
| 2    | Create price: **Pro Monthly** — $5/month, 14-day trial → copy `pri_...` |
| 3    | Create price: **Pro Yearly** — $50/year, 14-day trial → copy `pri_...`  |
| 4    | Copy **API Key** (`pdl_live_...`) from Developer Tools > Authentication |
| 5    | Copy **Client-Side Token** (`live_...`) from same page                  |

**Configure Webhook:**

| Setting      | Value                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint URL | `https://api.ptah.live/webhooks/paddle`                                                                                                                                   |
| Events       | `subscription.created`, `subscription.activated`, `subscription.updated`, `subscription.canceled`, `subscription.past_due`, `subscription.paused`, `subscription.resumed` |

After creating, copy the **Webhook Secret** (`pdl_ntfset_...`).

> **Note:** The webhook path is `/webhooks/paddle`, NOT `/api/webhooks/paddle`. Webhook routes are excluded from the global `/api` prefix.

### 2.3 Resend (Email)

Dashboard: <https://resend.com/>

| Step | Action                                      |
| ---- | ------------------------------------------- |
| 1    | Verify domain `ptah.live` (add DNS records) |
| 2    | Create API Key → copy `re_...`              |
| 3    | Free tier: 3,000 emails/month               |

### 2.4 PostgreSQL (Self-Hosted)

PostgreSQL runs as a Docker container on the same droplet. No external database service required.

| Setting   | Value                                    |
| --------- | ---------------------------------------- |
| Container | `ptah_postgres_prod`                     |
| Image     | `postgres:16-alpine`                     |
| Database  | `ptah_db`                                |
| User      | `ptah`                                   |
| Port      | 5432 (internal, not exposed to internet) |

Configuration is managed via `.env.prod`. See [DIGITALOCEAN.md](./DIGITALOCEAN.md) for setup.

---

## 3. License Server Environment Variables

Set these on the Droplet (in `.env` or `docker-compose.prod.yml`).

### Required

```bash
# ── Core ──
NODE_ENV=production
PORT=3000

# ── Database ──
# DATABASE_URL is constructed automatically by docker-compose.prod.yml
# from POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB variables.
# Do NOT set DATABASE_URL manually in .env.prod.

# ── Authentication (JWT) ──
JWT_SECRET=<generated-hex-64-chars>
JWT_EXPIRATION=7d

# ── Admin Security ──
ADMIN_API_KEY=<generated-hex-64-chars>
ADMIN_SECRET=<generated-hex-64-chars>

# ── WorkOS (OAuth / SSO) ──
WORKOS_API_KEY=sk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
WORKOS_CLIENT_ID=client_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
WORKOS_REDIRECT_URI=https://api.ptah.live/api/auth/callback

# ── Paddle (Payments) ──
PADDLE_API_KEY=pdl_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_WEBHOOK_SECRET=pdl_ntfset_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO_MONTHLY=pri_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO_YEARLY=pri_XXXXXXXXXXXXXXXXXXXXXXXX

# ── Resend (Email) ──
RESEND_API_KEY=re_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Optional (have sensible defaults)

```bash
# Frontend URL for CORS, redirects, and email links
# Default: https://ptah.live (set by centralized constants)
# Only override if your frontend lives at a different domain.
FRONTEND_URL=https://ptah.live

# Sender email (requires verified domain in Resend)
# Default: help@ptah.live
FROM_EMAIL=help@ptah.live

# Sender display name
# Default: Ptah Team
FROM_NAME=Ptah Team

# Post-logout redirect
WORKOS_LOGOUT_REDIRECT_URI=https://ptah.live

# Magic link expiration (ms). Default: 120000 (2 minutes)
# Production recommendation: 300000 (5 minutes) for slower email delivery
MAGIC_LINK_TTL_MS=300000

# Trial duration in days. Default: 14
# Only set to override for testing. Leave unset for standard 14-day trial.
# TRIAL_DURATION_DAYS=14
```

---

## 4. Landing Page Build Configuration

These values are **baked into the Angular build** at compile time. Edit `apps/ptah-landing-page/src/environments/environment.production.ts` before building.

| Setting                    | Status   | Value                                                                           |
| -------------------------- | -------- | ------------------------------------------------------------------------------- |
| `apiBaseUrl`               | **Done** | `https://api.ptah.live`                                                         |
| `paddle.environment`       | **Done** | `production`                                                                    |
| `paddle.token`             | **TODO** | Replace `live_REPLACE_WITH_PRODUCTION_TOKEN` with real Paddle client-side token |
| `paddle.proPriceIdMonthly` | **TODO** | Replace `pri_REPLACE_PRO_MONTHLY` with real Paddle price ID                     |
| `paddle.proPriceIdYearly`  | **TODO** | Replace `pri_REPLACE_PRO_YEARLY` with real Paddle price ID                      |

Build command:

```bash
npx nx build ptah-landing-page --configuration=production
```

Output: `dist/ptah-landing-page/browser/` (deploy to App Platform)

---

## 5. VS Code Extension

The extension uses centralized `PtahUrls` constants from `libs/shared`. All production URLs are already set:

| Constant                | Value                       |
| ----------------------- | --------------------------- |
| `PtahUrls.API_URL`      | `https://api.ptah.live`     |
| `PtahUrls.FRONTEND_URL` | `https://ptah.live`         |
| `PtahUrls.PRICING_URL`  | `https://ptah.live/pricing` |
| `PtahUrls.SIGNUP_URL`   | `https://ptah.live/signup`  |

**No runtime environment variables needed.** URLs are compiled into the extension bundle.

### Build and Package

```bash
# Full pipeline (build + package in one command)
npx nx run ptah-extension-vscode:package

# Output: dist/apps/ptah-extension-vscode/ptah-extension-vscode-<version>.vsix
```

The `package` target handles the complete pipeline:

1. Builds all library dependencies (shared, vscode-core, agent-sdk, etc.)
2. Builds the Angular webview (production)
3. Bundles extension host code with Webpack (main.js + SDK vendor chunks)
4. Copies `.vscodeignore`, `README.md`, LICENSE, assets, plugins, and templates to dist
5. Installs runtime `node_modules` in dist (externalized deps: tslib, tree-sitter, etc.)
6. Runs `@vscode/vsce package` to produce the `.vsix`

### Runtime Dependencies (Externalized by Webpack)

The Webpack config bundles `@ptah-extension/*`, `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`, `tsyringe`, and `reflect-metadata` directly into the JS output. All other packages are externalized to `require()` at runtime and must be listed in the extension's `package.json` `dependencies`:

| Package                                                             | Purpose                                             |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `tslib`                                                             | TypeScript helper library (required by compiled TS) |
| `async-mutex`                                                       | Concurrency control                                 |
| `cross-spawn`                                                       | Cross-platform process spawning                     |
| `eventemitter3`                                                     | Event bus                                           |
| `gray-matter`                                                       | Frontmatter parsing for templates                   |
| `json2md`                                                           | JSON to Markdown conversion                         |
| `jsonrepair`                                                        | JSON repair for LLM outputs                         |
| `minimatch` / `picomatch`                                           | Glob pattern matching                               |
| `tree-sitter` / `tree-sitter-javascript` / `tree-sitter-typescript` | Code parsing (workspace intelligence)               |
| `which`                                                             | CLI tool detection                                  |
| `rxjs`                                                              | Reactive streams                                    |
| `uuid`                                                              | ID generation                                       |
| `zod`                                                               | Schema validation                                   |

> **Important**: `@openai/codex-sdk` is **not** included as a dependency (102 MB). It is loaded dynamically at runtime only when the user has Codex CLI installed. The adapter handles the missing module gracefully.

### Staging / Pre-release Testing

Before publishing to the marketplace, test with a `.vsix` on a separate machine:

```bash
# On the build machine
npx nx run ptah-extension-vscode:package
# Copy the .vsix to the test machine

# On the test machine
code --install-extension ptah-extension-vscode-0.1.0.vsix
```

See [INSTALLATION.md](../INSTALLATION.md) for detailed installation instructions.

### VSIX Size Budget

| Component                                  | Compressed Size |
| ------------------------------------------ | --------------- |
| Extension bundle (main.js + vendor chunks) | ~1.5 MB         |
| Webview (Angular SPA)                      | ~1 MB           |
| Assets + plugins + templates               | ~1.5 MB         |
| Runtime node_modules                       | ~4.5 MB         |
| **Total .vsix**                            | **~8.5 MB**     |

> Target: under 10 MB. Extensions over 20 MB may face marketplace scrutiny.

---

## 6. DNS Configuration

| Record          | Type       | Value                                          |
| --------------- | ---------- | ---------------------------------------------- |
| `ptah.live`     | CNAME or A | DigitalOcean App Platform (set via DO console) |
| `www.ptah.live` | CNAME      | `ptah.live`                                    |
| `api.ptah.live` | A          | Droplet IP address                             |

SSL: App Platform handles TLS for `ptah.live` automatically. For `api.ptah.live`, use Caddy (auto Let's Encrypt) or certbot on the Droplet.

---

## 7. Deployment Commands

### Landing Page (App Platform)

Deploys via GitHub Actions on push to `release/landing`. The workflow runs quality gates (lint, test, typecheck, build) then triggers App Platform deployment via `doctl`.

```bash
# First-time setup
doctl apps create --spec .do/app.yaml
# Note the APP_ID and add it as DO_APP_ID in GitHub Actions secrets

# Manual deploy (bypasses quality gates)
doctl apps create-deployment <APP_ID>
```

**Required GitHub Actions Secrets:**

| Secret                      | Source                                         |
| --------------------------- | ---------------------------------------------- |
| `DIGITALOCEAN_ACCESS_TOKEN` | DO Console > API > Tokens > Generate New Token |
| `DO_APP_ID`                 | `doctl apps list` after initial app creation   |

### License Server (Droplet)

```bash
# SSH into droplet
ssh root@<DROPLET_IP>

# Pull latest and restart
cd /opt/ptah
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build

# Run migrations
docker compose -f docker-compose.prod.yml exec license-server npx prisma migrate deploy
```

### VS Code Extension (Marketplace)

```bash
# Build and package (Nx pipeline)
npx nx run ptah-extension-vscode:package

# The .vsix is at: dist/apps/ptah-extension-vscode/ptah-extension-vscode-<version>.vsix

# Install locally for testing
code --install-extension dist/apps/ptah-extension-vscode/ptah-extension-vscode-0.1.0.vsix

# Publish to marketplace (requires Azure DevOps PAT)
cd dist/apps/ptah-extension-vscode
npx @vscode/vsce publish --pat <TOKEN>

# Publish as pre-release (use odd minor version: 0.1.0, 0.3.0)
npx @vscode/vsce publish --pre-release --pat <TOKEN>
```

> **Prerequisites**: `npm install --save-dev @vscode/vsce` (already in devDependencies). Requires Node.js 20+.

---

## 8. Post-Deployment Verification

| Check                   | Command / Action                                         |
| ----------------------- | -------------------------------------------------------- |
| Landing page loads      | Visit `https://ptah.live`                                |
| API health              | `curl https://api.ptah.live/api/health`                  |
| Auth flow               | Click "Login" on landing page, complete OAuth            |
| Paddle checkout         | Click "Upgrade to Pro" on pricing page                   |
| Webhook delivery        | Check Paddle dashboard > Webhooks > Logs                 |
| Email delivery          | Trigger magic link login, verify email arrives           |
| Extension license check | Install extension, verify it connects to `api.ptah.live` |
| Logging level           | Verify no debug/verbose output in production logs        |

---

## 9. Environment Defaults Reference

Centralized in `libs/shared/src/lib/constants/environment.constants.ts`:

```
Production:  LOG_LEVEL = 'info',  LOG_TO_CONSOLE = false
Development: LOG_LEVEL = 'debug', LOG_TO_CONSOLE = true
```

The VS Code extension Logger respects `PTAH_LOG_LEVEL` env var for ad-hoc override.
The license server suppresses `debug` and `verbose` NestJS logs when `NODE_ENV=production`.

---

## 10. Secret Rotation Strategy

All secrets in `.env.prod` should be rotated on a regular schedule. Mark your calendar.

| Secret              | Rotation Schedule | How to Rotate                                                                            |
| ------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `JWT_SECRET`        | Every 6 months    | Generate new value, restart server. Active JWTs expire.                                  |
| `ADMIN_API_KEY`     | Quarterly         | Generate new value, update any scripts using it.                                         |
| `ADMIN_SECRET`      | Quarterly         | Generate new value, restart server.                                                      |
| `POSTGRES_PASSWORD` | Annually          | ALTER ROLE in psql first, then update .env.prod, restart license-server only. See below. |
| `WORKOS_API_KEY`    | Per WorkOS policy | Regenerate in WorkOS dashboard, update .env.prod.                                        |
| `PADDLE_API_KEY`    | Per Paddle policy | Regenerate in Paddle dashboard, update .env.prod.                                        |
| `RESEND_API_KEY`    | Per Resend policy | Regenerate in Resend dashboard, update .env.prod.                                        |

### GitHub Actions Secrets

These secrets live in **GitHub Settings > Secrets and variables > Actions**, not in `.env.prod`:

| Secret     | Rotation Schedule | How to Rotate                                                                                        |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `VSCE_PAT` | Before expiry     | Azure DevOps PATs expire after max 1 year. Regenerate in Azure DevOps and update in GitHub Settings. |

### Rotation Procedure

```bash
# 1. Generate new secret value
openssl rand -hex 32

# 2. Edit .env.prod on the droplet
nano /opt/ptah-extension/.env.prod

# 3. Restart affected services
docker compose -f docker-compose.prod.yml restart license-server

# 4. Verify service is healthy
curl https://api.ptah.live/api/health
```

### PostgreSQL Password Rotation

> **Important:** The `POSTGRES_PASSWORD` environment variable is only used by PostgreSQL during **initial database creation** (`initdb`). Changing the env var alone does **not** change the database password. You must ALTER the role inside PostgreSQL first.

```bash
# 1. Connect to PostgreSQL container and change the password
docker exec -it ptah_postgres_prod psql -U ptah -d ptah_db
ALTER ROLE ptah WITH PASSWORD 'new-password-here';
\q

# 2. Update POSTGRES_PASSWORD in .env.prod to match the new password
nano /opt/ptah-extension/.env.prod

# 3. Restart ONLY license-server (not postgres — its password is already changed in the DB)
docker compose -f docker-compose.prod.yml restart license-server

# 4. Verify service is healthy
curl https://api.ptah.live/api/health
```

---

## 11. Cost Summary

| Service                                 | Cost              |
| --------------------------------------- | ----------------- |
| DigitalOcean Droplet (API + DB proxy)   | $6/month          |
| DigitalOcean App Platform (static site) | Free              |
| PostgreSQL (self-hosted on Droplet)     | $0 (included)     |
| WorkOS (Free tier, up to 1M users)      | Free              |
| Resend (3,000 emails/month)             | Free              |
| Paddle                                  | % per transaction |
| Domain (`ptah.live`)                    | ~$12/year         |
| **Total fixed cost**                    | **~$7/month**     |
