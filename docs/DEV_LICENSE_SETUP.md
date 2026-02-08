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

  - Windows: <https://docs.docker.com/desktop/install/windows-install/>
  - macOS: <https://docs.docker.com/desktop/install/mac-install/>
  - Linux: <https://docs.docker.com/desktop/install/linux-install/>

- **Node.js 20+** (for running scripts outside Docker)

  - <https://nodejs.org/>

- **Git** for cloning the repository

### Optional (for non-Docker setup)

- **PostgreSQL 16** running locally

---

## Quick Start (Docker)

The fastest way to get the license server running locally:

```bash
# 1. Clone the repository (if not already done)
git clone https://github.com/your-org/ptah-extension.git
cd ptah-extension

# 2. Install dependencies
npm install

# 3. Copy environment file
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env

# 4. Start PostgreSQL (local container)
docker compose up -d postgres

# 5. Wait for PostgreSQL to be healthy (about 5-10 seconds)
docker compose ps

# 6. Start all services (PostgreSQL + license server)
docker compose up -d
```

**Expected output after step 5:**

```
NAME                     STATUS                   PORTS
ptah_postgres            running (healthy)        0.0.0.0:5432->5432/tcp
ptah_license_server      running                  0.0.0.0:3000->3000/tcp
```

**Verify the server is running:**

```bash
curl http://localhost:3000/api
```

---

## Service URLs and Health Checks

After starting Docker Compose, the following services are available:

| Service            | URL                     | Health Check                                   |
| ------------------ | ----------------------- | ---------------------------------------------- |
| **License Server** | <http://localhost:3000> | `curl http://localhost:3000/api`               |
| **PostgreSQL**     | localhost:5432          | `docker exec ptah_postgres pg_isready -U ptah` |

### API Endpoints

| Endpoint                  | Method | Description                                  |
| ------------------------- | ------ | -------------------------------------------- |
| `/api`                    | GET    | Health check, returns `{ "message": "..." }` |
| `/api/v1/licenses/verify` | POST   | Verify license key                           |
| `/api/v1/admin/licenses`  | POST   | Create license (requires API key)            |
| `/auth/login`             | GET    | Initiate WorkOS login flow                   |
| `/auth/callback`          | GET    | WorkOS OAuth callback                        |
| `/webhooks/paddle`        | POST   | Paddle webhook endpoint                      |

---

## Environment Setup

### License Server Environment (.env)

Located at `apps/ptah-license-server/.env`. Copy from `.env.example`:

```bash
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env
```

The key database configuration:

```env
# ============================================
# DATABASE CONFIGURATION (Local PostgreSQL)
# ============================================
# Docker Compose starts PostgreSQL automatically.
# This URL is for running the server OUTSIDE Docker (e.g., nx serve).
#
# Inside Docker, DATABASE_URL is overridden by docker-compose.yml to point
# to the PostgreSQL container.
#
DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db"
```

**Note**: When running via `docker compose up`, the `DATABASE_URL` is overridden by docker-compose.yml to use the internal Docker network hostname (`postgres` instead of `localhost`). The `.env` value is only used when running the server directly with `nx serve ptah-license-server`.

### Docker Compose Environment Variables

The docker-compose.yml file uses these environment variable overrides (you can customize them via a root `.env` file):

```env
# Port overrides (optional, defaults shown)
POSTGRES_PORT=5432
LICENSE_SERVER_PORT=3000
```

**Note**: For basic development (license generation/verification), you only need:

- `DATABASE_URL` (handled automatically by Docker Compose)
- `JWT_SECRET`
- `ADMIN_API_KEY`

WorkOS, Paddle, and Resend are optional unless testing those specific features.

---

## Prisma Database Migrations

Migrations run automatically when Docker Compose starts the license server. For manual control:

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

Opens at <http://localhost:5555>

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

| Parameter   | Type    | Required | Description                             |
| ----------- | ------- | -------- | --------------------------------------- |
| `email`     | string  | Yes      | User email (can be fake for dev)        |
| `plan`      | string  | Yes      | `"free"`, `"early_adopter"`, or `"pro"` |
| `sendEmail` | boolean | No       | Set `false` to skip email               |

### Plan Differences

| Plan            | Expiration | Premium Features |
| --------------- | ---------- | ---------------- |
| `free`          | Never      | No               |
| `early_adopter` | 60 days    | Yes              |
| `pro`           | 1 year     | Yes              |

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
   docker compose up -d
   ```

   **Important**: Projects stored in `/mnt/c/` (Windows filesystem) have significant I/O overhead. Store in `/home/user/` for 10x faster builds.

### Performance Comparison

| Location        | Build Time | Hot Reload |
| --------------- | ---------- | ---------- |
| Windows (`C:\`) | ~60s       | ~5s        |
| WSL2 (`/home/`) | ~6s        | <1s        |

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

Create database and user:

```bash
# Create the database user and database
psql -U postgres -c "CREATE USER ptah WITH PASSWORD 'ptah_dev_password';"
psql -U postgres -c "CREATE DATABASE ptah_db OWNER ptah;"
```

### 2. Configure Environment

```bash
cd apps/ptah-license-server
cp .env.example .env

# The default DATABASE_URL in .env.example already points to local PostgreSQL:
# DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db"
```

### 3. Run Migrations

```bash
cd apps/ptah-license-server
npx prisma migrate dev
```

### 4. Start Server

```bash
# From project root
npx nx serve ptah-license-server
```

---

## Troubleshooting

### Docker Services Won't Start

```bash
# Check logs
docker compose logs -f

# Check specific service
docker compose logs -f postgres
docker compose logs -f license-server

# Full rebuild
docker compose down -v
docker compose up -d --build
```

### Database Connection Refused

1. **Check PostgreSQL is healthy**:

   ```bash
   docker exec ptah_postgres pg_isready -U ptah
   ```

2. **Verify database exists**:

   ```bash
   docker exec ptah_postgres psql -U ptah -d ptah_db -c "\l"
   ```

3. **Check connection string format**:

   ```
   postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db
   ```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill process or change port via environment variable
LICENSE_SERVER_PORT=3001 docker compose up -d
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

1. Verify `ADMIN_API_KEY` in `.env`
2. Verify `X-API-Key` header matches exactly
3. Restart license server after changing env vars:

   ```bash
   docker compose restart license-server
   ```

### Prisma Schema Out of Sync

```bash
# Regenerate Prisma client
docker exec ptah_license_server npx prisma generate \
  --schema=apps/ptah-license-server/prisma/schema.prisma

# Or restart container (generates on start)
docker compose restart license-server
```

### Hot Reload Not Working

1. **Check volume mounts**:

   ```bash
   docker compose config | grep volumes -A 10
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
docker compose up -d
```

### Start Only PostgreSQL (for running server via nx serve)

```bash
npm run docker:db:start
```

### Stop Everything

```bash
docker compose down
```

### Stop and Remove Data

```bash
docker compose down -v
```

### View Logs

```bash
docker compose logs -f
docker compose logs -f license-server
```

### Restart Single Service

```bash
docker compose restart license-server
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
docker exec -it ptah_postgres psql -U ptah -d ptah_db
```

### Prisma Studio

```bash
cd apps/ptah-license-server && npx prisma studio
```

---

**Document Version**: 3.0
**Last Updated**: 2026-02-08
**Author**: DevOps Engineer (Orchestration Workflow)
