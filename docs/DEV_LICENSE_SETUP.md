# Local Development Setup Guide

This comprehensive guide explains how to set up the Ptah License Server locally for development, including Docker Compose environment, database setup, and license generation.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Docker)](#quick-start-docker)
- [Service URLs and Health Checks](#service-urls-and-health-checks)
- [Environment Setup](#environment-setup)
- [Prisma Database Migrations](#prisma-database-migrations)
- [Generating Development Licenses](#generating-development-licenses)
- [Testing Premium Features](#testing-premium-features)
- [Windows/WSL2 Recommendations](#windowswsl2-recommendations)
- [Non-Docker Setup (Fallback)](#non-docker-setup-fallback)
- [Troubleshooting](#troubleshooting)
- [Quick Reference](#quick-reference)

---

## Prerequisites

### Required

- **Docker Desktop** (v4.0+) with Docker Compose v2
  - Windows: https://docs.docker.com/desktop/install/windows-install/
  - macOS: https://docs.docker.com/desktop/install/mac-install/
  - Linux: https://docs.docker.com/desktop/install/linux-install/

- **Node.js 20+** (for running scripts outside Docker)
  - https://nodejs.org/

- **Git** for cloning the repository

### Optional (for non-Docker setup)

- **PostgreSQL 16** running locally
- **Redis 7** running locally

---

## Quick Start (Docker)

The fastest way to get the license server running locally:

```bash
# 1. Clone the repository (if not already done)
git clone https://github.com/your-org/ptah-extension.git
cd ptah-extension

# 2. Install dependencies
npm install

# 3. Copy environment files
cp .env.docker.example .env.docker
cp apps/ptah-license-server/.env.local.example apps/ptah-license-server/.env.local

# 4. Start all services
docker-compose up -d

# 5. Wait for services to be healthy (about 30-60 seconds)
docker-compose ps
```

**Expected output after step 5:**

```
NAME                     STATUS                   PORTS
ptah_postgres            running (healthy)        0.0.0.0:5432->5432/tcp
ptah_redis               running (healthy)        0.0.0.0:6379->6379/tcp
ptah_license_server      running                  0.0.0.0:3000->3000/tcp
```

**Verify the server is running:**

```bash
curl http://localhost:3000/api
```

---

## Service URLs and Health Checks

After starting Docker Compose, the following services are available:

| Service | URL | Health Check |
|---------|-----|--------------|
| **License Server** | http://localhost:3000 | `curl http://localhost:3000/api` |
| **PostgreSQL** | localhost:5432 | `docker exec ptah_postgres pg_isready -U postgres` |
| **Redis** | localhost:6379 | `docker exec ptah_redis redis-cli ping` |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api` | GET | Health check, returns `{ "message": "..." }` |
| `/api/v1/licenses/verify` | POST | Verify license key |
| `/api/v1/admin/licenses` | POST | Create license (requires API key) |
| `/auth/login` | GET | Initiate WorkOS login flow |
| `/auth/callback` | GET | WorkOS OAuth callback |
| `/webhooks/paddle` | POST | Paddle webhook endpoint |

---

## Environment Setup

### Docker Environment (.env.docker)

Located at project root, controls Docker Compose:

```env
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=ptah_licenses
POSTGRES_PORT=5432

# Redis
REDIS_PORT=6379

# License Server
LICENSE_SERVER_PORT=3000
```

### License Server Environment (.env.local)

Located at `apps/ptah-license-server/.env.local`:

```env
# ============================================
# DATABASE CONFIGURATION
# ============================================
# Docker Compose overrides this, but keep for reference
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"

# ============================================
# REDIS CONFIGURATION
# ============================================
REDIS_URL="redis://localhost:6379"

# ============================================
# SERVER CONFIGURATION
# ============================================
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:4200

# ============================================
# JWT CONFIGURATION
# ============================================
# Generate with: openssl rand -hex 32
JWT_SECRET=dev-jwt-secret-change-in-production
JWT_EXPIRATION=7d

# ============================================
# ADMIN API SECURITY
# ============================================
# Used for /api/v1/admin/* endpoints
ADMIN_API_KEY=dev-admin-key-change-in-production

# ============================================
# WORKOS AUTHENTICATION (Optional for basic dev)
# ============================================
# Get from: https://dashboard.workos.com/
WORKOS_API_KEY=sk_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
WORKOS_CLIENT_ID=client_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback

# ============================================
# PADDLE PAYMENT (Optional for basic dev)
# ============================================
# Get from: https://sandbox-vendors.paddle.com/
PADDLE_API_KEY=pdl_sbox_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_WEBHOOK_SECRET=pdl_ntfset_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_EARLY_ADOPTER=pri_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO=pri_YYYYYYYYYYYYYYYYYYYYYYYY

# ============================================
# EMAIL SERVICE (Optional for basic dev)
# ============================================
SENDGRID_API_KEY=SG.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SENDGRID_FROM_EMAIL=noreply@ptah.dev
SENDGRID_FROM_NAME=Ptah Team

# ============================================
# MAGIC LINK CONFIGURATION
# ============================================
MAGIC_LINK_TTL_MS=30000
```

**Note**: For basic development (license generation/verification), you only need:
- `DATABASE_URL` (handled by Docker Compose)
- `JWT_SECRET`
- `ADMIN_API_KEY`

WorkOS, Paddle, and SendGrid are optional unless testing those specific features.

---

## Prisma Database Migrations

Migrations run automatically when Docker Compose starts. For manual control:

### View Migration Status

```bash
# Check applied migrations
docker exec ptah_license_server npx prisma migrate status \
  --schema=apps/ptah-license-server/prisma/schema.prisma
```

### Run Migrations Manually

```bash
# Deploy pending migrations (production-safe)
docker exec ptah_license_server npx prisma migrate deploy \
  --schema=apps/ptah-license-server/prisma/schema.prisma

# Create new migration (development)
cd apps/ptah-license-server
npx prisma migrate dev --name your_migration_name
```

### Reset Database (Development Only)

```bash
# WARNING: This deletes all data
docker exec ptah_license_server npx prisma migrate reset \
  --schema=apps/ptah-license-server/prisma/schema.prisma --force
```

### Prisma Studio (Database GUI)

```bash
# Open Prisma Studio in browser
cd apps/ptah-license-server
npx prisma studio
```

Opens at http://localhost:5555

---

## Generating Development Licenses

### Create a License via Admin API

```bash
curl -X POST http://localhost:3000/api/v1/admin/licenses \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-admin-key-change-in-production" \
  -d '{
    "email": "dev@localhost.local",
    "plan": "early_adopter",
    "sendEmail": false
  }'
```

### Expected Response

```json
{
  "success": true,
  "license": {
    "licenseKey": "PTAH-A1B2-C3D4-E5F6",
    "plan": "early_adopter",
    "status": "active",
    "expiresAt": "2026-03-22T12:00:00.000Z",
    "createdAt": "2026-01-22T12:00:00.000Z"
  },
  "emailSent": false
}
```

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User email (can be fake for dev) |
| `plan` | string | Yes | `"free"`, `"early_adopter"`, or `"pro"` |
| `sendEmail` | boolean | No | Set `false` to skip email |

### Plan Differences

| Plan | Expiration | Premium Features |
|------|------------|------------------|
| `free` | Never | No |
| `early_adopter` | 60 days | Yes |
| `pro` | 1 year | Yes |

---

## Testing Premium Features

### Verify a License

```bash
curl -X POST http://localhost:3000/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{ "licenseKey": "PTAH-A1B2-C3D4-E5F6" }'
```

### Activate in VS Code

1. Build and run the Ptah extension locally
2. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run: **Ptah: Enter License Key**
4. Paste the license key
5. Reload VS Code window

### Configure Extension for Local Server

Set the license server URL before launching VS Code:

```bash
# Bash/Zsh
export PTAH_LICENSE_SERVER_URL="http://localhost:3000"
code .

# PowerShell
$env:PTAH_LICENSE_SERVER_URL = "http://localhost:3000"
code .
```

Or in VS Code settings (`settings.json`):

```json
{
  "ptah.licenseServerUrl": "http://localhost:3000"
}
```

---

## Windows/WSL2 Recommendations

For optimal Docker performance on Windows:

### Use WSL2 Backend

1. **Enable WSL2**:
   ```powershell
   wsl --install -d Ubuntu
   ```

2. **Configure Docker Desktop**:
   - Settings > General > "Use WSL 2 based engine" (checked)
   - Settings > Resources > WSL Integration > Enable for Ubuntu

3. **Store project in WSL2 filesystem**:
   ```bash
   # Inside WSL2 terminal
   cd ~
   git clone https://github.com/your-org/ptah-extension.git
   cd ptah-extension
   docker-compose up -d
   ```

   **Important**: Projects stored in `/mnt/c/` (Windows filesystem) have significant I/O overhead. Store in `/home/user/` for 10x faster builds.

### Performance Comparison

| Location | Build Time | Hot Reload |
|----------|------------|------------|
| Windows (`C:\`) | ~60s | ~5s |
| WSL2 (`/home/`) | ~6s | <1s |

### Opening in VS Code

From WSL2 terminal:
```bash
code .
```

This opens VS Code with WSL extension, providing native Linux performance.

---

## Non-Docker Setup (Fallback)

If Docker is unavailable, run services natively:

### 1. Install PostgreSQL

```bash
# macOS
brew install postgresql@16
brew services start postgresql@16

# Ubuntu/Debian
sudo apt install postgresql-16
sudo systemctl start postgresql

# Windows: Download installer from https://www.postgresql.org/download/windows/
```

Create database:
```bash
createdb ptah_licenses
```

### 2. Install Redis

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl start redis

# Windows: Download from https://github.com/microsoftarchive/redis/releases
# Or use WSL2
```

### 3. Configure Environment

```bash
cd apps/ptah-license-server
cp .env.example .env.local

# Edit .env.local with local URLs:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"
# REDIS_URL="redis://localhost:6379"
```

### 4. Run Migrations

```bash
cd apps/ptah-license-server
npx prisma migrate dev
```

### 5. Start Server

```bash
# From project root
npx nx serve ptah-license-server
```

---

## Troubleshooting

### Docker Services Won't Start

```bash
# Check logs
docker-compose logs -f

# Check specific service
docker-compose logs -f postgres
docker-compose logs -f license-server

# Full rebuild
docker-compose down -v
docker-compose up -d --build
```

### Database Connection Refused

1. **Check PostgreSQL is healthy**:
   ```bash
   docker exec ptah_postgres pg_isready -U postgres
   ```

2. **Verify database exists**:
   ```bash
   docker exec ptah_postgres psql -U postgres -c "\l"
   ```

3. **Check connection string format**:
   ```
   postgresql://user:password@host:port/database
   ```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill process or change port in .env.docker
LICENSE_SERVER_PORT=3001
```

### License Server Crashes on Start

1. **Check migrations completed**:
   ```bash
   docker exec ptah_license_server npx prisma migrate status \
     --schema=apps/ptah-license-server/prisma/schema.prisma
   ```

2. **Check required env vars**:
   ```bash
   docker exec ptah_license_server env | grep -E "(DATABASE|JWT|ADMIN)"
   ```

3. **Manual start for debugging**:
   ```bash
   docker exec -it ptah_license_server sh
   npx nx serve ptah-license-server
   ```

### API Key Mismatch (401 Unauthorized)

1. Verify `ADMIN_API_KEY` in `.env.local`
2. Verify `X-API-Key` header matches exactly
3. Restart license server after changing env vars:
   ```bash
   docker-compose restart license-server
   ```

### Prisma Schema Out of Sync

```bash
# Regenerate Prisma client
docker exec ptah_license_server npx prisma generate \
  --schema=apps/ptah-license-server/prisma/schema.prisma

# Or restart container (generates on start)
docker-compose restart license-server
```

### Hot Reload Not Working

1. **Check volume mounts**:
   ```bash
   docker-compose config | grep volumes -A 10
   ```

2. **Verify file watching**:
   ```bash
   docker exec ptah_license_server ls -la /app/apps/ptah-license-server/src
   ```

3. **WSL2 users**: Ensure project is in WSL2 filesystem

---

## Quick Reference

### Start Everything

```bash
docker-compose up -d
```

### Stop Everything

```bash
docker-compose down
```

### Stop and Remove Data

```bash
docker-compose down -v
```

### View Logs

```bash
docker-compose logs -f
docker-compose logs -f license-server
```

### Restart Single Service

```bash
docker-compose restart license-server
```

### Create License

```bash
curl -X POST http://localhost:3000/api/v1/admin/licenses \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-admin-key-change-in-production" \
  -d '{"email":"dev@localhost.local","plan":"early_adopter","sendEmail":false}'
```

### Verify License

```bash
curl -X POST http://localhost:3000/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"PTAH-XXXX-XXXX-XXXX"}'
```

### Database Shell

```bash
docker exec -it ptah_postgres psql -U postgres -d ptah_licenses
```

### Redis Shell

```bash
docker exec -it ptah_redis redis-cli
```

### Prisma Studio

```bash
cd apps/ptah-license-server && npx prisma studio
```

---

**Document Version**: 2.0
**Last Updated**: 2026-01-22
**Author**: Backend Developer (Orchestration Workflow)
