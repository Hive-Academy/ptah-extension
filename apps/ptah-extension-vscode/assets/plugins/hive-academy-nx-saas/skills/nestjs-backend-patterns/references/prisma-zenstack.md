# Prisma + ZenStack Setup in Nx

## Overview

Prisma provides type-safe database access. ZenStack extends Prisma with declarative access policies defined in the schema.

## Setup

### 1. Create Database Library

```bash
# Create the library
nx g @nx/js:lib database --unitTestRunner=none --bundler=none

# Install dependencies
npm install prisma @prisma/client @zenstackhq/runtime
npm install -D zenstack @nx-tools/nx-prisma
```

### 2. Initialize Prisma and ZenStack

```bash
cd libs/database
npx prisma init
npx zenstack init
cd ../..
```

### 3. Configure nx-tools/nx-prisma

Add targets to `libs/database/project.json`:

```json
{
  "name": "database",
  "targets": {
    "prisma-generate": {
      "executor": "@nx-tools/nx-prisma:generate",
      "options": {
        "schema": "libs/database/prisma/schema.prisma"
      }
    },
    "prisma-migrate": {
      "executor": "@nx-tools/nx-prisma:migrate",
      "options": {
        "schema": "libs/database/prisma/schema.prisma"
      }
    },
    "prisma-studio": {
      "executor": "@nx-tools/nx-prisma:studio",
      "options": {
        "schema": "libs/database/prisma/schema.prisma"
      }
    },
    "zenstack-generate": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx zenstack generate --schema=libs/database/schema.zmodel"
      }
    }
  }
}
```

### 4. Define Schema

```zmodel
// libs/database/schema.zmodel

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// Base model with audit fields
abstract model BaseModel {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User extends BaseModel {
  email         String              @unique
  name          String?
  memberships   OrganizationMember[]

  // Users can read their own profile
  @@allow('read', auth() == this)

  // Users can update their own profile
  @@allow('update', auth() == this)
}

model Organization extends BaseModel {
  name    String
  slug    String @unique
  members OrganizationMember[]

  // Anyone can create an organization
  @@allow('create', true)

  // Members can read
  @@allow('read', members?[user == auth()])

  // Admins can update/delete
  @@allow('update,delete', members?[user == auth() && role == 'ADMIN'])
}

model OrganizationMember extends BaseModel {
  organizationId String
  userId         String
  role           MemberRole @default(MEMBER)

  organization   Organization @relation(fields: [organizationId], references: [id])
  user           User         @relation(fields: [userId], references: [id])

  @@unique([organizationId, userId])

  // Members can read other members
  @@allow('read', organization.members?[user == auth()])

  // Admins can manage members
  @@allow('create,update,delete', organization.members?[user == auth() && role == 'ADMIN'])
}

enum MemberRole {
  ADMIN
  MEMBER
  VIEWER
}
```

### 5. Generate Client

```bash
# Generate ZenStack (creates Prisma schema + enhanced client)
nx zenstack-generate database

# Generate Prisma client
nx prisma-generate database

# Run migrations
nx prisma-migrate database --name init
```

## NestJS Integration

### Prisma Service

```typescript
// libs/shared/prisma-client/src/lib/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### Enhanced Prisma Service (with ZenStack)

```typescript
// libs/shared/prisma-client/src/lib/enhanced-prisma.service.ts
import { Injectable, Scope } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { enhance } from '@zenstackhq/runtime';
import { PrismaService } from './prisma.service';

@Injectable({ scope: Scope.REQUEST })
export class EnhancedPrismaService {
  constructor(private readonly prisma: PrismaService, private readonly cls: ClsService) {}

  /**
   * Returns an enhanced Prisma client that automatically
   * enforces access policies based on the current user context.
   */
  get client() {
    const user = this.cls.get<{ id: string } | null>('user');

    return enhance(this.prisma, {
      user: user ?? undefined,
    });
  }
}
```

### Module

```typescript
// libs/shared/prisma-client/src/lib/prisma-client.module.ts
import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { PrismaService } from './prisma.service';
import { EnhancedPrismaService } from './enhanced-prisma.service';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      middleware: { mount: true },
    }),
  ],
  providers: [PrismaService, EnhancedPrismaService],
  exports: [PrismaService, EnhancedPrismaService],
})
export class PrismaClientModule {}
```

## Access Policy Patterns

### Basic CRUD Policies

```zmodel
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])

  // Anyone can read published posts
  @@allow('read', published)

  // Authors can read their own posts (draft or published)
  @@allow('read', author == auth())

  // Only authenticated users can create
  @@allow('create', auth() != null && author == auth())

  // Authors can update their own posts
  @@allow('update', author == auth())

  // Authors can delete their own posts
  @@allow('delete', author == auth())
}
```

### Role-Based Policies

```zmodel
model Document {
  id             String       @id @default(cuid())
  title          String
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])

  // Viewers can read
  @@allow('read', organization.members?[user == auth()])

  // Members can create and update
  @@allow('create,update', organization.members?[user == auth() && role in ['ADMIN', 'MEMBER']])

  // Only admins can delete
  @@allow('delete', organization.members?[user == auth() && role == 'ADMIN'])
}
```

### Field-Level Policies

```zmodel
model User {
  id       String  @id @default(cuid())
  email    String  @unique
  name     String
  // Sensitive field - only readable by self
  phone    String? @allow('read', auth() == this)
  // Admin-only field
  isAdmin  Boolean @default(false) @allow('update', auth().isAdmin)

  @@allow('read', true)  // Anyone can read basic fields
  @@allow('update', auth() == this)  // Users update their own
}
```

## Nx Commands

```bash
# Generate after schema changes
nx zenstack-generate database
nx prisma-generate database

# Create migration
nx prisma-migrate database --name add_projects

# Deploy migrations (production)
nx prisma-migrate database -- deploy

# Open Prisma Studio
nx prisma-studio database

# Reset database (dev only!)
nx run database:prisma-migrate -- reset
```

## TypeScript Path Configuration

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "paths": {
      "@my-org/database": ["libs/database/src/index.ts"],
      "@my-org/shared/prisma-client": ["libs/shared/prisma-client/src/index.ts"]
    }
  }
}
```

## Environment Variables

```bash
# .env
DATABASE_URL="postgresql://user:password@localhost:5432/mydb?schema=public"

# For multiple environments
# .env.development
DATABASE_URL="postgresql://localhost:5432/mydb_dev"

# .env.production
DATABASE_URL="${DATABASE_URL}"  # From environment
```
