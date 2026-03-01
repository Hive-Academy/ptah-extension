# Database Migrations for NestJS Deployment

## Overview

Database migrations ensure the production schema matches what the application code expects. This guide covers Prisma migration strategy across environments, the PrismaService pattern for NestJS, and safe deployment workflows.

---

## Migration Strategy by Environment

| Environment | Command                                      | Behavior                                               |
| ----------- | -------------------------------------------- | ------------------------------------------------------ |
| Development | `prisma migrate dev --name descriptive_name` | Creates new migration, applies it, regenerates client  |
| Staging     | `prisma migrate deploy`                      | Applies pending migrations, no prompts, no new files   |
| Production  | `prisma migrate deploy`                      | Same as staging - applies pending, safe for automation |
| CI/CD       | `prisma migrate deploy`                      | Validates migrations apply cleanly                     |

### Key Difference: `dev` vs `deploy`

- **`migrate dev`**: Interactive, creates migration files, may reset DB if drift detected. Never use in production.
- **`migrate deploy`**: Non-interactive, only applies existing migration files, never creates or modifies them. Safe for automation.

---

## Migration on Deploy

### Docker CMD Pattern

The most reliable approach is running migrations as part of the container startup command:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node main.js"]
```

This ensures:

1. Migrations run before the application starts accepting requests
2. If migration fails, the app does not start (container exits, orchestrator alerts)
3. No separate migration job to manage

### Why Not a Separate Migration Step?

| Approach             | Pros                        | Cons                                                       |
| -------------------- | --------------------------- | ---------------------------------------------------------- |
| CMD in Dockerfile    | Simple, atomic, always runs | Adds 2-5s to startup                                       |
| Init container (K8s) | Runs once per deployment    | Requires Kubernetes, extra config                          |
| CI/CD pipeline step  | Runs before deploy          | Timing issues if deploy happens before migration completes |
| Manual               | Full control                | Human error, forgotten in emergencies                      |

For most NestJS deployments, the CMD pattern is the right choice. Only switch to init containers if you have Kubernetes and need migration to run exactly once across multiple replicas.

---

## Prisma Configuration (Prisma 7+)

Prisma 7 introduced `prisma.config.ts` as the central configuration file.

```typescript
// apps/my-api/prisma.config.ts
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables for local development
// Docker and CI environments set DATABASE_URL directly
config({ path: resolve(__dirname, '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] || '',
  },
});
```

### Prisma Schema Location

```
apps/my-api/
  prisma.config.ts          # Prisma 7+ config (at app root)
  prisma/
    schema.prisma            # Schema definition
    migrations/              # Generated migration SQL files
      20240101_init/
        migration.sql
      20240115_add_subscriptions/
        migration.sql
  src/
    generated-prisma-client/ # Generated client (custom output path)
```

### Prisma 7 CLI Commands

All Prisma CLI commands must run from the directory containing `prisma.config.ts`:

```bash
# From apps/my-api/
cd apps/my-api

# Generate client
npx prisma generate

# Create migration
npx prisma migrate dev --name add_user_preferences

# Apply pending migrations (production)
npx prisma migrate deploy

# Check migration status
npx prisma migrate status

# Open database GUI
npx prisma studio
```

---

## PrismaService Pattern

### Service Implementation

```typescript
// src/prisma/prisma.service.ts
import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated-prisma-client/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Prisma 7 driver adapter pattern for PostgreSQL
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', (error as Error).stack);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
```

### Module Registration

```typescript
// src/prisma/prisma.module.ts
import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### Why Extend PrismaClient?

By extending `PrismaClient`, you can inject `PrismaService` and use it exactly like `PrismaClient`:

```typescript
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findUser(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async createWithTransaction(data: CreateUserDto) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      await tx.auditLog.create({
        data: { action: 'USER_CREATED', entityId: user.id },
      });
      return user;
    });
  }
}
```

---

## Migration Development Workflow

### Step 1: Modify Schema

```prisma
// prisma/schema.prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  // NEW: Add preferences
  timezone  String   @default("UTC")
  locale    String   @default("en")
}
```

### Step 2: Create Migration

```bash
cd apps/my-api
npx prisma migrate dev --name add_user_preferences
```

This creates:

```
prisma/migrations/20240215120000_add_user_preferences/
  migration.sql
```

### Step 3: Review Generated SQL

Always review the generated SQL before committing:

```sql
-- prisma/migrations/20240215120000_add_user_preferences/migration.sql
ALTER TABLE "User" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
```

### Step 4: Commit Migration Files

```bash
git add prisma/migrations/20240215120000_add_user_preferences/
git add prisma/schema.prisma
git commit -m "feat(db): add user preferences (timezone, locale)"
```

### Step 5: Deploy

CI/CD or Docker CMD runs `prisma migrate deploy`, which applies the new migration.

---

## Rollback Strategy

Prisma does not support automatic rollback. Three options:

1. **Forward migration** (recommended): Revert schema changes, create a new migration with `prisma migrate dev --name revert_change`
2. **Manual SQL**: Apply reverse DDL directly, update `_prisma_migrations` table
3. **Blue-green deployment**: Keep old version running, deploy new version to separate instances, switch traffic only after verification

---

## Migration Safety Rules

### Do

- Always use `migrate deploy` in production (never `migrate dev`)
- Review generated SQL before committing
- Test migrations on a staging database first
- Keep migrations small and focused (one logical change per migration)
- Use `@default()` for new required columns to avoid breaking existing rows
- Commit migration files to version control

### Do Not

- Never edit committed migration files (Prisma checksums will fail)
- Never delete migrations that have been applied to production
- Never run `prisma migrate reset` in production (drops all data)
- Never add a required column without a default value (breaks existing rows)
- Never rename columns directly (create new, migrate data, drop old)

---

## Handling Large Migrations

For schema changes on large tables, use an additive-then-destructive approach: add new column with default, deploy code that writes to it, backfill existing rows, deploy code that reads from it, then drop the old column. This prevents downtime and data loss.

For tables with millions of rows, add indexes using `CREATE INDEX CONCURRENTLY` in a custom migration SQL file to avoid locking the table.
