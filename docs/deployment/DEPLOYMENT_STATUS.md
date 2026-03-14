# Ptah Deployment Status

> Last updated: 2026-03-12
> Session: Infrastructure setup for ptah-license-server + ptah-landing-page

---

## Architecture Overview

```
                    ┌─────────────────────────┐
                    │      GoDaddy            │
                    │  Domain: ptah.live       │
                    │  NS → DigitalOcean       │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   DigitalOcean DNS       │
                    │   (Single source of      │
                    │    truth for all DNS)     │
                    └──────┬──────────┬───────┘
                           │          │
              ┌────────────▼──┐  ┌────▼──────────────┐
              │  api.ptah.live │  │   ptah.live        │
              │  A → Droplet   │  │   A → Droplet      │
              │  167.71.9.106  │  │   (temporary, will  │
              └───────┬────────┘  │   switch to App     │
                      │           │   Platform CNAME)   │
              ┌───────▼────────┐  └────┬───────────────┘
              │   Droplet      │       │
              │ ptah-api-prod  │  ┌────▼───────────────┐
              │ Ubuntu 24.04   │  │  DO App Platform    │
              │ 1GB/25GB AMS3  │  │  starfish-app       │
              │ Docker Compose:│  │  Static Site (FREE) │
              │  - Caddy       │  │  ptah-landing-page  │
              │  - NestJS API  │  └────────────────────┘
              │  - PostgreSQL  │
              └────────────────┘
```

---

## Completed Items

### 1. DigitalOcean Droplet ✅

- **Name**: `ptah-api-prod`
- **IP**: `167.71.9.106`
- **Region**: AMS3 (Amsterdam)
- **Spec**: 1GB RAM / 25GB Disk / Ubuntu 24.04 LTS x64
- **Cost**: ~$6/month
- **SSH Key**: `id_ed25519` (added during Droplet creation)
- **Created**: 2026-03-06

### 2. DigitalOcean App Platform (Static Site) ✅

- **App Name**: `starfish-app`
- **App ID**: `7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3`
- **Region**: FRA1 (Frankfurt)
- **Type**: Static Site (FREE tier)
- **Source**: GitHub `Hive-Academy/ptah-extension`, branch `main`
- **Component**: `landing` (Static Site)
- **Status**: First deploy failed (expected — needs proper build config)
- **Cost**: $0/month

### 3. GitHub Actions Secrets ✅

All 6 secrets configured at: `github.com/Hive-Academy/ptah-extension/settings/secrets/actions`

| Secret                      | Purpose                        | Value                                       |
| --------------------------- | ------------------------------ | ------------------------------------------- |
| `DIGITALOCEAN_ACCESS_TOKEN` | DO API access for `doctl`      | DO API token (90-day, custom scopes)        |
| `DO_APP_ID`                 | App Platform deployment target | `7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3`      |
| `DROPLET_HOST`              | SSH target for server deploy   | `167.71.9.106`                              |
| `DROPLET_USER`              | SSH user                       | `root`                                      |
| `DROPLET_SSH_KEY`           | SSH private key for CI/CD      | `id_ed25519` private key                    |
| `GHCR_PAT`                  | Push Docker images to GHCR     | GitHub PAT (90-day, `write:packages` scope) |

### 4. DNS Configuration ✅

**GoDaddy** (registrar only — no DNS management):

- Nameservers delegated to DigitalOcean:
  - `ns1.digitalocean.com`
  - `ns2.digitalocean.com`
  - `ns3.digitalocean.com`
- DNS Records tab shows: "can't display — nameservers aren't managed by us"
- **No duplicate records** — GoDaddy old records are inactive

**DigitalOcean** (sole DNS manager):

| Type | Hostname        | Value                  | TTL  |
| ---- | --------------- | ---------------------- | ---- |
| A    | `ptah.live`     | `167.71.9.106`         | 3600 |
| A    | `api.ptah.live` | `167.71.9.106`         | 3600 |
| NS   | `ptah.live`     | `ns1.digitalocean.com` | 1800 |
| NS   | `ptah.live`     | `ns2.digitalocean.com` | 1800 |
| NS   | `ptah.live`     | `ns3.digitalocean.com` | 1800 |

**DNS Propagation**: Nameserver change initiated 2026-03-12, may take 1-48 hours to fully propagate.

### 5. CI/CD Workflows ✅ (files exist, not yet tested)

- `.github/workflows/ci.yml` — Runs on push to main + all PRs (lint, test, typecheck, build)
- `.github/workflows/deploy-landing.yml` — Triggers on push to `release/landing`, deploys to App Platform via `doctl`
- `.github/workflows/deploy-server.yml` — Triggers on push to `release/server`, builds Docker → GHCR → SSH deploy to Droplet

### 6. Production Docker Compose ✅ (file exists, not yet deployed)

- `docker-compose.prod.yml` — Postgres 16 + NestJS license-server + Caddy (auto-HTTPS)

### 7. Production Environment Keys ✅

- Paddle production keys configured in `environment.production.ts`
- WorkOS production keys configured in license server `.env`

---

## Remaining Tasks

### Phase 2: Configure the Droplet ✅

