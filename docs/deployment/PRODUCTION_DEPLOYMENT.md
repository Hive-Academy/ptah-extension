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
│  Neon PostgreSQL (Azure East US 2)                      │
│  Production branch: br-royal-boat-a8l68lc1              │
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

Dashboard: https://dashboard.workos.com/

| Step | Action                                                      |
| ---- | ----------------------------------------------------------- |
| 1    | Create a **Production** environment                         |
| 2    | Copy **API Key** (`sk_live_...`)                            |
| 3    | Copy **Client ID** (`client_...`)                           |
| 4    | Add redirect URI: `https://api.ptah.live/api/auth/callback` |
| 5    | Enable OAuth providers (GitHub, Google)                     |
| 6    | (Optional) Verify `ptah.live` domain for SSO                |

### 2.2 Paddle (Payments)

Dashboard: https://vendors.paddle.com/

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

Dashboard: https://resend.com/

| Step | Action                                      |
| ---- | ------------------------------------------- |
| 1    | Verify domain `ptah.live` (add DNS records) |
| 2    | Create API Key → copy `re_...`              |
| 3    | Free tier: 3,000 emails/month               |

### 2.4 Neon (Database)

Dashboard: https://console.neon.tech/

The database is already provisioned:

| Setting           | Value                                                  |
| ----------------- | ------------------------------------------------------ |
| Project           | `ptah-extension` (`steep-wave-47825660`)               |
| Production branch | `br-royal-boat-a8l68lc1`                               |
| Endpoint          | `ep-misty-fog-a8sd45ut-pooler.eastus2.azure.neon.tech` |
| Database          | `neondb`                                               |
| Role              | `neondb_owner`                                         |

Connection string format:

```
postgresql://neondb_owner:<PASSWORD>@ep-misty-fog-a8sd45ut-pooler.eastus2.azure.neon.tech/neondb?sslmode=require
```

---

## 3. License Server Environment Variables

Set these on the Droplet (in `.env` or `docker-compose.prod.yml`).

### Required

```bash
# ── Core ──
NODE_ENV=production
PORT=3000

# ── Database ──
DATABASE_URL="postgresql://neondb_owner:<PASSWORD>@ep-misty-fog-a8sd45ut-pooler.eastus2.azure.neon.tech/neondb?sslmode=require"

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

Build and package:

```bash
npm run build:all
npx vsce package
```

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

Deploys automatically on push to `main` (configured in `.do/app.yaml`).

Manual deploy:

```bash
doctl apps create --spec .do/app.yaml          # First time
doctl apps update <APP_ID> --spec .do/app.yaml # Updates
```

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
npx vsce package                    # Creates .vsix
npx vsce publish                    # Publishes to marketplace
# OR
npx vsce publish --pat <TOKEN>      # With personal access token
```

---

## 8. Post-Deployment Verification

| Check                   | Command / Action                                         |
| ----------------------- | -------------------------------------------------------- |
| Landing page loads      | Visit `https://ptah.live`                                |
| API health              | `curl https://api.ptah.live/api`                         |
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

## 10. Cost Summary

| Service                                 | Cost              |
| --------------------------------------- | ----------------- |
| DigitalOcean Droplet (API + DB proxy)   | $6/month          |
| DigitalOcean App Platform (static site) | Free              |
| Neon PostgreSQL (Free tier)             | Free              |
| WorkOS (Free tier, up to 1M users)      | Free              |
| Resend (3,000 emails/month)             | Free              |
| Paddle                                  | % per transaction |
| Domain (`ptah.live`)                    | ~$12/year         |
| **Total fixed cost**                    | **~$7/month**     |
