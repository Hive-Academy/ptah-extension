# Local Development Setup

This guide explains how to set up the Ptah License Server for local development.

## Quick Start

Choose your preferred database option:

### Option 1: Local Docker PostgreSQL (Recommended for Offline Work)

```bash
# 1. Start PostgreSQL container
docker-compose -f docker-compose.db.yml up -d

# 2. Copy and configure environment
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env
# Ensure DATABASE_URL points to localhost (default)

# 3. Run migrations
cd apps/ptah-license-server
npx prisma migrate dev

# 4. Start the server
npx nx serve ptah-license-server
```

### Option 2: Neon Cloud Database (Recommended for Cloud-First)

```bash
# 1. Create Neon account and project at https://neon.tech (free)

# 2. Copy and configure environment
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env

# 3. Update DATABASE_URL with your Neon connection string
# DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# 4. Run migrations
cd apps/ptah-license-server
npx prisma migrate dev

# 5. Start the server
npx nx serve ptah-license-server
```

---

## Database Options Comparison

| Feature                | Local Docker  | Neon Cloud               |
| ---------------------- | ------------- | ------------------------ |
| **Setup Time**         | ~2 minutes    | ~5 minutes               |
| **Works Offline**      | Yes           | No                       |
| **Persistence**        | Docker volume | Cloud (always available) |
| **Cold Starts**        | None          | ~500ms after 5min idle   |
| **Cost**               | Free (local)  | Free tier available      |
| **Matches Production** | No            | Yes (same provider)      |
| **Team Sharing**       | No            | Yes (shared database)    |

**Recommendation:**

- Use **Local Docker** for day-to-day development and offline work
- Use **Neon** when testing production-like behavior or sharing data

---

## Detailed Setup: Local Docker PostgreSQL

### Prerequisites

- Docker Desktop installed
- Node.js 20+

### Step 1: Start Database

```bash
# Start only PostgreSQL (Redis not needed)
docker-compose -f docker-compose.db.yml up -d

# Verify it's running
docker ps
# Should show: ptah_postgres_dev
```

### Step 2: Configure Environment

```bash
# Copy example environment file
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env
```

The default `DATABASE_URL` in `.env.example` already points to localhost:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"
```

### Step 3: Run Migrations

```bash
cd apps/ptah-license-server
npx prisma migrate dev --name init
```

### Step 4: Start Development Server

```bash
npx nx serve ptah-license-server
```

Access the API at: http://localhost:3000/api

### Useful Commands

```bash
# View database in Prisma Studio
cd apps/ptah-license-server
npx prisma studio

# Stop database
docker-compose -f docker-compose.db.yml down

# Stop and delete all data
docker-compose -f docker-compose.db.yml down -v

# View logs
docker-compose -f docker-compose.db.yml logs -f
```

---

## Detailed Setup: Neon Cloud Database

### Prerequisites

- Neon account (free at https://neon.tech)
- Node.js 20+

### Step 1: Create Neon Project

1. Go to https://console.neon.tech
2. Click **"New Project"**
3. Configure:
   - **Project name**: `ptah-dev` (or your preference)
   - **Region**: Choose closest to you
   - **PostgreSQL version**: 16
4. Click **"Create Project"**

### Step 2: Get Connection String

1. In Neon dashboard, go to **Connection Details**
2. Select **Prisma** from the dropdown
3. Copy the connection string:
   ```
   postgresql://neondb_owner:xxx@ep-xxx-xxx-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

### Step 3: Configure Environment

```bash
# Copy example environment file
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env

# Edit .env and replace DATABASE_URL with your Neon connection string
```

Your `.env` should have:

```
DATABASE_URL="postgresql://neondb_owner:xxx@ep-xxx-xxx-123456.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

### Step 4: Run Migrations

```bash
cd apps/ptah-license-server
npx prisma migrate dev --name init
```

### Step 5: Start Development Server

```bash
npx nx serve ptah-license-server
```

### Neon Free Tier Limits

- **0.5 GB** storage
- **100 compute hours/month**
- Auto-suspend after **5 minutes** of inactivity
- 10 branches per project

### Handling Cold Starts

Neon's free tier auto-suspends after 5 minutes of inactivity. The first request after suspension takes ~500ms-2s to "wake up" the database.

This is fine for development. In production, you can:

- Keep compute always-on (Neon Launch tier)
- Implement retry logic (Prisma does this automatically)

---

## Full Stack Development

### Running Backend + Frontend Together

```bash
# Terminal 1: Start database
docker-compose -f docker-compose.db.yml up -d

# Terminal 2: Start license server
npx nx serve ptah-license-server

# Terminal 3: Start landing page (if needed)
npx nx serve ptah-landing-page
```

### Environment Variables

Essential variables for local development:

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"

# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:4200

# Security (generate with: openssl rand -hex 32)
JWT_SECRET=dev_secret_change_in_production_abc123
ADMIN_API_KEY=dev_admin_key_change_in_production_xyz789

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

## Testing Webhooks Locally

Paddle webhooks require a public HTTPS URL. Use ngrok to expose your local server:

```bash
# Start services with ngrok profile
docker-compose --profile webhook-testing up -d

# Get the ngrok URL
docker-compose logs ngrok | grep "started tunnel"
# Output: https://abc123.ngrok.io

# Configure in Paddle dashboard:
# Webhook URL: https://abc123.ngrok.io/webhooks/paddle
```

---

## Troubleshooting

### Database Connection Failed

**Symptom**: "Connection refused" or "ECONNREFUSED"

**Solutions**:

1. Verify Docker is running: `docker ps`
2. Check database container: `docker-compose -f docker-compose.db.yml logs`
3. Verify DATABASE_URL in `.env`

### Prisma Migration Errors

**Symptom**: "Migration failed" or "Database does not exist"

**Solutions**:

```bash
# Reset database (WARNING: deletes all data)
cd apps/ptah-license-server
npx prisma migrate reset

# Or recreate from scratch
docker-compose -f docker-compose.db.yml down -v
docker-compose -f docker-compose.db.yml up -d
npx prisma migrate dev
```

### Port Already in Use

**Symptom**: "Port 5432 already in use" or "Port 3000 already in use"

**Solutions**:

```bash
# Change PostgreSQL port in .env
POSTGRES_PORT=5433

# Or find and kill the process
# Windows:
netstat -ano | findstr :5432
taskkill /PID <pid> /F

# macOS/Linux:
lsof -i :5432
kill -9 <pid>
```

### Neon Cold Start Timeout

**Symptom**: First request after idle times out

**Solutions**:

- This is expected behavior on free tier
- Retry the request (Prisma handles this automatically)
- For testing, send a simple query first to "wake up" the database

---

## Scripts Reference

| Script                                           | Purpose                                          |
| ------------------------------------------------ | ------------------------------------------------ |
| `./setup-database.sh`                            | Start local Docker PostgreSQL and run migrations |
| `./setup-database.sh --neon`                     | Run migrations against Neon cloud database       |
| `docker-compose -f docker-compose.db.yml up -d`  | Start only PostgreSQL                            |
| `docker-compose up -d`                           | Start PostgreSQL + License Server                |
| `docker-compose --profile with-redis up -d`      | Start with Redis (multi-instance testing)        |
| `docker-compose --profile webhook-testing up -d` | Start with ngrok tunnel                          |

---

## Next Steps

1. Configure [WorkOS](https://dashboard.workos.com) for authentication
2. Configure [Paddle Sandbox](https://sandbox-vendors.paddle.com) for payments
3. Review [DIGITALOCEAN.md](./deployment/DIGITALOCEAN.md) for production deployment
