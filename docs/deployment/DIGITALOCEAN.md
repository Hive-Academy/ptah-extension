# DigitalOcean Deployment Guide

This guide provides step-by-step instructions for deploying Ptah to production using a **DigitalOcean Droplet** (API + database) and **App Platform** (landing page).

## Table of Contents

- [Cost Overview](#cost-overview)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Step 1: Create a Droplet](#step-1-create-a-droplet)
- [Step 2: SSH and Initial Setup](#step-2-ssh-and-initial-setup)
- [Step 3: Clone Repository and Configure](#step-3-clone-repository-and-configure)
- [Step 4: SSL Certificate Setup](#step-4-ssl-certificate-setup)
- [Step 5: Start the Production Stack](#step-5-start-the-production-stack)
- [Step 6: Deploy Landing Page (App Platform)](#step-6-deploy-landing-page-app-platform)
- [Step 7: Configure DNS](#step-7-configure-dns)
- [Step 8: Configure External Services](#step-8-configure-external-services)
- [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)
- [Backup Strategy](#backup-strategy)
- [Scaling Guide](#scaling-guide)

---

## Cost Overview

### Budget Configuration (~$6/month)

| Service            | Provider        | Tier         | Monthly Cost  |
| ------------------ | --------------- | ------------ | ------------- |
| **Droplet**        | DigitalOcean    | $6 (1GB RAM) | **$6**        |
| **PostgreSQL**     | Self-hosted     | On Droplet   | **$0**        |
| **License Server** | Self-hosted     | On Droplet   | **$0**        |
| **Landing Page**   | DO App Platform | Static Site  | **$0**        |
| **Domain**         | GoDaddy         | ptah.live    | **~$1**       |
|                    |                 | **TOTAL**    | **~$6/month** |

### Why Self-Hosted PostgreSQL?

- No cold starts (always running, unlike Neon free tier)
- No compute hour limits
- Full control over backups and configuration
- Data stays on your own infrastructure
- No vendor lock-in

### When to Upgrade

| Trigger                 | Upgrade Path              | New Cost |
| ----------------------- | ------------------------- | -------- |
| Memory pressure > 80%   | $12/month Droplet (2GB)   | ~$12/mo  |
| Need horizontal scaling | Add Redis (Upstash free)  | +$0      |
| Database > 20GB         | Managed DB or larger disk | +$15/mo  |
| High traffic            | Load balancer + replicas  | +$12/mo  |

---

## Architecture Overview

```
                    +-------------------------------------+
                    |         GoDaddy (Domain)            |
                    |         ptah.live                   |
                    +---------------+---------------------+
                                    |
                    +---------------v---------------------+
                    |    DigitalOcean (Nameservers)        |
                    |    ns1/ns2/ns3.digitalocean.com      |
                    +---------------+---------------------+
                                    |
              +---------------------+---------------------+
              |                                           |
              v                                           v
    +-------------------+                     +-------------------+
    |  ptah.live        |                     |  api.ptah.live    |
    |  (App Platform)   |                     |  (Droplet)        |
    |  Landing Page     |                     |  $6/month         |
    |  FREE             |                     +-------------------+
    +-------------------+                     |                   |
                                              |  +-------------+ |
                                              |  | Caddy       | |
                                              |  | (SSL/proxy) | |
                                              |  +------+------+ |
                                              |         |         |
                                              |  +------v------+ |
                                              |  | License     | |
                                              |  | Server      | |
                                              |  | (NestJS)    | |
                                              |  +------+------+ |
                                              |         |         |
                                              |  +------v------+ |
                                              |  | PostgreSQL  | |
                                              |  | 16-alpine   | |
                                              |  +-------------+ |
                                              +-------------------+

    External Services:
    +-- WorkOS (Authentication)
    +-- Paddle (Payments)
    +-- Resend (Email)
```

---

## Prerequisites

### 1. Accounts Required

| Service          | Purpose        | Sign Up                                            |
| ---------------- | -------------- | -------------------------------------------------- |
| **DigitalOcean** | Hosting        | <https://cloud.digitalocean.com/registrations/new> |
| **GoDaddy**      | Domain         | <https://www.godaddy.com>                          |
| **WorkOS**       | Authentication | <https://workos.com>                               |
| **Paddle**       | Payments       | <https://paddle.com>                               |
| **Resend**       | Email          | <https://resend.com>                               |

### 2. GitHub Repository

Your code must be in a GitHub repository that DigitalOcean can access (for App Platform landing page auto-deploy).

### 3. Local Tools

```bash
# DigitalOcean CLI (optional but recommended)
brew install doctl  # macOS
snap install doctl  # Linux

# Authenticate
doctl auth init

# SSH key (if not already generated)
ssh-keygen -t ed25519 -C "your-email@example.com"
```

---

## Step 1: Create a Droplet

### Via Console (Recommended)

1. Go to <https://cloud.digitalocean.com/droplets/new>
2. Configure:

| Setting            | Value                                   |
| ------------------ | --------------------------------------- |
| **Region**         | NYC1 (or closest to your users)         |
| **Image**          | Ubuntu 24.04 LTS                        |
| **Size**           | Basic > Regular > $6/mo (1GB RAM, 25GB) |
| **Authentication** | SSH Key (add your public key)           |
| **Hostname**       | `ptah-api`                              |

3. Click **Create Droplet**
4. Note the public IP address

### Via CLI

```bash
doctl compute droplet create ptah-api \
  --region nyc1 \
  --size s-1vcpu-1gb \
  --image ubuntu-24-04-x64 \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header | head -1)
```

---

## Step 2: SSH and Initial Setup

### Connect to the Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

### Install Docker and Docker Compose

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version

# (Optional) Add non-root user
adduser deploy
usermod -aG docker deploy
```

### Configure Docker Log Rotation

Create the Docker daemon configuration to prevent log files from consuming all disk space:

```bash
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

# Restart Docker to apply
systemctl restart docker
```

This limits each container to 30MB of logs (3 files x 10MB). On a 25GB disk, this is essential to prevent disk exhaustion.

### Install Git

```bash
apt install -y git
```

### Configure Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

---

## Step 3: Clone Repository and Configure

### Clone the Repository

```bash
cd /opt
git clone https://github.com/your-org/ptah-extension.git
cd ptah-extension
```

### Create Production Environment File

```bash
cp .env.prod.example .env.prod
```

Edit `.env.prod` with secure values:

```bash
nano .env.prod
```

**Critical: Generate secure secrets:**

```bash
# Generate each secret
openssl rand -hex 32  # For POSTGRES_PASSWORD
openssl rand -hex 32  # For JWT_SECRET
openssl rand -hex 32  # For ADMIN_API_KEY
openssl rand -hex 32  # For ADMIN_SECRET
```

Fill in all values including WorkOS, Paddle, and Resend credentials. See `.env.prod.example` for the full list.

---

## Step 4: SSL Certificate Setup

Caddy automatically obtains and renews SSL certificates via Let's Encrypt. No manual certificate setup is required.

When you start the production stack (Step 5), Caddy will:

1. Listen on port 80 for the ACME HTTP-01 challenge
2. Obtain a certificate for `api.ptah.live` from Let's Encrypt
3. Redirect all HTTP traffic to HTTPS
4. Automatically renew certificates before expiry

### Verify SSL

After starting the stack, verify the certificate:

```bash
curl -I https://api.ptah.live/api
```

---

## Step 5: Start the Production Stack

```bash
cd /opt/ptah-extension

# Start all services
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f license-server
```

### Expected Output

```
NAME                       STATUS                   PORTS
ptah_postgres_prod         running (healthy)        5432/tcp
ptah_license_server_prod   running                  3000/tcp
ptah_caddy                 running                  0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

### Verify the API

```bash
curl https://api.ptah.live/api
```

---

## Step 6: Deploy Landing Page (App Platform)

The landing page is deployed as a free static site on App Platform.

### Via Console

1. Go to <https://cloud.digitalocean.com/apps>
2. Click **Create App**
3. **Source**: GitHub > Select `ptah-extension` repo > Branch `main`
4. **Component**: Static Site

| Setting              | Value                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| **Name**             | `landing`                                                             |
| **Build Command**    | `npm ci && npx nx build ptah-landing-page --configuration=production` |
| **Output Directory** | `dist/ptah-landing-page/browser`                                      |

5. Click **Create Resources**

### Via CLI

```bash
doctl apps create --spec .do/app.yaml
```

---

## Step 7: Configure DNS

### Delegate DNS to DigitalOcean (Recommended)

1. **In GoDaddy:**

   - Go to **My Products** > Select `ptah.live`
   - Click **DNS** > **Nameservers** > **Change**
   - Select **Enter my own nameservers**
   - Add:

     ```
     ns1.digitalocean.com
     ns2.digitalocean.com
     ns3.digitalocean.com
     ```

   - Save and confirm

2. **In DigitalOcean:**

   - Go to **Networking** > **Domains**
   - Add domain: `ptah.live`
   - Add A record: `api` > Droplet IP
   - App Platform handles the root domain for the landing page

3. **Wait for propagation** (30 min to 72 hours):

   ```bash
   dig NS ptah.live
   dig A api.ptah.live
   ```

---

## Step 8: Configure External Services

### WorkOS Configuration

1. Go to <https://dashboard.workos.com>
2. **Redirects** > Add: `https://api.ptah.live/api/auth/callback`
3. **Logout URL** > Add: `https://ptah.live`

### Paddle Configuration

1. Go to <https://vendors.paddle.com>
2. **Developer Tools** > **Webhooks** > **New Destination**
3. **URL**: `https://api.ptah.live/webhooks/paddle`
4. **Events**: Select all subscription events
5. Copy the **Webhook Secret** to `.env.prod`

### Resend Configuration

1. Go to <https://resend.com>
2. **Domains** > Add and verify `ptah.live`
3. **API Keys** > Create key
4. Copy the key to `.env.prod` as `RESEND_API_KEY`

---

## Monitoring and Troubleshooting

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f license-server
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f caddy

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail 100 license-server
```

### Health Check

```bash
# API health
curl https://api.ptah.live/api

# PostgreSQL health
docker exec ptah_postgres_prod pg_isready -U ptah -d ptah_db

# Container status
docker compose -f docker-compose.prod.yml ps
```

### Common Issues

#### 1. Database Connection Errors

**Symptom**: "Connection refused" or timeout errors

**Solutions**:

- Verify PostgreSQL container is healthy: `docker compose -f docker-compose.prod.yml ps postgres`
- Check DATABASE_URL in `.env.prod` matches docker-compose credentials
- Restart the stack: `docker compose -f docker-compose.prod.yml restart`

#### 2. Memory Pressure (1GB Droplet)

**Symptom**: OOM kills, slow responses

**Solutions**:

- Check memory: `free -h` and `docker stats`
- Add swap space:

  ```bash
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```

- Upgrade to $12/month Droplet (2GB RAM) if persistent

#### 3. SSL Certificate Not Provisioning

**Solutions**:

- Verify DNS A record points to Droplet IP: `dig A api.ptah.live`
- Check Caddy logs: `docker compose -f docker-compose.prod.yml logs caddy`
- Caddy automatically retries certificate issuance; check for ACME errors in logs

#### 4. Caddy 502 Bad Gateway

**Solutions**:

- License server may still be starting (wait 30-60 seconds)
- Check license-server logs: `docker compose -f docker-compose.prod.yml logs license-server`
- Verify license-server is running: `docker compose -f docker-compose.prod.yml ps license-server`

### Restarting Services

```bash
# Restart everything
docker compose -f docker-compose.prod.yml restart

# Restart single service
docker compose -f docker-compose.prod.yml restart license-server

# Full rebuild (after code changes)
cd /opt/ptah-extension
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build license-server
```

---

## Backup Strategy

### Automated Daily Backups

Set up a cron job on the Droplet:

```bash
# Edit crontab
crontab -e

# Add daily backup at 3 AM UTC
0 3 * * * cd /opt/ptah-extension && bash scripts/backup-db.sh >> /var/log/ptah-backup.log 2>&1
```

### Manual Backup

```bash
cd /opt/ptah-extension
bash scripts/backup-db.sh
```

### Restore from Backup

```bash
# Decompress backup
gunzip backups/ptah_db_20260208_030000.sql.gz

# Restore to database
cat backups/ptah_db_20260208_030000.sql | \
  docker exec -i ptah_postgres_prod psql -U ptah -d ptah_db
```

### Off-Site Backup (Recommended)

Sync backups to DigitalOcean Spaces or S3:

```bash
# Install s3cmd or rclone
apt install -y rclone

# Configure rclone with DO Spaces
rclone config

# Sync backups
rclone sync ./backups spaces:ptah-backups/db/
```

---

## Scaling Guide

### Vertical Scaling (Bigger Droplet)

| Current   | Upgrade To | When                   |
| --------- | ---------- | ---------------------- |
| $6 (1GB)  | $12 (2GB)  | Memory > 80% sustained |
| $12 (2GB) | $24 (4GB)  | Still hitting limits   |

```bash
# Resize via CLI (requires power off)
doctl compute droplet-action resize DROPLET_ID --size s-1vcpu-2gb --resize-disk
```

### Horizontal Scaling (Multiple Instances)

When you need multiple backend instances:

1. **Add Redis** for shared state (Upstash free tier or self-hosted)
2. **Update code** to use Redis for PKCE state, magic link tokens, SSE tickets
3. **Add a load balancer** ($12/month) in front of multiple Droplets
4. **Separate database** to its own Droplet or use DigitalOcean Managed Database

### Database Scaling

| Trigger            | Solution                                    |
| ------------------ | ------------------------------------------- |
| Storage > 20GB     | Resize Droplet disk or attach Block Storage |
| Connections > 100  | Add PgBouncer connection pooler             |
| Read-heavy traffic | Add read replica on second Droplet          |

---

## Security Checklist

Before going live:

- [ ] All secrets in `.env.prod` are unique, cryptographically random values
- [ ] Firewall (ufw) only allows ports 22, 80, 443
- [ ] SSH key authentication only (disable password auth)
- [ ] `.env.prod` is NOT committed to git
- [ ] HTTPS enforced via Caddy (automatic)
- [ ] WorkOS redirect URI matches production URL
- [ ] Paddle webhook URL configured
- [ ] Resend sender domain verified
- [ ] Daily database backups configured
- [ ] Swap space enabled for memory safety

---

## Deployment Cheat Sheet

```bash
# Deploy code updates
ssh root@YOUR_DROPLET_IP
cd /opt/ptah-extension
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build license-server

# View status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f license-server

# Backup database
bash scripts/backup-db.sh

# Restart everything
docker compose -f docker-compose.prod.yml restart

# Update landing page
# (Automatic via App Platform deploy-on-push from main branch)
```

---

## VS Code Extension Deployment

The extension is deployed separately from the server infrastructure. See:

- **[PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md#5-vs-code-extension)** — Build pipeline, runtime dependencies, packaging, and publishing
- **[research-vscode-extension-publishing.md](./research-vscode-extension-publishing.md)** — Marketplace requirements, pre-publish checklist, and CI/CD setup
- **[INSTALLATION.md](../INSTALLATION.md)** — End-user installation guide (VSIX staging and marketplace)

### Quick Reference

```bash
# Build and package the extension
npx nx run ptah-extension-vscode:package

# Output: dist/apps/ptah-extension-vscode/ptah-extension-vscode-<version>.vsix (~8.5 MB)

# Install on test machine
code --install-extension ptah-extension-vscode-0.1.0.vsix

# Publish to marketplace
cd dist/apps/ptah-extension-vscode
npx @vscode/vsce publish --pat <AZURE_DEVOPS_PAT>
```

---

**Document Version**: 4.0
**Last Updated**: 2026-03-05
**Architecture**: Droplet ($6/month) + App Platform (free) + Self-hosted PostgreSQL
