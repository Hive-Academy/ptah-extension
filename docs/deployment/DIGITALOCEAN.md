# DigitalOcean Deployment Guide

This guide provides step-by-step instructions for deploying the Ptah License Server infrastructure to DigitalOcean, including managed PostgreSQL, Redis, and the NestJS application on App Platform.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Cost Estimation](#cost-estimation)
- [Step 1: Create Managed PostgreSQL](#step-1-create-managed-postgresql)
- [Step 2: Create Managed Redis](#step-2-create-managed-redis)
- [Step 3: Deploy License Server to App Platform](#step-3-deploy-license-server-to-app-platform)
- [Step 4: Deploy Frontend to Spaces with CDN](#step-4-deploy-frontend-to-spaces-with-cdn)
- [Step 5: Configure Custom Domain and SSL](#step-5-configure-custom-domain-and-ssl)
- [Step 6: Set Up Monitoring and Alerts](#step-6-set-up-monitoring-and-alerts)
- [App Platform Specification](#app-platform-specification)
- [Scaling Guidelines](#scaling-guidelines)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying, ensure you have:

1. **DigitalOcean Account** with billing configured
   - Sign up: https://cloud.digitalocean.com/registrations/new
   - Generate API token: https://cloud.digitalocean.com/account/api/tokens

2. **Domain Name** (optional but recommended)
   - Example: `api.ptah.dev` for the license server
   - Example: `ptah.dev` for the landing page

3. **Paddle Production Account** configured
   - Production dashboard: https://vendors.paddle.com/
   - Products and prices created
   - Webhook endpoint configured (will be set after deployment)

4. **WorkOS Production Environment** configured
   - Dashboard: https://dashboard.workos.com/
   - Production API key generated
   - OAuth redirect URI configured (will be set after deployment)

5. **SendGrid Account** (for email delivery)
   - Dashboard: https://app.sendgrid.com/
   - API key with Mail Send permissions

6. **DigitalOcean CLI** (optional, for automation)
   ```bash
   # Install doctl
   brew install doctl  # macOS
   snap install doctl  # Linux

   # Authenticate
   doctl auth init
   ```

---

## Architecture Overview

```
                                    +------------------+
                                    |   Cloudflare     |
                                    |   (Optional CDN) |
                                    +--------+---------+
                                             |
              +------------------------------+------------------------------+
              |                              |                              |
              v                              v                              v
    +------------------+          +------------------+          +------------------+
    |  Landing Page    |          |  License Server  |          |  Paddle/WorkOS   |
    |  (Spaces + CDN)  |          |  (App Platform)  |          |  (External)      |
    |  ptah.dev        |          |  api.ptah.dev    |          |                  |
    +------------------+          +--------+---------+          +------------------+
                                           |
              +----------------------------+----------------------------+
              |                                                         |
              v                                                         v
    +------------------+                                      +------------------+
    |  Managed         |                                      |  Managed         |
    |  PostgreSQL      |                                      |  Redis           |
    |  (db-s-2vcpu-4gb)|                                      |  (db-s-1vcpu-1gb)|
    +------------------+                                      +------------------+
```

**Data Flow:**

1. Users visit `ptah.dev` (static landing page)
2. Authentication redirects to `api.ptah.dev/auth/login` (WorkOS PKCE flow)
3. Paddle webhooks hit `api.ptah.dev/webhooks/paddle`
4. License verification via `api.ptah.dev/api/v1/licenses/verify`
5. PostgreSQL stores users, licenses, subscriptions
6. Redis stores PKCE state, sessions, rate limits

---

## Cost Estimation

| Service | Size/Plan | Monthly Cost | Notes |
|---------|-----------|--------------|-------|
| **App Platform** | Basic (1 container, 1GB RAM) | $5 | Auto-scaling available |
| **Managed PostgreSQL** | db-s-2vcpu-4gb | $30 | 2 vCPU, 4GB RAM, 38GB storage |
| **Managed Redis** | db-s-1vcpu-1gb | $15 | 1 vCPU, 1GB RAM |
| **Spaces** | Standard (250GB storage) | $5 | Includes CDN |
| **Domain** | (external) | ~$12/year | Via Namecheap, Cloudflare, etc. |
| **Bandwidth** | First 1TB free | $0 | Overage: $0.01/GB |
| **Total Baseline** | | **~$55/month** | |

**Scaling Costs:**

| Upgrade | Monthly Cost | When to Upgrade |
|---------|--------------|-----------------|
| App Platform Professional | $12 | Need horizontal scaling |
| PostgreSQL db-s-4vcpu-8gb | $60 | CPU > 70% sustained |
| Redis db-s-2vcpu-4gb | $30 | Memory > 80% |
| Additional App instances | +$5 each | Response time > 500ms |

---

## Step 1: Create Managed PostgreSQL

### Via Console

1. Navigate to **Databases** in DigitalOcean console
2. Click **Create Database Cluster**
3. Configure:
   - **Engine**: PostgreSQL 16
   - **Cluster configuration**: db-s-2vcpu-4gb ($30/month)
   - **Datacenter**: Choose closest to your users (e.g., nyc1, fra1)
   - **VPC Network**: Default VPC
   - **Cluster name**: `ptah-postgres`
4. Click **Create Database Cluster**
5. Wait for provisioning (~5 minutes)

### Via CLI

```bash
doctl databases create ptah-postgres \
  --engine pg \
  --version 16 \
  --size db-s-2vcpu-4gb \
  --region nyc1 \
  --num-nodes 1
```

### Post-Creation Setup

1. **Create database**:
   ```bash
   # Get connection details
   doctl databases connection ptah-postgres --format Host,Port,User,Password

   # Connect via psql
   psql "postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require"

   # Create database
   CREATE DATABASE ptah_licenses;
   ```

2. **Note connection string**:
   ```
   postgresql://doadmin:PASSWORD@ptah-postgres-do-user-XXXX.b.db.ondigitalocean.com:25060/ptah_licenses?sslmode=require
   ```

3. **Configure trusted sources** (after App Platform deployment):
   - Add App Platform's outbound IP to trusted sources
   - Or use VPC peering for private network access

---

## Step 2: Create Managed Redis

### Via Console

1. Navigate to **Databases** in DigitalOcean console
2. Click **Create Database Cluster**
3. Configure:
   - **Engine**: Redis
   - **Cluster configuration**: db-s-1vcpu-1gb ($15/month)
   - **Datacenter**: Same as PostgreSQL
   - **VPC Network**: Default VPC
   - **Cluster name**: `ptah-redis`
4. Click **Create Database Cluster**

### Via CLI

```bash
doctl databases create ptah-redis \
  --engine redis \
  --version 7 \
  --size db-s-1vcpu-1gb \
  --region nyc1 \
  --num-nodes 1
```

### Post-Creation Setup

1. **Note connection string**:
   ```
   rediss://default:PASSWORD@ptah-redis-do-user-XXXX.b.db.ondigitalocean.com:25061
   ```
   Note: `rediss://` (with double 's') indicates TLS-encrypted connection.

---

## Step 3: Deploy License Server to App Platform

### Via Console

1. Navigate to **Apps** in DigitalOcean console
2. Click **Create App**
3. **Source**: GitHub > Select `your-org/ptah-extension`
4. **Branch**: `main` (or `production`)
5. **Source Directory**: `apps/ptah-license-server`
6. **Autodeploy**: Enable

### Configure Build & Run

1. **Build Command**:
   ```bash
   npm ci && npx prisma generate --schema=prisma/schema.prisma && npm run build
   ```

2. **Run Command**:
   ```bash
   npx prisma migrate deploy --schema=prisma/schema.prisma && node dist/main.js
   ```

3. **HTTP Port**: `3000`
4. **Instance Size**: Basic ($5/month)
5. **Instance Count**: 1 (can scale later)

### Environment Variables

Configure these in the App Platform console:

```yaml
# Database
DATABASE_URL: "postgresql://doadmin:PASSWORD@ptah-postgres-do-user-XXXX.b.db.ondigitalocean.com:25060/ptah_licenses?sslmode=require"
REDIS_URL: "rediss://default:PASSWORD@ptah-redis-do-user-XXXX.b.db.ondigitalocean.com:25061"

# Server
PORT: "3000"
NODE_ENV: "production"
FRONTEND_URL: "https://ptah.dev"

# Security (generate with: openssl rand -hex 32)
JWT_SECRET: "your-64-char-hex-secret"
ADMIN_API_KEY: "your-64-char-hex-secret"

# WorkOS
WORKOS_API_KEY: "sk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
WORKOS_CLIENT_ID: "client_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
WORKOS_REDIRECT_URI: "https://api.ptah.dev/auth/callback"

# Paddle
PADDLE_API_KEY: "pdl_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
PADDLE_WEBHOOK_SECRET: "pdl_ntfset_XXXXXXXXXXXXXXXXXXXXXXXX"
PADDLE_PRICE_ID_EARLY_ADOPTER: "pri_XXXXXXXXXXXXXXXXXXXXXXXX"
PADDLE_PRICE_ID_PRO: "pri_YYYYYYYYYYYYYYYYYYYYYYYY"

# SendGrid
SENDGRID_API_KEY: "SG.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
SENDGRID_FROM_EMAIL: "noreply@ptah.dev"
SENDGRID_FROM_NAME: "Ptah Team"

# Magic Link
MAGIC_LINK_TTL_MS: "30000"
```

**Security Note**: Mark all sensitive variables as "Encrypt" in App Platform.

---

## Step 4: Deploy Frontend to Spaces with CDN

### Create Space

1. Navigate to **Spaces Object Storage**
2. Click **Create Space**
3. Configure:
   - **Datacenter**: Same region as other services
   - **CDN**: Enable
   - **Restrict File Listing**: Enable
   - **Name**: `ptah-landing`

### Build and Upload

```bash
# Build the landing page
cd apps/ptah-landing-page
npm run build

# Install s3cmd or use doctl
doctl compute cdn create ptah-landing \
  --origin ptah-landing.nyc3.digitaloceanspaces.com

# Upload built files
s3cmd sync dist/apps/ptah-landing-page/ s3://ptah-landing/ \
  --acl-public \
  --delete-removed \
  --exclude ".git/*"
```

### Configure for SPA

1. Create `error.html` redirect:
   ```html
   <!DOCTYPE html>
   <html>
   <head>
     <meta http-equiv="refresh" content="0; url=/index.html">
   </head>
   </html>
   ```

2. Upload as `404.html` for SPA routing

---

## Step 5: Configure Custom Domain and SSL

### For App Platform (api.ptah.dev)

1. In App settings, go to **Domains**
2. Click **Add Domain**
3. Enter: `api.ptah.dev`
4. Add DNS records as instructed:
   ```
   CNAME api ptah-xyz123.ondigitalocean.app.
   ```
5. SSL certificate auto-provisions via Let's Encrypt

### For Spaces (ptah.dev)

1. In Spaces CDN settings
2. Add custom subdomain: `ptah.dev`
3. Add DNS records:
   ```
   CNAME @ ptah-landing.nyc3.cdn.digitaloceanspaces.com.
   ```

### DNS Configuration (Cloudflare Example)

```
Type    Name    Content                                      Proxy
CNAME   @       ptah-landing.nyc3.cdn.digitaloceanspaces.com  Yes
CNAME   api     ptah-xyz123.ondigitalocean.app.               No
CNAME   www     ptah.dev                                      Yes
```

---

## Step 6: Set Up Monitoring and Alerts

### Enable Monitoring

1. Navigate to **Monitoring** in DigitalOcean console
2. Click **Create Alert Policy**

### Recommended Alerts

| Resource | Metric | Threshold | Action |
|----------|--------|-----------|--------|
| PostgreSQL | CPU | > 70% for 5 min | Email + Slack |
| PostgreSQL | Memory | > 80% for 5 min | Email + Slack |
| PostgreSQL | Storage | > 80% | Email |
| Redis | Memory | > 80% for 5 min | Email + Slack |
| Redis | Connections | > 100 | Email |
| App Platform | Response Time | > 500ms for 5 min | Email + Slack |
| App Platform | Error Rate | > 1% for 5 min | Email + Slack |

### Logging

1. Enable **Runtime Logs** in App Platform
2. Configure log forwarding to:
   - Papertrail
   - Datadog
   - Logtail

### Health Check Endpoint

Ensure your app exposes `/health` or `/api`:

```typescript
// apps/ptah-license-server/src/app/app.controller.ts
@Get('health')
health() {
  return { status: 'ok', timestamp: new Date().toISOString() };
}
```

---

## App Platform Specification

For infrastructure-as-code deployment, create `.do/app.yaml`:

```yaml
name: ptah-license-server
region: nyc
services:
  - name: api
    github:
      repo: your-org/ptah-extension
      branch: main
      deploy_on_push: true
    source_dir: apps/ptah-license-server
    dockerfile_path: Dockerfile
    http_port: 3000
    instance_count: 1
    instance_size_slug: basic-xxs
    routes:
      - path: /
    health_check:
      http_path: /api
      initial_delay_seconds: 30
      period_seconds: 10
      timeout_seconds: 5
      success_threshold: 1
      failure_threshold: 3
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        type: SECRET
        value: "${db.DATABASE_URL}"
      - key: REDIS_URL
        scope: RUN_TIME
        type: SECRET
        value: "${redis.REDIS_URL}"
      - key: NODE_ENV
        scope: RUN_TIME
        value: "production"
      - key: PORT
        scope: RUN_TIME
        value: "3000"
      - key: FRONTEND_URL
        scope: RUN_TIME
        value: "https://ptah.dev"
      - key: JWT_SECRET
        scope: RUN_TIME
        type: SECRET
      - key: ADMIN_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: WORKOS_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: WORKOS_CLIENT_ID
        scope: RUN_TIME
        type: SECRET
      - key: WORKOS_REDIRECT_URI
        scope: RUN_TIME
        value: "https://api.ptah.dev/auth/callback"
      - key: PADDLE_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: PADDLE_WEBHOOK_SECRET
        scope: RUN_TIME
        type: SECRET
      - key: PADDLE_PRICE_ID_EARLY_ADOPTER
        scope: RUN_TIME
        type: SECRET
      - key: PADDLE_PRICE_ID_PRO
        scope: RUN_TIME
        type: SECRET
      - key: SENDGRID_API_KEY
        scope: RUN_TIME
        type: SECRET
      - key: SENDGRID_FROM_EMAIL
        scope: RUN_TIME
        value: "noreply@ptah.dev"
      - key: SENDGRID_FROM_NAME
        scope: RUN_TIME
        value: "Ptah Team"
      - key: MAGIC_LINK_TTL_MS
        scope: RUN_TIME
        value: "30000"

databases:
  - name: db
    engine: PG
    version: "16"
    size: db-s-2vcpu-4gb
    num_nodes: 1
  - name: redis
    engine: REDIS
    version: "7"
    size: db-s-1vcpu-1gb
    num_nodes: 1

domains:
  - domain: api.ptah.dev
    type: PRIMARY
```

Deploy with CLI:

```bash
doctl apps create --spec .do/app.yaml
```

---

## Scaling Guidelines

### When to Scale Up

| Indicator | Threshold | Action |
|-----------|-----------|--------|
| API Response Time | > 500ms P95 for 10 min | Add App instance |
| PostgreSQL CPU | > 70% sustained | Upgrade to db-s-4vcpu-8gb |
| PostgreSQL Storage | > 80% | Upgrade storage |
| Redis Memory | > 80% | Upgrade to db-s-2vcpu-4gb |
| Redis Connections | > 100 | Add Redis node |
| Error Rate | > 1% | Investigate, then scale |

### Horizontal Scaling (App Platform)

```bash
# Scale to 2 instances
doctl apps update APP_ID --instance-count 2
```

### Vertical Scaling (Databases)

```bash
# Upgrade PostgreSQL
doctl databases resize ptah-postgres --size db-s-4vcpu-8gb

# Upgrade Redis
doctl databases resize ptah-redis --size db-s-2vcpu-4gb
```

### Auto-Scaling (App Platform Professional)

Upgrade to Professional plan for auto-scaling:

```yaml
services:
  - name: api
    instance_size_slug: professional-xs
    instance_count: 1
    autoscaling:
      min_instance_count: 1
      max_instance_count: 5
      metrics:
        cpu:
          percent: 70
```

---

## Troubleshooting

### App Won't Start

1. **Check logs**:
   ```bash
   doctl apps logs APP_ID --type=run
   ```

2. **Common issues**:
   - Missing environment variables
   - Database connection refused (check trusted sources)
   - Prisma migration failed

### Database Connection Refused

1. **Add App Platform to trusted sources**:
   - Go to Database > Settings > Trusted Sources
   - Add App Platform's outbound IP range

2. **Verify connection string**:
   ```bash
   # Test from local machine
   psql "postgresql://doadmin:PASSWORD@HOST:25060/ptah_licenses?sslmode=require"
   ```

### SSL Certificate Issues

1. **Wait 5-10 minutes** for Let's Encrypt provisioning
2. **Verify DNS propagation**:
   ```bash
   dig api.ptah.dev
   ```
3. **Check certificate**:
   ```bash
   openssl s_client -connect api.ptah.dev:443 -servername api.ptah.dev
   ```

### Webhook Signature Failures

1. **Verify webhook secret** matches Paddle dashboard
2. **Check raw body parsing** is enabled in NestJS
3. **Test with Paddle CLI**:
   ```bash
   paddle webhooks test --endpoint https://api.ptah.dev/webhooks/paddle
   ```

### Performance Issues

1. **Enable query logging** in PostgreSQL:
   ```sql
   ALTER SYSTEM SET log_min_duration_statement = 100;
   SELECT pg_reload_conf();
   ```

2. **Check slow queries**:
   ```sql
   SELECT query, mean_time, calls
   FROM pg_stat_statements
   ORDER BY mean_time DESC
   LIMIT 10;
   ```

3. **Add indexes** for frequent queries

---

## Backup and Recovery

### Automatic Backups

DigitalOcean Managed Databases include:
- Daily automatic backups (7-day retention)
- Point-in-time recovery

### Manual Backup

```bash
# Export database
pg_dump "postgresql://doadmin:PASSWORD@HOST:25060/ptah_licenses?sslmode=require" > backup.sql

# Restore database
psql "postgresql://doadmin:PASSWORD@HOST:25060/ptah_licenses?sslmode=require" < backup.sql
```

### Redis Backup

Redis with AOF persistence automatically recovers data on restart.

---

## Security Checklist

- [ ] All secrets stored as encrypted environment variables
- [ ] Database trusted sources configured (no public access)
- [ ] CORS configured for frontend domain only
- [ ] Rate limiting enabled on auth endpoints
- [ ] Webhook signature verification enabled
- [ ] HTTPS enforced (redirect HTTP to HTTPS)
- [ ] Security headers configured (HSTS, CSP, etc.)
- [ ] Admin API key rotated regularly
- [ ] Audit logging enabled

---

## Next Steps After Deployment

1. **Configure Paddle Webhook URL**:
   ```
   https://api.ptah.dev/webhooks/paddle
   ```

2. **Configure WorkOS Redirect URI**:
   ```
   https://api.ptah.dev/auth/callback
   ```

3. **Update VS Code Extension** to use production API:
   ```
   PTAH_LICENSE_SERVER_URL=https://api.ptah.dev
   ```

4. **Test full flow**:
   - Login via WorkOS
   - Create subscription via Paddle
   - Verify license key activation

---

**Document Version**: 1.0
**Last Updated**: 2026-01-22
**Author**: Backend Developer (Orchestration Workflow)