SSH into `167.71.9.106` (completed 2026-03-12):

1. **Install Docker & Docker Compose**

   ```bash
   ssh root@167.71.9.106
   apt update && apt upgrade -y
   curl -fsSL https://get.docker.com | sh
   ```

2. **Configure Swap** (required for 1GB Droplet)

   ```bash
   fallocate -l 1G /swapfile
   chmod 600 /swapfile
   mkswap /swapfile
   swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```

3. **Firewall (UFW)**

   ```bash
   ufw allow 22/tcp    # SSH
   ufw allow 80/tcp    # HTTP (Caddy redirect)
   ufw allow 443/tcp   # HTTPS (Caddy)
   ufw enable
   ```

4. **Fail2ban** (SSH brute-force protection)

   ```bash
   apt install fail2ban -y
   systemctl enable fail2ban
   ```

5. **Create Deployment Directory & Files**

   ```bash
   mkdir -p /opt/ptah-extension/caddy
   # Copy docker-compose.prod.yml, caddy/Caddyfile, and .env.prod via SCP
   scp -i ~/.ssh/id_ed25519_ptah docker-compose.prod.yml root@167.71.9.106:/opt/ptah-extension/
   scp -i ~/.ssh/id_ed25519_ptah caddy/Caddyfile root@167.71.9.106:/opt/ptah-extension/caddy/
   scp -i ~/.ssh/id_ed25519_ptah .env.prod root@167.71.9.106:/opt/ptah-extension/
   ln -sf .env.prod .env  # docker-compose needs .env for variable interpolation
   ```

6. **Create Production .env**

   ```bash
   # /opt/ptah/.env.prod
   DATABASE_URL=postgresql://ptah:SECURE_PASSWORD@postgres:5432/ptah_db
   PADDLE_API_KEY=<from paddle dashboard>
   WORKOS_API_KEY=<from workos dashboard>
   WORKOS_CLIENT_ID=<from workos dashboard>
   NODE_ENV=production
   ```

7. **Start Services**
   ```bash
   cd /opt/ptah-extension
   docker compose -f docker-compose.prod.yml up -d
   ```

### Phase 2b: SSH Key Setup ✅

- Generated new passwordless SSH key: `~/.ssh/id_ed25519_ptah`
- Added to Droplet `~/.ssh/authorized_keys`
- Updated `DROPLET_SSH_KEY` GitHub secret with new key
- SSH config alias: `ssh ptah-api` connects to Droplet
- Old `id_ed25519` key has passphrase — use `id_ed25519_ptah` instead

### Phase 3: Update App Platform Build Config

- Update `starfish-app` source settings:
  - **Source Directory**: `apps/ptah-landing-page`
  - **Build Command**: `npx nx build ptah-landing-page --configuration=production`
  - **Output Directory**: `dist/ptah-landing-page/browser`
- Or update branch to `release/landing` once it exists

### Phase 4: First Deployments

1. Create and push `release/server` branch → triggers server CI/CD
2. Create and push `release/landing` branch → triggers landing page CI/CD
3. Verify both deployments succeed

### Phase 5: Custom Domain for Landing Page

After App Platform deploys successfully:

1. Add custom domain `ptah.live` in App Platform Networking tab
2. Update DO DNS: change `ptah.live` A record to CNAME pointing to App Platform URL
3. App Platform will auto-provision SSL via Let's Encrypt

### Phase 6: Verification & Monitoring

- Test `https://api.ptah.live` responds (Caddy auto-HTTPS)
- Test `https://ptah.live` loads landing page
- Verify Paddle webhooks reach `api.ptah.live`
- Update Paddle webhook URL if needed
- Set up DigitalOcean monitoring alerts (CPU, memory, disk)

---

## Token/Key Expiration Tracking

| Token        | Expires                     | Action Required                                                    |
| ------------ | --------------------------- | ------------------------------------------------------------------ |
| DO API Token | Custom (check DO dashboard) | Rotate before expiry, update `DIGITALOCEAN_ACCESS_TOKEN` secret    |
| GHCR PAT     | ~Jun 10, 2026               | Regenerate at github.com/settings/tokens, update `GHCR_PAT` secret |
| Paddle keys  | No expiry                   | N/A                                                                |
| WorkOS keys  | No expiry                   | N/A                                                                |

---

## Quick Reference URLs

- **GitHub Repo**: https://github.com/Hive-Academy/ptah-extension
- **GitHub Secrets**: https://github.com/Hive-Academy/ptah-extension/settings/secrets/actions
- **DO Droplet**: https://cloud.digitalocean.com/droplets (ptah-api-prod)
- **DO App Platform**: https://cloud.digitalocean.com/apps/7f4271fb-ff47-4cb7-bb97-8a2aed6eefe3
- **DO DNS**: https://cloud.digitalocean.com/networking/domains/ptah.live
- **DO API Tokens**: https://cloud.digitalocean.com/account/api/tokens
- **GoDaddy Domain**: https://dcc.godaddy.com/control/portfolio/ptah.live/settings
- **Paddle Dashboard**: https://vendors.paddle.com
- **WorkOS Dashboard**: https://dashboard.workos.com
