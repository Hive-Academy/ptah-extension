# Development Workflow Guide

## Two Development Modes

### Mode 1: Databases Only (Recommended for Development)

Run databases in Docker, run the application locally for fast hot-reload.

**Advantages:**

- ✅ Faster hot-reload (no Docker overhead)
- ✅ Easy debugging with breakpoints
- ✅ Direct access to logs
- ✅ Can create migrations easily

**Start databases:**

```bash
docker-compose -f docker-compose.db.yml up -d
```

**Check database health:**

```bash
docker-compose -f docker-compose.db.yml ps
```

**Stop databases:**

```bash
docker-compose -f docker-compose.db.yml down
```

**Stop and remove all data:**

```bash
docker-compose -f docker-compose.db.yml down -v
```

### Mode 2: Full Stack (All in Docker)

Run everything (databases + application) in Docker.

**Advantages:**

- ✅ Matches production environment exactly
- ✅ No local Node.js dependencies needed
- ✅ Isolated from host machine

**Start everything:**

```bash
docker-compose up -d
```

**Stop everything:**

```bash
docker-compose down
```

## Prisma Migration Workflow

### Creating Migrations (Development)

**Prerequisites:** Database must be running

#### Option A: Using Database-Only Docker (Recommended)

```bash
# 1. Start databases only
docker-compose -f docker-compose.db.yml up -d

# 2. Ensure .env has localhost URLs uncommented
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"
# REDIS_URL="redis://localhost:6379"

# 3. Create migration
cd apps/ptah-license-server
npx prisma migrate dev --name add_user_table

# 4. Migration is automatically applied and Prisma Client regenerated
```

#### Option B: Using Full Docker Stack

```bash
# 1. Exec into running container
docker exec -it ptah_license_server sh

# 2. Navigate to app directory
cd apps/ptah-license-server

# 3. Create migration
npx prisma migrate dev --name add_user_table

# 4. Exit container
exit
```

### Applying Migrations (Production/Docker)

Migrations are automatically applied when the Docker container starts:

```bash
docker-compose up
# Runs: npx prisma migrate deploy && npx prisma generate
```

## Common Workflows

### 1. Initial Setup (First Time)

```bash
# 1. Copy environment files
cp .env.docker.example .env
cp apps/ptah-license-server/.env.example apps/ptah-license-server/.env

# 2. Start databases
docker-compose -f docker-compose.db.yml up -d

# 3. Wait for health checks
docker-compose -f docker-compose.db.yml ps
# Should show: healthy

# 4. Create initial migration
cd apps/ptah-license-server
npx prisma migrate dev --name init

# 5. Start the application locally
npx nx serve ptah-license-server
```

### 2. Daily Development

```bash
# 1. Start databases (if not running)
docker-compose -f docker-compose.db.yml up -d

# 2. Run the application
cd apps/ptah-license-server
npx nx serve ptah-license-server

# 3. Make changes to schema.prisma
# (edit schema...)

# 4. Create migration
npx prisma migrate dev --name add_new_field

# 5. Prisma Client is automatically regenerated
```

### 3. Testing Full Docker Stack

```bash
# 1. Stop database-only containers (if running)
docker-compose -f docker-compose.db.yml down

# 2. Start full stack
docker-compose up --build

# 3. Watch logs
docker-compose logs -f license-server

# 4. Stop when done
docker-compose down
```

### 4. Resetting Database

```bash
# Option A: Using database-only mode
docker-compose -f docker-compose.db.yml down -v
docker-compose -f docker-compose.db.yml up -d
cd apps/ptah-license-server
npx prisma migrate dev

# Option B: Using full docker
docker-compose down -v
docker-compose up --build
```

## Environment Configuration

### For Database-Only Mode (Local Development)

**File:** `apps/ptah-license-server/.env`

```bash
# UNCOMMENT these for local development
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"
REDIS_URL="redis://localhost:6379"
```

### For Full Docker Mode

**File:** `apps/ptah-license-server/.env`

```bash
# COMMENT OUT these for Docker mode
# DATABASE_URL is set by docker-compose.yml
# REDIS_URL is set by docker-compose.yml
```

The `docker-compose.yml` automatically overrides these with Docker network hostnames:

- `postgres:5432` instead of `localhost:5432`
- `redis:6379` instead of `localhost:6379`

## Prisma Commands Reference

### Migrations

```bash
# Create a new migration
npx prisma migrate dev --name migration_name

# Apply pending migrations
npx prisma migrate deploy

# Reset database (DANGER: deletes all data)
npx prisma migrate reset

# Check migration status
npx prisma migrate status
```

### Database Management

```bash
# Open Prisma Studio (GUI)
npx prisma studio

# Generate Prisma Client
npx prisma generate

# Validate schema
npx prisma validate

# Format schema file
npx prisma format
```

### Introspection

```bash
# Pull schema from existing database
npx prisma db pull

# Push schema changes without migration
npx prisma db push
```

## Troubleshooting

### "Can't reach database server"

**Cause:** Database not running or wrong URL

**Fix:**

```bash
# Check if database is running
docker-compose -f docker-compose.db.yml ps

# Check DATABASE_URL in .env
# For local dev: localhost:5432
# For Docker: postgres:5432
```

### "Migration file not found"

**Cause:** No migrations directory

**Fix:** Create initial migration

```bash
cd apps/ptah-license-server
npx prisma migrate dev --name init
```

### "Prisma Client did not initialize yet"

**Cause:** Client not generated

**Fix:**

```bash
npx prisma generate
```

### Docker container fails with migration error

**Cause:** Migrations created on host, not committed to git

**Fix:**

```bash
# 1. Ensure migrations directory is committed
git add apps/ptah-license-server/prisma/migrations
git commit -m "Add database migrations"

# 2. Rebuild Docker image
docker-compose build --no-cache license-server
docker-compose up
```

## Best Practices

✅ **DO:**

- Use database-only mode for active development
- Create migrations with descriptive names
- Commit migration files to git
- Test migrations in Docker before deploying
- Use Prisma Studio for quick database inspection

❌ **DON'T:**

- Manually edit migration files (use `prisma migrate dev`)
- Delete migration files (unless you reset the entire migration history)
- Run `prisma db push` in production (use `migrate deploy`)
- Commit `.env` to git (contains secrets)
- Mix localhost and Docker network hostnames

## Quick Reference

| Task                 | Command                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Start databases only | `docker-compose -f docker-compose.db.yml up -d`                                                    |
| Start full stack     | `docker-compose up -d`                                                                             |
| Stop databases only  | `docker-compose -f docker-compose.db.yml down`                                                     |
| Stop full stack      | `docker-compose down`                                                                              |
| Create migration     | `npx prisma migrate dev --name NAME`                                                               |
| Apply migrations     | `npx prisma migrate deploy`                                                                        |
| Open Prisma Studio   | `npx prisma studio`                                                                                |
| View logs            | `docker-compose logs -f license-server`                                                            |
| Reset database       | `docker-compose -f docker-compose.db.yml down -v && docker-compose -f docker-compose.db.yml up -d` |
