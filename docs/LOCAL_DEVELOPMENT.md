# Local Development Setup

This guide explains how to set up the Ptah License Server for local development using **Neon PostgreSQL** (cloud database).

## Quick Start

```bash
# 1. Create Neon account and get connection string (see below)

# 2. Configure environment
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env
# Edit .env and set DATABASE_URL to your Neon connection string

# 3. Run migrations
cd apps/ptah-license-server
npx prisma migrate dev

# 4. Start the server
npx nx serve ptah-license-server
# Or with Docker: docker-compose up -d
```

---

## Why Neon?

We use **Neon PostgreSQL** for both development and production:

| Benefit                  | Description                                   |
| ------------------------ | --------------------------------------------- |
| **Free Tier**            | 0.5GB storage, 100 compute hours/month        |
| **Database Branching**   | Create isolated dev/staging/prod environments |
| **No Local Setup**       | No Docker PostgreSQL container needed         |
| **Same as Production**   | Dev environment matches production exactly    |
| **Instant Provisioning** | New branches in seconds                       |

---

## Step 1: Create Neon Account

1. Go to https://neon.tech and sign up (free)
2. Click **"New Project"**
3. Configure:
   - **Project name**: `ptah-licenses`
   - **Region**: Choose closest to you (e.g., `us-east-1`)
   - **PostgreSQL version**: 16
4. Click **"Create Project"**

## Step 2: Create Development Branch

Neon's branching feature lets you create isolated database copies:

1. In your Neon project, go to **Branches**
2. You'll see a `main` branch (this will be production)
3. Click **"New Branch"**
4. Name it `development`
5. This creates an instant copy of your database

**Recommended Branch Structure:**

```
main           → Production (ptah.live)
development    → Local development
staging        → Pre-production testing (optional)
```

## Step 3: Get Connection String

1. Go to **Connection Details** in Neon dashboard
2. Select your `development` branch
3. Choose **Prisma** from the dropdown
4. Copy the connection string:
   ```
   postgresql://neondb_owner:xxxx@ep-xxx-xxx-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

## Step 4: Configure Environment

```bash
# Copy example environment file
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env

# Edit .env and replace DATABASE_URL with your Neon connection string
```

Your `.env` should have:

```env
DATABASE_URL="postgresql://neondb_owner:xxxx@ep-xxx-xxx-123456.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

## Step 5: Run Migrations

```bash
cd apps/ptah-license-server
npx prisma migrate dev
```

## Step 6: Start Development Server

**Option A: Without Docker (recommended for faster iteration)**

```bash
npx nx serve ptah-license-server
```

**Option B: With Docker (includes hot-reload)**

```bash
docker-compose up -d
```

Access the API at: http://localhost:3000/api

---

## Docker Compose Setup

The `docker-compose.yml` provides:

- **License Server** with hot-reload
- **ngrok** for Paddle webhook testing (optional)

### Basic Usage

```bash
# Start license server
docker-compose up -d

# View logs
docker-compose logs -f license-server

# Stop
docker-compose down
```

### With Webhook Testing (Paddle)

```bash
# 1. Set ngrok authtoken in root .env
NGROK_AUTHTOKEN=your_token_here

# 2. Start with ngrok
docker-compose --profile webhook-testing up -d

# 3. Get public URL
docker-compose logs ngrok | grep "url="
# Output: https://abc123.ngrok.io

# 4. Configure Paddle webhook
# URL: https://abc123.ngrok.io/webhooks/paddle
```

---

## Environment Variables

Essential variables for local development:

```env
# Database (Neon - REQUIRED)
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:4200

# Security (generate with: openssl rand -hex 32)
JWT_SECRET=dev_secret_change_in_production
ADMIN_API_KEY=dev_admin_key_change_in_production

# WorkOS (get from https://dashboard.workos.com)
WORKOS_API_KEY=sk_test_xxx
WORKOS_CLIENT_ID=client_xxx
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Paddle (get from https://sandbox-vendors.paddle.com)
PADDLE_API_KEY=pdl_sbox_xxx
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxx
PADDLE_PRICE_ID_PRO_MONTHLY=pri_xxx
PADDLE_PRICE_ID_PRO_YEARLY=pri_xxx

# SendGrid (optional for local dev)
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=test@example.com
SENDGRID_FROM_NAME=Ptah Dev
```

---

## Neon Tips

### Cold Starts

Neon's free tier auto-suspends after 5 minutes of inactivity. First request after suspension takes ~500ms-2s.

**This is fine for development.** Prisma handles reconnection automatically.

### Database Branching Workflow

```bash
# Create a feature branch for testing schema changes
# 1. In Neon dashboard: Create branch "feature-xyz" from "development"
# 2. Update DATABASE_URL to use the new branch
# 3. Run migrations: npx prisma migrate dev
# 4. Test your changes
# 5. Merge by promoting the branch or running migrations on development
```

### Viewing Data

```bash
# Open Prisma Studio (web-based database viewer)
cd apps/ptah-license-server
npx prisma studio
```

Or use Neon's built-in SQL editor in the dashboard.

---

## Troubleshooting

### Database Connection Failed

**Symptom**: "Connection refused" or timeout errors

**Solutions**:

1. Verify DATABASE_URL is correct
2. Ensure `?sslmode=require` is in the connection string
3. Check Neon dashboard - is the branch active?
4. Try the connection in Neon's SQL editor first

### Prisma Migration Errors

**Symptom**: "Migration failed" or schema drift

**Solutions**:

```bash
# Check migration status
cd apps/ptah-license-server
npx prisma migrate status

# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Generate client after schema changes
npx prisma generate
```

### Cold Start Timeout

**Symptom**: First request after idle times out

**Solutions**:

- This is expected on free tier
- Retry the request (Prisma handles this automatically)
- For faster cold starts, keep a tab open to the Neon dashboard

### Port Already in Use

**Symptom**: "Port 3000 already in use"

**Solutions**:

```bash
# Change port in .env
PORT=3001

# Or find and kill the process
# Windows:
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# macOS/Linux:
lsof -i :3000
kill -9 <pid>
```

---

## Scripts Reference

| Command                                          | Purpose                          |
| ------------------------------------------------ | -------------------------------- |
| `npx nx serve ptah-license-server`               | Start server locally (no Docker) |
| `docker-compose up -d`                           | Start server in Docker           |
| `docker-compose --profile webhook-testing up -d` | Start with ngrok                 |
| `docker-compose logs -f license-server`          | View server logs                 |
| `docker-compose down`                            | Stop all containers              |
| `npx prisma migrate dev`                         | Create/apply migrations          |
| `npx prisma studio`                              | Open database viewer             |

---

## Next Steps

1. Configure [WorkOS](https://dashboard.workos.com) for authentication
2. Configure [Paddle Sandbox](https://sandbox-vendors.paddle.com) for payments
3. Review [DIGITALOCEAN.md](./deployment/DIGITALOCEAN.md) for production deployment
