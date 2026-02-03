# DigitalOcean Deployment Guide

This guide provides step-by-step instructions for deploying Ptah to DigitalOcean App Platform with a **budget-friendly configuration** (~$6/month).

## Table of Contents

- [Cost Overview](#cost-overview)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Step 1: Set Up Neon PostgreSQL (Free)](#step-1-set-up-neon-postgresql-free)
- [Step 2: Configure GoDaddy Domain](#step-2-configure-godaddy-domain)
- [Step 3: Deploy to App Platform](#step-3-deploy-to-app-platform)
- [Step 4: Configure Environment Variables](#step-4-configure-environment-variables)
- [Step 5: Set Up Custom Domain](#step-5-set-up-custom-domain)
- [Step 6: Configure External Services](#step-6-configure-external-services)
- [Monitoring & Troubleshooting](#monitoring--troubleshooting)
- [Scaling Guide](#scaling-guide)
- [Appendix: App Platform Specification](#appendix-app-platform-specification)

---

## Cost Overview

### Budget Configuration (~$6/month)

| Service                | Provider        | Tier        | Monthly Cost  |
| ---------------------- | --------------- | ----------- | ------------- |
| **PostgreSQL**         | Neon            | Free        | **$0**        |
| **Backend (NestJS)**   | DO App Platform | $5 (512MB)  | **$5**        |
| **Frontend (Angular)** | DO App Platform | Static Site | **$0**        |
| **Domain**             | GoDaddy         | ptah.live   | **~$1**       |
|                        |                 | **TOTAL**   | **~$6/month** |

### Why No Redis?

The license server uses **in-memory storage** for:

- PKCE state (OAuth flow) - 5 minute TTL
- Magic link tokens - 2 minute TTL
- SSE tickets - 30 second TTL

This works perfectly for **single-instance deployments**. Redis is only needed if you scale to multiple instances (horizontal scaling).

### When to Upgrade

| Trigger                 | Upgrade Path             | New Cost     |
| ----------------------- | ------------------------ | ------------ |
| Database > 400MB        | Neon Launch ($0.35/GB)   | ~$7-15/mo    |
| Memory issues           | App Platform 1GB         | $10/mo       |
| Need horizontal scaling | Add Redis (Upstash free) | +$0          |
| High traffic            | Multiple instances       | +$5/instance |

---

## Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │         GoDaddy (Domain)            │
                    │         ptah.live                   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │    DigitalOcean (Nameservers)       │
                    │    ns1/ns2/ns3.digitalocean.com     │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │  ptah.live      │  │  api.ptah.live  │  │  www.ptah.live  │
    │  (Static Site)  │  │  (Web Service)  │  │  (Redirect)     │
    │  Landing Page   │  │  License Server │  │                 │
    │  FREE           │  │  $5/month       │  │  FREE           │
    └─────────────────┘  └────────┬────────┘  └─────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     Neon PostgreSQL       │
                    │     (Free Tier)           │
                    │     0.5GB storage         │
                    │     100 compute hours/mo  │
                    └───────────────────────────┘

    External Services:
    ├── WorkOS (Authentication)
    ├── Paddle (Payments)
    └── SendGrid (Email)
```

---

## Prerequisites

Before deploying, ensure you have:

### 1. Accounts Required

| Service          | Purpose        | Sign Up                                          |
| ---------------- | -------------- | ------------------------------------------------ |
| **DigitalOcean** | Hosting        | https://cloud.digitalocean.com/registrations/new |
| **Neon**         | PostgreSQL     | https://neon.tech (free tier)                    |
| **GoDaddy**      | Domain         | https://www.godaddy.com                          |
| **WorkOS**       | Authentication | https://workos.com                               |
| **Paddle**       | Payments       | https://paddle.com                               |
| **SendGrid**     | Email          | https://sendgrid.com                             |

### 2. GitHub Repository

Your code must be in a GitHub repository that DigitalOcean can access.

### 3. Local Tools (Optional)

```bash
# DigitalOcean CLI
brew install doctl  # macOS
snap install doctl  # Linux

# Authenticate
doctl auth init
```

---

## Step 1: Set Up Neon PostgreSQL (Free)

### Create Neon Account & Project

1. Go to https://neon.tech and sign up (free)
2. Click **"New Project"**
3. Configure:
   - **Project name**: `ptah-production`
   - **Region**: Choose closest to your users (e.g., `us-east-1` for NYC)
   - **PostgreSQL version**: 16 (latest)
4. Click **"Create Project"**

### Get Connection String

1. In your Neon dashboard, go to **Connection Details**
2. Copy the **Connection string** (pooled):
   ```
   postgresql://neondb_owner:xxxx@ep-xxx-xxx-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

### Important: Neon Configuration

Neon provides two connection strings:

| Type                 | Use For             | String Contains       |
| -------------------- | ------------------- | --------------------- |
| **Pooled** (default) | Application runtime | `-pooler` in hostname |
| **Direct**           | Migrations          | No `-pooler`          |

For DigitalOcean App Platform, use the **pooled connection string** since migrations run at startup via the same connection.

### Neon Free Tier Limits

- **0.5 GB** storage per project
- **100 compute hours** per month
- Auto-suspend after **5 minutes** of inactivity (cold starts ~500ms)
- 10 branches per project

---

## Step 2: Configure GoDaddy Domain

### Option A: Delegate DNS to DigitalOcean (Recommended)

This is the **recommended approach** because:

- DigitalOcean handles CNAME flattening for root domain (ptah.live)
- Automatic SSL certificate provisioning
- Single dashboard for infrastructure + DNS

**Steps:**

1. **In GoDaddy:**

   - Go to **My Products** → Select `ptah.live`
   - Click **DNS** → **Nameservers** → **Change**
   - Select **"Enter my own nameservers"**
   - Add:
     ```
     ns1.digitalocean.com
     ns2.digitalocean.com
     ns3.digitalocean.com
     ```
   - Save and confirm

2. **Wait for propagation** (30 min to 72 hours)

   ```bash
   # Check propagation status
   dig NS ptah.live
   ```

3. **In DigitalOcean:**
   - Go to **Networking** → **Domains**
   - Click **Add Domain**
   - Enter: `ptah.live`
   - DigitalOcean will manage DNS records

### Option B: Keep DNS at GoDaddy

If you prefer to keep DNS at GoDaddy:

1. **Limitation**: GoDaddy doesn't support CNAME at root domain
2. You'll need to use `www.ptah.live` as primary and redirect root
3. Or use Cloudflare (free) as intermediary for CNAME flattening

---

## Step 3: Deploy to App Platform

### Method 1: Via Console (Recommended for First Deploy)

1. Go to https://cloud.digitalocean.com/apps
2. Click **"Create App"**
3. **Select Source**: GitHub
4. **Repository**: Select your `ptah-extension` repo
5. **Branch**: `main`

App Platform will auto-detect components. Configure:

#### Component 1: Landing Page (Static Site)

| Setting              | Value                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| **Name**             | `landing`                                                             |
| **Source Directory** | `/`                                                                   |
| **Build Command**    | `npm ci && npx nx build ptah-landing-page --configuration=production` |
| **Output Directory** | `dist/ptah-landing-page/browser`                                      |
| **HTTP Route**       | `/`                                                                   |

#### Component 2: License Server (Web Service)

| Setting              | Value                                 |
| -------------------- | ------------------------------------- |
| **Name**             | `api`                                 |
| **Source Directory** | `/`                                   |
| **Dockerfile Path**  | `apps/ptah-license-server/Dockerfile` |
| **HTTP Port**        | `3000`                                |
| **HTTP Route**       | `/api`                                |
| **Instance Size**    | Basic ($5/month, 512MB RAM)           |
| **Instance Count**   | `1`                                   |

### Method 2: Via CLI with App Spec

```bash
# Create app from spec file
doctl apps create --spec .do/app.yaml

# Get app ID
doctl apps list

# Update existing app
doctl apps update <APP_ID> --spec .do/app.yaml
```

---

## Step 4: Configure Environment Variables

In DigitalOcean App Platform console:

1. Go to your app → **Settings** → **App-Level Environment Variables**
2. Or go to **api** component → **Environment Variables**

### Required Variables

```yaml
# Database (Neon)
DATABASE_URL: 'postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require'

# Server
NODE_ENV: 'production'
PORT: '3000'
FRONTEND_URL: 'https://ptah.live'

# Security (generate with: openssl rand -hex 32)
JWT_SECRET: '<64-char-hex>' # ENCRYPT
ADMIN_API_KEY: '<64-char-hex>' # ENCRYPT

# WorkOS
WORKOS_API_KEY: 'sk_live_xxx' # ENCRYPT
WORKOS_CLIENT_ID: 'client_xxx' # ENCRYPT
WORKOS_REDIRECT_URI: 'https://api.ptah.live/api/auth/callback'

# Paddle
PADDLE_API_KEY: 'pdl_live_xxx' # ENCRYPT
PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_xxx' # ENCRYPT
PADDLE_PRICE_ID_PRO_MONTHLY: 'pri_xxx' # ENCRYPT
PADDLE_PRICE_ID_PRO_YEARLY: 'pri_xxx' # ENCRYPT

# SendGrid
SENDGRID_API_KEY: 'SG.xxx' # ENCRYPT
SENDGRID_FROM_EMAIL: 'ptah@nghive.tech'
SENDGRID_FROM_NAME: 'Ptah Team'

# Magic Link
MAGIC_LINK_TTL_MS: '300000' # 5 minutes
```

**Important**: Mark sensitive variables as **"Encrypt"** in the console.

---

## Step 5: Set Up Custom Domain

### Add Domains to App Platform

1. Go to your app → **Settings** → **Domains**
2. Click **"Add Domain"**

Add these domains:

| Domain          | Type                           | Component |
| --------------- | ------------------------------ | --------- |
| `ptah.live`     | Primary                        | landing   |
| `api.ptah.live` | Primary                        | api       |
| `www.ptah.live` | Alias (redirects to ptah.live) | landing   |

### DNS Records (If Using DigitalOcean DNS)

DigitalOcean will auto-configure records when you add domains. Verify:

```bash
dig ptah.live
dig api.ptah.live
```

### SSL Certificates

App Platform automatically provisions SSL certificates via Let's Encrypt. This happens within a few minutes of adding the domain.

---

## Step 6: Configure External Services

### WorkOS Configuration

1. Go to https://dashboard.workos.com
2. **Redirects** → Add:
   ```
   https://api.ptah.live/api/auth/callback
   ```
3. **Logout URL** → Add:
   ```
   https://ptah.live
   ```

### Paddle Configuration

1. Go to https://vendors.paddle.com (or sandbox)
2. **Developer Tools** → **Webhooks** → **New Destination**
3. Configure:
   - **URL**: `https://api.ptah.live/webhooks/paddle`
   - **Events**: Select all subscription events
4. Copy the **Webhook Secret**

### SendGrid Configuration

1. Go to https://app.sendgrid.com
2. **Settings** → **Sender Authentication**
3. Verify your sending domain (`nghive.tech`)
4. **Settings** → **API Keys** → Create key with "Mail Send" permission

---

## Monitoring & Troubleshooting

### View Logs

```bash
# Via CLI
doctl apps logs <APP_ID> --type=run

# Or in console: App → Runtime Logs
```

### Health Check

The API exposes a health endpoint:

```bash
curl https://api.ptah.live/api
```

### Common Issues

#### 1. Database Connection Errors

**Symptom**: "Connection refused" or timeout errors

**Solutions**:

- Verify DATABASE_URL is correct (pooled connection string)
- Check Neon project is not paused (free tier auto-suspends)
- Ensure `?sslmode=require` is in the connection string

#### 2. Memory Errors (512MB limit)

**Symptom**: App crashes, "JavaScript heap out of memory"

**Solutions**:

- Verify `NODE_OPTIONS="--max-old-space-size=400"` is set
- Check for memory leaks in logs
- Upgrade to 1GB instance ($10/month) if needed

#### 3. Cold Starts (Neon)

**Symptom**: First request after inactivity takes 500ms-2s

**Explanation**: Neon free tier auto-suspends after 5 min of inactivity

**Solutions**:

- This is expected on free tier
- Upgrade to Neon Launch for always-on compute
- Implement connection retry logic (Prisma does this automatically)

#### 4. SSL Certificate Not Provisioning

**Solutions**:

- Wait 5-10 minutes after adding domain
- Verify DNS is pointing to DigitalOcean
- Check for CAA records blocking Let's Encrypt

---

## Scaling Guide

### When to Scale

| Metric           | Threshold   | Action                            |
| ---------------- | ----------- | --------------------------------- |
| Response time    | > 500ms P95 | Check DB queries, add instance    |
| Memory usage     | > 80%       | Upgrade instance size             |
| Database storage | > 400MB     | Upgrade Neon tier                 |
| Error rate       | > 1%        | Investigate logs, scale if needed |

### Horizontal Scaling (Multiple Instances)

If you need multiple backend instances:

1. **Add Redis** for shared state (Upstash free tier):

   ```
   REDIS_URL: "rediss://default:xxx@xxx.upstash.io:6379"
   ```

2. **Update code** to use Redis for:

   - PKCE state storage
   - Magic link tokens
   - SSE tickets

3. **Scale instances**:
   ```bash
   doctl apps update <APP_ID> --instance-count 2
   ```

### Vertical Scaling (Bigger Instances)

| Current    | Upgrade To  | When                 |
| ---------- | ----------- | -------------------- |
| 512MB ($5) | 1GB ($10)   | Memory > 80%         |
| 1GB ($10)  | 2GB ($25)   | Still hitting limits |
| Neon Free  | Neon Launch | Storage > 400MB      |

---

## Appendix: App Platform Specification

The complete app spec is in `.do/app.yaml`. Key sections:

```yaml
name: ptah-production
region: nyc

static_sites:
  - name: landing
    # ... Angular landing page config

services:
  - name: api
    dockerfile_path: apps/ptah-license-server/Dockerfile
    instance_size_slug: apps-s-1vcpu-0.5gb # $5/month
    instance_count: 1
    # ... NestJS license server config
```

### Deploy Commands

```bash
# Initial deployment
doctl apps create --spec .do/app.yaml

# Update deployment
doctl apps update <APP_ID> --spec .do/app.yaml

# Force rebuild
doctl apps create-deployment <APP_ID> --force-rebuild

# View app info
doctl apps get <APP_ID>
```

---

## Security Checklist

Before going live:

- [ ] All secrets stored as encrypted environment variables
- [ ] JWT_SECRET is unique, 64+ characters
- [ ] ADMIN_API_KEY is unique, 64+ characters
- [ ] WorkOS redirect URI matches production URL
- [ ] Paddle webhook URL configured
- [ ] SendGrid sender domain verified
- [ ] HTTPS enforced (automatic with App Platform)
- [ ] Database connection uses SSL (`?sslmode=require`)

---

## Next Steps After Deployment

1. **Test authentication flow**:

   - Visit https://ptah.live
   - Click login → WorkOS flow → Callback

2. **Test payment flow**:

   - Use Paddle sandbox first
   - Create test subscription
   - Verify webhook receipt

3. **Test license verification**:

   - From VS Code extension
   - Verify license key works

4. **Monitor**:
   - Set up DigitalOcean alerts
   - Check Neon dashboard for usage
   - Review logs daily for first week

---

**Document Version**: 2.0
**Last Updated**: 2026-02-03
**Cost**: ~$6/month (Neon Free + DO App Platform $5 + Domain)
