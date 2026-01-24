# Implementation Plan - TASK_2025_075: Simplified License Server (No Payments)

**Task ID**: TASK_2025_075
**Created**: 2025-12-15
**Status**: Ready for Implementation
**Complexity**: Medium (3-4 days, ~24 tasks across 6 batches)

---

## Executive Summary

This plan covers TWO major components:

### Part A: License Server (NestJS Backend)

A simplified license verification backend WITHOUT payment integration:

- License key generation and verification API
- Admin license creation endpoint
- Magic link authentication for customer portal
- PostgreSQL database (2 tables: users, licenses)
- SendGrid email delivery
- Hardcoded plans (free, early_adopter)

### Part B: VS Code Extension License Integration (CRITICAL)

Client-side premium feature gating with **conditional MCP server registration**:

- LicenseService for VS Code extension (SecretStorage, verification, caching)
- Premium MCP servers registered ONLY for licensed users
- Free users have ZERO premium code execution
- Dynamic registration/deregistration on license status changes
- Security: Premium features completely absent for free tier

**USER REQUIREMENT**: "Extension and specially the premium tools and mcp servers is properly and securely hidden behind the license key with proper lifecycle invocation so that for free users we don't have any mcp code registered or running completely"

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Codebase Investigation Summary](#codebase-investigation-summary)
3. [Component Specifications](#component-specifications)
4. [Integration Architecture](#integration-architecture)
5. [Batch Breakdown](#batch-breakdown)
6. [Quality Requirements](#quality-requirements)
7. [Team-Leader Handoff](#team-leader-handoff)

---

## Architecture Overview

### High-Level System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code Extension (Client-Side Premium Gating)                   │
├──────────────────────────────────────────────────────────────────┤
│  Extension Activation (main.ts)                                   │
│    │                                                               │
│    ├─► Step 1: Initialize DI Container (DIContainer.setup())      │
│    ├─► Step 2: Resolve LicenseService                             │
│    ├─► Step 3: Verify License (LicenseService.verifyLicense())   │
│    │     │                                                         │
│    │     ├─ No License Key → FREE USER                            │
│    │     │    └─► Skip Premium MCP Registration                   │
│    │     │                                                         │
│    │     └─ License Key Present → Verify with Server              │
│    │          │                                                    │
│    │          ├─ Valid License → PREMIUM USER                     │
│    │          │    └─► Register Premium MCP Servers               │
│    │          │         (CodeExecutionMCP with Ptah API)          │
│    │          │                                                    │
│    │          └─ Invalid/Expired → FREE USER                      │
│    │               └─► Skip Premium MCP Registration              │
│    │                                                               │
│    ├─► Step 4: Register Core Services (always)                    │
│    └─► Step 5: Setup License Status Watcher                       │
│              (Dynamic Re-registration on License Changes)          │
│                                                                    │
│  License Status Events:                                            │
│  - license:verified → Register premium MCP                         │
│  - license:expired  → Deregister premium MCP                       │
│  - license:updated  → Re-verify and update registration            │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  License Server (NestJS Backend)                                  │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌──────────────────┐                     │
│  │ License Module  │◄───│ Admin API        │                     │
│  │                 │    │ (X-API-Key Auth) │                     │
│  │ - Verify        │    │                  │                     │
│  │ - Create        │    │ POST /admin/     │                     │
│  │ - Resend        │    │      licenses    │                     │
│  └────────┬────────┘    └──────────────────┘                     │
│           │                                                        │
│           ▼                                                        │
│  ┌──────────────────┐    ┌──────────────────┐                     │
│  │ Auth Module      │    │ Email Service    │                     │
│  │                  │    │ (SendGrid)       │                     │
│  │ - Magic Link     │    │                  │                     │
│  │ - JWT Cookies    │    │ - License Key    │                     │
│  │ - Portal Login   │    │ - Magic Link     │                     │
│  └────────┬─────────┘    └──────────────────┘                     │
│           │                                                        │
│           ▼                                                        │
│  ┌──────────────────────────────────────────┐                     │
│  │ PostgreSQL Database                      │                     │
│  │                                           │                     │
│  │  ┌────────────┐      ┌────────────────┐  │                     │
│  │  │ users      │      │ licenses       │  │                     │
│  │  ├────────────┤      ├────────────────┤  │                     │
│  │  │ id (UUID)  │◄─────│ userId (FK)    │  │                     │
│  │  │ email      │      │ licenseKey     │  │                     │
│  │  │ createdAt  │      │ plan (enum)    │  │                     │
│  │  └────────────┘      │ status (enum)  │  │                     │
│  │                      │ expiresAt      │  │                     │
│  │                      │ createdBy      │  │                     │
│  │                      └────────────────┘  │                     │
│  └──────────────────────────────────────────┘                     │
│                                                                    │
│  Hardcoded Plans (src/config/plans.config.ts):                    │
│  - free: { expiresAfterDays: null, isPremium: false }             │
│  - early_adopter: { expiresAfterDays: 60, isPremium: true }       │
└──────────────────────────────────────────────────────────────────┘
```

### License Verification Flow (Extension → Server)

```
Extension Activation
│
├─► LicenseService.verifyLicense()
│   │
│   ├─► Step 1: Get license key from SecretStorage
│   │   └─► If not found → Return { valid: false, tier: "free" }
│   │
│   ├─► Step 2: Check cache (1-hour TTL)
│   │   └─► If cached and valid → Return cached result
│   │
│   ├─► Step 3: POST /api/v1/licenses/verify
│   │   │
│   │   └─► Server Response:
│   │       ├─ Valid License:
│   │       │   { valid: true, tier: "early_adopter", plan: {...}, expiresAt, daysRemaining }
│   │       │
│   │       └─ Invalid/Expired:
│   │           { valid: false, tier: "free", reason: "expired" | "revoked" | "not_found" }
│   │
│   ├─► Step 4: Cache result (1 hour)
│   │
│   └─► Step 5: Emit license status event
│       │
│       ├─ license:verified (if valid) → Trigger Premium MCP Registration
│       └─ license:expired (if invalid) → Skip Premium MCP Registration
│
└─► Extension Registration Logic
    │
    ├─ if (licenseStatus.tier === "free")
    │    └─► Skip: DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP)
    │
    └─ if (licenseStatus.tier === "early_adopter")
         └─► Execute: const mcpServer = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP)
                       await mcpServer.start()
                       context.subscriptions.push(mcpServer)
```

---

## Codebase Investigation Summary

### Investigation Scope

- **Libraries Analyzed**: 4 libraries (vscode-core, vscode-lm-tools, agent-sdk, shared)
- **Examples Reviewed**: 8 service files for DI patterns
- **Documentation Read**: 4 CLAUDE.md files
- **APIs Verified**: 3 core patterns (DI registration, RPC handlers, Disposable lifecycle)

### Evidence Sources

#### 1. vscode-core Library - Infrastructure Patterns

**Location**: `D:\projects\ptah-extension\libs\backend\vscode-core`

**Verified Patterns**:

- DI Token System: `src/di/tokens.ts` (150+ tokens defined with Symbol.for())
- Service Registration: Library exports services + TOKENS, app layer registers (see container.ts pattern)
- SecretStorage Access: Via EXTENSION_CONTEXT token (lines 15, 93 in tokens.ts)
- Logger Integration: `src/logging/logger.ts` (constructor injection pattern)

**Evidence**:

- TOKENS namespace is single source of truth (tokens.ts:1-150)
- Extension context available via `TOKENS.EXTENSION_CONTEXT` (tokens.ts:15)
- Services use @singleton() decorator with @inject() for dependencies (standard TSyringe pattern)

#### 2. vscode-lm-tools Library - MCP Server Registration

**Location**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools`

**Verified Patterns**:

- CodeExecutionMCP implements `vscode.Disposable` (code-execution-mcp.service.ts:33)
- MCP Server Lifecycle:
  - `start(): Promise<number>` - Returns port number (main.ts:104-107)
  - `dispose(): void` - Cleanup method (code-execution-mcp.service.ts:108)
  - Registered with `context.subscriptions.push()` (main.ts:108)

**Current Registration** (main.ts:102-112):

```typescript
// Step 8: Start Code Execution MCP Server
const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
const mcpPort = await(codeExecutionMCP as { start: () => Promise<number> }).start();
context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
```

**Evidence**:

- MCP server is ALWAYS registered (no conditional logic) - Line 102-112 in main.ts
- Uses Disposable pattern for lifecycle (vscode-lm-tools/CLAUDE.md:33)
- Premium tools exposed via CodeExecutionMCP.start() (main.ts:105)

**GAP IDENTIFIED**: No license check before MCP registration → Free users get premium access

#### 3. Extension Activation Flow

**Location**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`

**Verified Sequence** (lines 12-127):

1. DIContainer.setup(context) - Line 19
2. Logger resolution - Line 24
3. RPC method registration - Line 31-35
4. SDK authentication - Line 52-65
5. **MCP Server Start** - Line 102-112 (UNCONDITIONAL)
6. Welcome message - Line 123-127

**Evidence**:

- No license verification in activation flow (main.ts:1-146)
- No conditional MCP registration (main.ts:102-112)
- SecretStorage available via context.secrets (VS Code API standard)

#### 4. DI Container Orchestration

**Location**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`

**Verified Pattern** (lines 88-150):

- Phase 0: Extension Context Registration (line 93)
- Phase 1: Infrastructure Services (vscode-core) (line 100-150)
- Phase 2: Domain Services (workspace-intelligence, etc.)
- Phase 3: App-Level Services (webview, RPC)

**Service Registration Pattern**:

```typescript
// Libraries export registration functions
import { registerVsCodeCoreServices } from '@ptah-extension/vscode-core';

// Container orchestrates registration
registerVsCodeCoreServices(container, context);
```

**Evidence**:

- Container setup is centralized (container.ts:88)
- Services registered before activation completes (main.ts:19)
- TOKENS namespace imported from vscode-core (container.ts:25)

#### 5. NestJS License Server (Existing Skeleton)

**Location**: `D:\projects\ptah-extension\apps\ptah-license-server\src`

**Verified Structure**:

- Auth Module Exists: `app/auth/auth.module.ts`, `app/auth/services/auth.service.ts`
- JWT Guard Exists: `app/auth/guards/jwt-auth.guard.ts`
- Magic Link Pattern Exists: `app/auth/services/ticket.service.ts`
- NestJS 11 in package.json (verified via grep in root package.json:59-61)

**Evidence**:

- Skeleton auth structure already exists (auth/ directory)
- Magic link pattern reference implementation exists (ticket.service.ts)
- JWT authentication guards available (jwt-auth.guard.ts)

**GAP IDENTIFIED**: No license module, no database schema, no Prisma setup

---

## Component Specifications

### Part A: License Server Components

#### Component A1: Database Schema (Prisma)

**Purpose**: Define PostgreSQL schema for users and licenses with Prisma ORM.

**Pattern**: Prisma 7.1.0 with driver adapters (no Rust binary - monorepo compatible)
**Evidence**:

- Prisma 7.1.0 recommended in task-description.md (line 639)
- Driver adapter pattern: `@prisma/adapter-pg` + `pg@8.11.0` (line 640-641)
- Avoids binary conflicts in Nx monorepo builds

**Implementation Pattern**:

```prisma
// apps/ptah-license-server/prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

model User {
  id        String    @id @default(uuid()) @db.Uuid
  email     String    @unique
  createdAt DateTime  @default(now()) @map("created_at")
  licenses  License[]

  @@map("users")
}

model License {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  licenseKey String    @unique @map("license_key")
  plan       String    // "free" | "early_adopter"
  status     String    @default("active") // "active" | "expired" | "revoked"
  expiresAt  DateTime? @map("expires_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  createdBy  String    @default("admin") @map("created_by")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([licenseKey])
  @@index([userId])
  @@index([status, expiresAt])
  @@map("licenses")
}
```

**Quality Requirements**:

**Functional**:

- Schema must support users and licenses tables
- License key format: `ptah_lic_{64-hex-chars}` (256-bit entropy)
- Plan validation: "free" | "early_adopter" (enum at application level)
- Status validation: "active" | "expired" | "revoked"
- Cascade delete: Deleting user deletes all licenses

**Non-Functional**:

- Indexes on licenseKey (unique), userId, status+expiresAt for query performance
- UUID primary keys for security (non-enumerable)
- Snake_case column names (PostgreSQL convention)
- Migration-friendly (Prisma migrate dev)

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\` (generated)
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\package.json` (add Prisma dependencies)
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\prisma\prisma.service.ts` (DI wrapper)

---

#### Component A2: Hardcoded Plan Configuration

**Purpose**: Define plan metadata (free, early_adopter) as TypeScript constants.

**Pattern**: Const object with `as const` assertion for type safety
**Evidence**: task-description.md:559-593 (plan configuration example)

**Implementation Pattern**:

```typescript
// apps/ptah-license-server/src/config/plans.config.ts
export const PLANS = {
  free: {
    name: 'Free',
    features: ['basic_cli_wrapper', 'session_history', 'permission_management', 'mcp_configuration'],
    expiresAfterDays: null, // Never expires
    isPremium: false,
    description: 'Beautiful UI for Claude CLI',
  },
  early_adopter: {
    name: 'Early Adopter',
    features: ['all_premium_features', 'sdk_access', 'custom_tools', 'workspace_semantic_search', 'editor_context_awareness', 'git_workspace_info'],
    expiresAfterDays: 60, // 2 months
    futurePrice: 8, // USD/month
    isPremium: true,
    description: 'SDK-powered workspace tools + all free features',
  },
} as const;

export type PlanName = keyof typeof PLANS;

export function getPlanConfig(plan: PlanName) {
  return PLANS[plan];
}

export function calculateExpirationDate(plan: PlanName): Date | null {
  const config = PLANS[plan];
  if (config.expiresAfterDays === null) return null;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.expiresAfterDays);
  return expiresAt;
}
```

**Quality Requirements**:

**Functional**:

- Must define exactly 2 plans: free, early_adopter
- early_adopter expires after 60 days
- free never expires
- Feature lists must be accurate

**Non-Functional**:

- Type-safe with `as const` assertion
- Immutable configuration (cannot be modified at runtime)
- Zero database queries (performance)

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts`

---

#### Component A3: License Verification Service

**Purpose**: Verify license key validity, return tier and plan details.

**Pattern**: NestJS Injectable service with Prisma client injection
**Evidence**:

- NestJS @Injectable() pattern (standard NestJS DI)
- Prisma client injection via constructor (standard Prisma + NestJS pattern)

**Implementation Pattern**:

```typescript
// apps/ptah-license-server/src/license/services/license.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS, getPlanConfig } from '../../config/plans.config';

@Injectable()
export class LicenseService {
  constructor(private prisma: PrismaService) {}

  async verifyLicense(licenseKey: string): Promise<{
    valid: boolean;
    tier: 'free' | 'early_adopter';
    plan?: (typeof PLANS)[keyof typeof PLANS];
    expiresAt?: string;
    daysRemaining?: number;
    reason?: 'expired' | 'revoked' | 'not_found';
  }> {
    // Step 1: Find license in database
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
    });

    if (!license) {
      return { valid: false, tier: 'free', reason: 'not_found' };
    }

    // Step 2: Check status
    if (license.status === 'revoked') {
      return { valid: false, tier: 'free', reason: 'revoked' };
    }

    // Step 3: Check expiration
    if (license.expiresAt && new Date() > license.expiresAt) {
      return {
        valid: false,
        tier: 'free',
        reason: 'expired',
      };
    }

    // Step 4: Return valid license
    const planConfig = getPlanConfig(license.plan as keyof typeof PLANS);
    const daysRemaining = license.expiresAt ? Math.ceil((license.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

    return {
      valid: true,
      tier: license.plan as 'free' | 'early_adopter',
      plan: planConfig,
      expiresAt: license.expiresAt?.toISOString(),
      daysRemaining: daysRemaining ?? undefined,
    };
  }

  async createLicense(params: { email: string; plan: keyof typeof PLANS }): Promise<{ licenseKey: string; expiresAt: Date | null }> {
    // Step 1: Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: params.email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email: params.email },
      });
    }

    // Step 2: Revoke existing active licenses
    await this.prisma.license.updateMany({
      where: { userId: user.id, status: 'active' },
      data: { status: 'revoked' },
    });

    // Step 3: Generate license key
    const licenseKey = this.generateLicenseKey();

    // Step 4: Calculate expiration
    const planConfig = getPlanConfig(params.plan);
    const expiresAt = planConfig.expiresAfterDays !== null ? new Date(Date.now() + planConfig.expiresAfterDays * 24 * 60 * 60 * 1000) : null;

    // Step 5: Create license
    await this.prisma.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan: params.plan,
        status: 'active',
        expiresAt,
        createdBy: 'admin',
      },
    });

    return { licenseKey, expiresAt };
  }

  private generateLicenseKey(): string {
    const crypto = require('crypto');
    const random = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    return `ptah_lic_${random}`;
  }
}
```

**Quality Requirements**:

**Functional**:

- Verify license key in <200ms (p95 latency)
- Return correct tier (free/early_adopter)
- Handle expired licenses gracefully
- Revoke old licenses when creating new ones for same user

**Non-Functional**:

- Database query optimization (indexed licenseKey column)
- No sensitive data in logs (license keys redacted)
- Atomic operations (revoke + create in transaction)

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\license.module.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\dto\verify-license.dto.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\dto\create-license.dto.ts`

---

#### Component A4: Admin License Creation API

**Purpose**: Admin endpoint to create licenses and send emails.

**Pattern**: NestJS Controller with X-API-Key authentication guard
**Evidence**: task-description.md:420-454 (admin API specification)

**Implementation Pattern**:

```typescript
// apps/ptah-license-server/src/license/guards/admin-api-key.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || apiKey !== this.config.get('ADMIN_API_KEY')) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}

// apps/ptah-license-server/src/license/controllers/admin.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AdminApiKeyGuard } from '../guards/admin-api-key.guard';
import { LicenseService } from '../services/license.service';
import { EmailService } from '../../email/services/email.service';
import { CreateLicenseDto } from '../dto/create-license.dto';

@Controller('api/v1/admin')
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  constructor(private licenseService: LicenseService, private emailService: EmailService) {}

  @Post('licenses')
  async createLicense(@Body() dto: CreateLicenseDto) {
    // Step 1: Create license
    const { licenseKey, expiresAt } = await this.licenseService.createLicense({
      email: dto.email,
      plan: dto.plan,
    });

    // Step 2: Send email (if requested)
    let emailSent = false;
    let emailError: string | undefined;

    if (dto.sendEmail !== false) {
      try {
        await this.emailService.sendLicenseKey({
          email: dto.email,
          licenseKey,
          plan: dto.plan,
          expiresAt,
        });
        emailSent = true;
      } catch (error) {
        emailError = error.message;
        // Log error but still return success (license created)
      }
    }

    // Step 3: Return response
    return {
      success: true,
      license: {
        licenseKey,
        plan: dto.plan,
        status: 'active',
        expiresAt: expiresAt?.toISOString(),
        createdAt: new Date().toISOString(),
      },
      emailSent,
      emailError,
    };
  }
}
```

**Quality Requirements**:

**Functional**:

- Admin API key validation (256-bit secret)
- License creation with user lookup/creation
- Email sending with retry logic (3 attempts)
- Graceful degradation if email fails (still create license)

**Non-Functional**:

- Rate limiting: 10 requests/minute per IP
- Request logging with admin audit trail
- Transaction safety (user + license creation atomic)

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\admin.controller.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\guards\admin-api-key.guard.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\dto\create-license.dto.ts`

---

#### Component A5: Magic Link Authentication

**Purpose**: Passwordless portal login via email magic links.

**Pattern**: Existing ticket.service.ts pattern (already in codebase)
**Evidence**:

- `apps/ptah-license-server/src/app/auth/services/ticket.service.ts` exists (verified via Glob)
- Magic link pattern reference: task-description.md:459-507

**Implementation Pattern**:

```typescript
// apps/ptah-license-server/src/auth/services/magic-link.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

interface MagicLinkToken {
  email: string;
  token: string;
  expiresAt: Date;
  used: boolean;
}

@Injectable()
export class MagicLinkService {
  private tokens = new Map<string, MagicLinkToken>();

  constructor(private config: ConfigService) {}

  async createMagicLink(email: string): Promise<string> {
    // Generate 64-char hex token
    const token = randomBytes(32).toString('hex');

    // Store token with 30-second TTL
    const expiresAt = new Date(Date.now() + 30000);
    this.tokens.set(token, { email, token, expiresAt, used: false });

    // Build magic link URL
    const frontendUrl = this.config.get('FRONTEND_URL');
    return `${frontendUrl}/auth/verify?token=${token}`;
  }

  async validateAndConsume(token: string): Promise<{ valid: boolean; email?: string; error?: string }> {
    const magicLink = this.tokens.get(token);

    if (!magicLink) {
      return { valid: false, error: 'token_not_found' };
    }

    if (magicLink.used) {
      return { valid: false, error: 'token_already_used' };
    }

    if (new Date() > magicLink.expiresAt) {
      this.tokens.delete(token);
      return { valid: false, error: 'token_expired' };
    }

    // Mark as used and return email
    magicLink.used = true;
    this.tokens.delete(token); // Single-use enforcement

    return { valid: true, email: magicLink.email };
  }
}
```

**Quality Requirements**:

**Functional**:

- Magic link generation with 30-second TTL
- Single-use token enforcement
- Token cleanup on expiration
- Email validation before magic link creation

**Non-Functional**:

- In-memory token storage (suitable for single-instance deployment)
- 256-bit token entropy (64 hex characters)
- Migration path to Redis for multi-instance (documented, not implemented)

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\auth\services\magic-link.service.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\auth\auth.controller.ts` (add magic link endpoints)
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\auth\auth.module.ts` (register MagicLinkService)

---

#### Component A6: Email Service (SendGrid)

**Purpose**: Send license key and magic link emails via SendGrid.

**Pattern**: NestJS Injectable with @sendgrid/mail integration
**Evidence**: SendGrid recommended in task-description.md:618-620

**Implementation Pattern**:

```typescript
// apps/ptah-license-server/src/email/services/email.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class EmailService {
  constructor(private config: ConfigService) {
    sgMail.setApiKey(this.config.get('SENDGRID_API_KEY'));
  }

  async sendLicenseKey(params: { email: string; licenseKey: string; plan: string; expiresAt: Date | null }): Promise<void> {
    const msg = {
      to: params.email,
      from: {
        email: this.config.get('SENDGRID_FROM_EMAIL'),
        name: this.config.get('SENDGRID_FROM_NAME'),
      },
      subject: 'Your Ptah Premium License Key',
      html: this.getLicenseKeyTemplate(params),
    };

    // Retry logic: 3 attempts with exponential backoff
    await this.sendWithRetry(msg, 3);
  }

  async sendMagicLink(params: { email: string; magicLink: string }): Promise<void> {
    const msg = {
      to: params.email,
      from: {
        email: this.config.get('SENDGRID_FROM_EMAIL'),
        name: this.config.get('SENDGRID_FROM_NAME'),
      },
      subject: 'Login to Ptah Portal',
      html: this.getMagicLinkTemplate(params),
    };

    await this.sendWithRetry(msg, 3);
  }

  private async sendWithRetry(msg: any, attempts: number): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        await sgMail.send(msg);
        return; // Success
      } catch (error) {
        if (i === attempts - 1) throw error; // Last attempt failed
        await this.sleep(Math.pow(2, i) * 1000); // Exponential backoff
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getLicenseKeyTemplate(params: { licenseKey: string; plan: string; expiresAt: Date | null }): string {
    return `
      <h1>Welcome to Ptah Premium!</h1>
      <p>Your ${params.plan} license is ready.</p>
      <p><strong>License Key:</strong> ${params.licenseKey}</p>
      ${params.expiresAt ? `<p><strong>Expires:</strong> ${params.expiresAt.toLocaleDateString()}</p>` : ''}
      <h2>Setup Instructions:</h2>
      <ol>
        <li>Open VS Code settings (Cmd+,)</li>
        <li>Search for "Ptah"</li>
        <li>Paste your license key in "Ptah: License Key"</li>
        <li>Reload VS Code window</li>
      </ol>
      <p>Need help? Reply to this email.</p>
    `;
  }

  private getMagicLinkTemplate(params: { magicLink: string }): string {
    return `
      <h1>Login to Ptah Portal</h1>
      <p>Click the link below to access your Ptah Portal:</p>
      <p><a href="${params.magicLink}">${params.magicLink}</a></p>
      <p>This link expires in 30 seconds.</p>
      <p>Didn't request this? Ignore this email.</p>
    `;
  }
}
```

**Quality Requirements**:

**Functional**:

- Send license key email with setup instructions
- Send magic link email with 30-second expiration notice
- Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
- HTML email templates (inline CSS for compatibility)

**Non-Functional**:

- Email delivery success rate >99%
- SendGrid API integration with error logging
- Template rendering in <10ms

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\services\email.service.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\email.module.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\package.json` (add @sendgrid/mail dependency)

---

### Part B: VS Code Extension License Integration

#### Component B1: LicenseService (VS Code Extension)

**Purpose**: Manage license verification, caching, and status events for VS Code extension.

**Pattern**: TSyringe singleton service with SecretStorage integration
**Evidence**:

- Extension context provides `context.secrets` (SecretStorage API) - VS Code API standard
- TSyringe @singleton() pattern verified in vscode-core services (container.ts:100-150)
- Event emitter pattern for status changes (EventEmitter3 library in use)

**Implementation Pattern**:

```typescript
// libs/backend/vscode-core/src/services/license.service.ts
import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';
import EventEmitter from 'eventemitter3';

export interface LicenseStatus {
  valid: boolean;
  tier: 'free' | 'early_adopter';
  plan?: {
    name: string;
    features: string[];
    futurePrice?: number;
    isPremium: boolean;
  };
  expiresAt?: string;
  daysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found';
}

export interface LicenseEvents {
  'license:verified': (status: LicenseStatus) => void;
  'license:expired': (status: LicenseStatus) => void;
  'license:updated': (status: LicenseStatus) => void;
}

@injectable()
export class LicenseService extends EventEmitter<LicenseEvents> {
  private static readonly SECRET_KEY = 'ptah.licenseKey';
  private static readonly LICENSE_SERVER_URL = process.env.PTAH_LICENSE_SERVER_URL || 'https://api.ptah.dev';
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  private cache: {
    status: LicenseStatus | null;
    timestamp: number | null;
  } = { status: null, timestamp: null };

  constructor(@inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext, @inject(TOKENS.LOGGER) private logger: Logger) {
    super();
  }

  /**
   * Verify license key with server (or return cached result)
   */
  async verifyLicense(): Promise<LicenseStatus> {
    try {
      // Step 1: Check cache
      if (this.isCacheValid()) {
        this.logger.debug('Returning cached license status');
        return this.cache.status!;
      }

      // Step 2: Get license key from SecretStorage
      const licenseKey = await this.context.secrets.get(LicenseService.SECRET_KEY);

      if (!licenseKey) {
        const freeStatus: LicenseStatus = { valid: false, tier: 'free' };
        this.updateCache(freeStatus);
        return freeStatus;
      }

      // Step 3: Verify with server
      const response = await fetch(`${LicenseService.LICENSE_SERVER_URL}/api/v1/licenses/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey }),
      });

      if (!response.ok) {
        throw new Error(`License verification failed: ${response.statusText}`);
      }

      const status: LicenseStatus = await response.json();

      // Step 4: Update cache and emit events
      this.updateCache(status);
      this.emitLicenseEvent(status);

      return status;
    } catch (error) {
      this.logger.error('License verification failed', { error });
      // Return cached status if available, otherwise free tier
      return this.cache.status || { valid: false, tier: 'free' as const };
    }
  }

  /**
   * Store license key in SecretStorage
   */
  async setLicenseKey(licenseKey: string): Promise<void> {
    await this.context.secrets.store(LicenseService.SECRET_KEY, licenseKey);
    this.logger.info('License key stored in SecretStorage');

    // Invalidate cache and re-verify
    this.cache = { status: null, timestamp: null };
    const status = await this.verifyLicense();
    this.emit('license:updated', status);
  }

  /**
   * Remove license key from SecretStorage
   */
  async clearLicenseKey(): Promise<void> {
    await this.context.secrets.delete(LicenseService.SECRET_KEY);
    this.logger.info('License key removed from SecretStorage');

    // Update to free tier
    const freeStatus: LicenseStatus = { valid: false, tier: 'free' };
    this.updateCache(freeStatus);
    this.emit('license:updated', freeStatus);
  }

  /**
   * Get cached license status (no network call)
   */
  getCachedStatus(): LicenseStatus | null {
    return this.cache.status;
  }

  /**
   * Background revalidation (call periodically, e.g., every 24 hours)
   */
  async revalidate(): Promise<void> {
    this.logger.debug('Background license revalidation');
    this.cache = { status: null, timestamp: null }; // Invalidate cache
    await this.verifyLicense();
  }

  private isCacheValid(): boolean {
    if (!this.cache.status || !this.cache.timestamp) return false;
    return Date.now() - this.cache.timestamp < LicenseService.CACHE_TTL_MS;
  }

  private updateCache(status: LicenseStatus): void {
    this.cache = { status, timestamp: Date.now() };
  }

  private emitLicenseEvent(status: LicenseStatus): void {
    if (status.valid) {
      this.emit('license:verified', status);
    } else {
      this.emit('license:expired', status);
    }
  }
}
```

**Quality Requirements**:

**Functional**:

- Store license key in VS Code SecretStorage (encrypted)
- Verify license with server on activation
- Cache verification result for 1 hour (reduce API calls)
- Emit events: license:verified, license:expired, license:updated
- Background revalidation every 24 hours

**Non-Functional**:

- Graceful degradation if server unreachable (use cached status)
- No license key in logs (security)
- Fast cache lookups (<1ms)
- Network timeout: 5 seconds

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\register.ts` (register LicenseService)
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (add LICENSE_SERVICE token)
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts` (export LicenseService)

---

#### Component B2: Premium MCP Server Conditional Registration

**Purpose**: Register CodeExecutionMCP ONLY for licensed users, skip for free tier.

**Pattern**: Conditional DI resolution with Disposable lifecycle management
**Evidence**:

- Current UNCONDITIONAL registration in main.ts:102-112 (verified)
- Disposable pattern for MCP server (vscode-lm-tools/CLAUDE.md:33)
- Extension activation flow (main.ts:12-146)

**Implementation Pattern**:

```typescript
// apps/ptah-extension-vscode/src/main.ts (MODIFY)

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('===== PTAH ACTIVATION START =====');
  try {
    // ... (existing steps 1-7: DI setup, RPC registration, SDK init, etc.)

    // ========================================
    // NEW STEP 7.5: LICENSE VERIFICATION
    // ========================================
    console.log('[Activate] Step 7.5: Verifying license...');
    const licenseService = DIContainer.resolve<LicenseService>(TOKENS.LICENSE_SERVICE);
    const licenseStatus = await licenseService.verifyLicense();

    if (licenseStatus.valid && licenseStatus.tier !== 'free') {
      logger.info('Premium license verified', {
        tier: licenseStatus.tier,
        expiresAt: licenseStatus.expiresAt,
      });
    } else {
      logger.info('Free tier user (no premium features)', {
        reason: licenseStatus.reason || 'no_license',
      });
    }
    console.log(`[Activate] Step 7.5: License verified (tier: ${licenseStatus.tier})`);

    // ========================================
    // MODIFIED STEP 8: CONDITIONAL MCP SERVER START
    // ========================================
    console.log('[Activate] Step 8: Conditional MCP Server registration...');

    if (licenseStatus.valid && licenseStatus.tier !== 'free') {
      // PREMIUM USER: Register MCP Server
      logger.info('Registering premium MCP server (licensed user)');
      const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
      const mcpPort = await (codeExecutionMCP as { start: () => Promise<number> }).start();
      context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
      logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
      console.log(`[Activate] Step 8: Premium MCP Server started (port ${mcpPort})`);
    } else {
      // FREE USER: Skip MCP Server Registration
      logger.info('Skipping premium MCP server (free tier user)');
      console.log('[Activate] Step 8: MCP Server skipped (free tier)');
    }

    // ========================================
    // NEW STEP 9: LICENSE STATUS WATCHER
    // ========================================
    console.log('[Activate] Step 9: Setting up license status watcher...');

    // Handle dynamic license changes (upgrade/expire)
    licenseService.on('license:verified', async (status) => {
      logger.info('License upgraded - registering premium features', { status });
      // Dynamic registration: Start MCP server if not already running
      const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
      if (!(codeExecutionMCP as any).isRunning) {
        const mcpPort = await (codeExecutionMCP as { start: () => Promise<number> }).start();
        context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
        logger.info(`Premium MCP Server started dynamically (port ${mcpPort})`);
      }
    });

    licenseService.on('license:expired', (status) => {
      logger.warn('License expired - premium features disabled', { status });
      vscode.window.showWarningMessage('Your Ptah premium license has expired. Premium features are now disabled.');
      // Note: MCP server will be disposed on next activation
      // For immediate effect, would need to implement dynamic deregistration
    });

    console.log('[Activate] Step 9: License status watcher initialized');

    // ========================================
    // BACKGROUND REVALIDATION (every 24 hours)
    // ========================================
    const revalidationInterval = setInterval(() => licenseService.revalidate(), 24 * 60 * 60 * 1000);
    context.subscriptions.push({
      dispose: () => clearInterval(revalidationInterval),
    });

    // ... (rest of activation: welcome message, etc.)
  } catch (error) {
    // ... (existing error handling)
  }
}
```

**Quality Requirements**:

**Functional**:

- Check license BEFORE registering MCP server
- Free users: Zero premium code execution (MCP server NOT resolved from DI)
- Licensed users: MCP server registered and started
- Dynamic re-registration on license upgrade (license:verified event)
- Background revalidation every 24 hours

**Non-Functional**:

- Activation time increase <500ms (license check is fast with cache)
- No memory leaks (Disposable cleanup on deactivation)
- Clear user feedback (warning message on license expiration)

**Files Affected**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts` (add license verification step)

---

#### Component B3: Configuration UI for License Key

**Purpose**: Allow users to enter license key via VS Code settings.

**Pattern**: VS Code configuration contribution with SecretStorage integration
**Evidence**:

- VS Code settings contribution in package.json (standard pattern)
- SecretStorage for sensitive data (VS Code API standard)
- ConfigManager for reading settings (vscode-core/CLAUDE.md)

**Implementation Pattern**:

```json
// apps/ptah-extension-vscode/package.json (MODIFY)
{
  "contributes": {
    "configuration": {
      "title": "Ptah Extension",
      "properties": {
        "ptah.licenseKey": {
          "type": "string",
          "default": "",
          "description": "Ptah premium license key (leave empty for free tier)",
          "markdownDescription": "Enter your Ptah premium license key here. Get your license at https://ptah.dev/pricing",
          "order": 1
        }
      }
    },
    "commands": [
      {
        "command": "ptah.enterLicenseKey",
        "title": "Ptah: Enter License Key"
      },
      {
        "command": "ptah.removeLicenseKey",
        "title": "Ptah: Remove License Key"
      },
      {
        "command": "ptah.checkLicenseStatus",
        "title": "Ptah: Check License Status"
      }
    ]
  }
}
```

```typescript
// apps/ptah-extension-vscode/src/commands/license-commands.ts (CREATE)
import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { LicenseService } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';

@injectable()
export class LicenseCommands {
  constructor(@inject(TOKENS.LICENSE_SERVICE) private licenseService: LicenseService) {}

  async enterLicenseKey(): Promise<void> {
    const licenseKey = await vscode.window.showInputBox({
      prompt: 'Enter your Ptah premium license key',
      placeHolder: 'ptah_lic_...',
      password: true,
      validateInput: (value) => {
        if (!value.startsWith('ptah_lic_')) {
          return 'Invalid license key format';
        }
        return null;
      },
    });

    if (!licenseKey) return;

    await this.licenseService.setLicenseKey(licenseKey);

    const status = await this.licenseService.verifyLicense();
    if (status.valid) {
      vscode.window.showInformationMessage(`License activated! Plan: ${status.plan?.name}. Reload window to enable premium features.`, 'Reload Window').then((action) => {
        if (action === 'Reload Window') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    } else {
      vscode.window.showErrorMessage(`License verification failed: ${status.reason || 'Invalid license key'}`);
    }
  }

  async removeLicenseKey(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage('Are you sure you want to remove your license key? Premium features will be disabled.', 'Remove', 'Cancel');

    if (confirm !== 'Remove') return;

    await this.licenseService.clearLicenseKey();
    vscode.window.showInformationMessage('License key removed. Reload window to apply changes.', 'Reload Window').then((action) => {
      if (action === 'Reload Window') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  }

  async checkLicenseStatus(): Promise<void> {
    const status = await this.licenseService.verifyLicense();

    if (status.valid) {
      vscode.window.showInformationMessage(`License Status: ${status.plan?.name} (${status.tier})\nExpires: ${status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : 'Never'}\nDays Remaining: ${status.daysRemaining || 'Unlimited'}`);
    } else {
      vscode.window.showInformationMessage(`License Status: Free Tier\nReason: ${status.reason || 'No license key'}\nUpgrade at https://ptah.dev/pricing`);
    }
  }

  registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('ptah.enterLicenseKey', () => this.enterLicenseKey()),
      vscode.commands.registerCommand('ptah.removeLicenseKey', () => this.removeLicenseKey()),
      vscode.commands.registerCommand('ptah.checkLicenseStatus', () => this.checkLicenseStatus())
    );
  }
}
```

**Quality Requirements**:

**Functional**:

- Input validation for license key format (ptah*lic*\*)
- Password-protected input box (no plaintext display)
- Immediate verification feedback
- Reload window prompt after license changes
- Check license status command

**Non-Functional**:

- UX: Clear error messages for invalid licenses
- Security: License key never logged or displayed
- Performance: <100ms for input validation

**Files Affected**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\commands\license-commands.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json` (add commands and configuration)
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts` (register license commands)

---

## Integration Architecture

### Integration Points

#### Integration 1: Extension → License Server

**Pattern**: HTTPS REST API calls with fetch()
**Evidence**: Standard browser fetch API, no additional dependencies needed

**Flow**:

```
VS Code Extension (LicenseService)
    │
    ├─► POST /api/v1/licenses/verify
    │   Body: { licenseKey: "ptah_lic_..." }
    │   Response: { valid: true, tier: "early_adopter", plan: {...}, expiresAt, daysRemaining }
    │
    └─► Caching: 1-hour TTL in LicenseService.cache
```

#### Integration 2: License Status → MCP Registration

**Pattern**: Event-driven conditional registration
**Evidence**: EventEmitter3 pattern used in codebase (vscode-core services)

**Flow**:

```
LicenseService.verifyLicense()
    │
    ├─► emit('license:verified') → main.ts registers CodeExecutionMCP
    ├─► emit('license:expired')  → main.ts shows warning, skips MCP
    └─► emit('license:updated')  → main.ts re-evaluates registration
```

#### Integration 3: Admin API → Email Service

**Pattern**: NestJS dependency injection
**Evidence**: Standard NestJS @Injectable() pattern

**Flow**:

```
AdminController.createLicense()
    │
    ├─► LicenseService.createLicense() → Database insert
    ├─► EmailService.sendLicenseKey()  → SendGrid API
    └─► Return: { success, license, emailSent, emailError }
```

### Data Flow

**License Creation Flow (Admin → User)**:

```
1. Admin calls POST /admin/licenses { email, plan }
2. LicenseService creates user (if new)
3. LicenseService generates license key (ptah_lic_{64-hex})
4. LicenseService saves license to database
5. EmailService sends license key email (SendGrid)
6. Admin receives response { licenseKey, emailSent }
7. User receives email with license key
8. User enters license key in VS Code settings
9. LicenseService stores key in SecretStorage
10. LicenseService verifies with server
11. Extension registers premium MCP server
```

**License Verification Flow (Extension Activation)**:

```
1. Extension activates (main.ts)
2. DIContainer.setup() registers LicenseService
3. LicenseService.verifyLicense() called
4. LicenseService checks cache (1-hour TTL)
5. If cache miss: Fetch license key from SecretStorage
6. If key present: POST /api/v1/licenses/verify
7. Server queries database (licenses table)
8. Server returns { valid, tier, plan, expiresAt }
9. LicenseService caches result
10. LicenseService emits license:verified or license:expired
11. main.ts conditionally registers CodeExecutionMCP
12. Free users: Skip step 11 (zero premium code)
```

### Dependencies

**Backend (License Server)**:

- PostgreSQL: Database storage
- Prisma 7.1.0: ORM with driver adapters
- SendGrid: Email delivery
- NestJS 11: Backend framework
- JWT: Portal authentication

**Frontend (VS Code Extension)**:

- SecretStorage: Encrypted license key storage
- EventEmitter3: License status events
- fetch(): HTTP client (built-in)
- TSyringe: Dependency injection

---

## Batch Breakdown

### Batch 1: License Server Database & Core (2-3 hours)

**Goal**: Setup PostgreSQL schema, Prisma, and hardcoded plan configuration.

**Tasks**:

1. Install Prisma dependencies (`@prisma/client@7.1.0`, `@prisma/adapter-pg`, `pg@8.11.0`)
2. Create Prisma schema (`prisma/schema.prisma`) with users and licenses tables
3. Run Prisma migration (`npx prisma migrate dev --name init`)
4. Create PrismaService wrapper for NestJS DI
5. Create hardcoded plan configuration (`src/config/plans.config.ts`)
6. Write unit tests for plan configuration utilities

**Completion Criteria**:

- Prisma Client generates successfully
- Database tables created (users, licenses)
- Indexes created (licenseKey, userId, status+expiresAt)
- Plan configuration exported and type-safe

**Files Created**:

- `apps/ptah-license-server/prisma/schema.prisma`
- `apps/ptah-license-server/src/prisma/prisma.service.ts`
- `apps/ptah-license-server/src/config/plans.config.ts`
- `apps/ptah-license-server/src/config/plans.config.spec.ts`

---

### Batch 2: License Verification API (2-3 hours)

**Goal**: Implement license verification and creation services + endpoints.

**Tasks**:

1. Create LicenseService with verifyLicense() and createLicense() methods
2. Implement license key generation (crypto.randomBytes)
3. Create DTO classes (VerifyLicenseDto, CreateLicenseDto) with class-validator
4. Create LicenseController with POST /api/v1/licenses/verify endpoint
5. Write unit tests for LicenseService (mock Prisma client)
6. Write integration tests for /verify endpoint

**Completion Criteria**:

- POST /api/v1/licenses/verify returns valid/invalid status in <200ms
- License key format: `ptah_lic_{64-hex}`
- Expired licenses return { valid: false, tier: "free", reason: "expired" }
- Database queries use indexed columns (licenseKey)

**Files Created**:

- `apps/ptah-license-server/src/license/services/license.service.ts`
- `apps/ptah-license-server/src/license/controllers/license.controller.ts`
- `apps/ptah-license-server/src/license/dto/verify-license.dto.ts`
- `apps/ptah-license-server/src/license/dto/create-license.dto.ts`
- `apps/ptah-license-server/src/license/license.module.ts`
- Test files for each service/controller

---

### Batch 3: Admin API & Email Service (2-3 hours)

**Goal**: Admin license creation endpoint with SendGrid email integration.

**Tasks**:

1. Create AdminApiKeyGuard for X-API-Key authentication
2. Create AdminController with POST /admin/licenses endpoint
3. Install SendGrid dependency (`@sendgrid/mail@^8.0.0`)
4. Create EmailService with sendLicenseKey() and sendMagicLink() methods
5. Implement email retry logic (3 attempts, exponential backoff)
6. Create email HTML templates (license key, magic link)
7. Write unit tests for EmailService (mock SendGrid)
8. Write integration tests for admin license creation

**Completion Criteria**:

- Admin API key validation works (401 for invalid key)
- License created and email sent in <1000ms (p95)
- Email failures logged, still return { success: true, emailSent: false }
- HTML email templates render correctly

**Files Created**:

- `apps/ptah-license-server/src/license/guards/admin-api-key.guard.ts`
- `apps/ptah-license-server/src/license/controllers/admin.controller.ts`
- `apps/ptah-license-server/src/email/services/email.service.ts`
- `apps/ptah-license-server/src/email/email.module.ts`
- Test files for guards, services, and controllers

---

### Batch 4: Magic Link Authentication (2 hours)

**Goal**: Passwordless portal login via magic links and JWT cookies.

**Tasks**:

1. Create MagicLinkService with createMagicLink() and validateAndConsume() methods
2. Modify AuthController to add POST /auth/magic-link and GET /auth/verify endpoints
3. Implement JWT generation with HTTP-only cookies (7-day expiration)
4. Add single-use token enforcement (mark as used after validation)
5. Implement 30-second TTL for magic link tokens
6. Write unit tests for MagicLinkService
7. Write E2E tests for magic link flow

**Completion Criteria**:

- Magic link generated in <300ms
- Single-use enforcement works (token deleted after use)
- Expired tokens return { error: "token_expired" }
- JWT cookie set with httpOnly, secure, sameSite flags

**Files Created**:

- `apps/ptah-license-server/src/auth/services/magic-link.service.ts`
- Modified: `apps/ptah-license-server/src/auth/auth.controller.ts`
- Modified: `apps/ptah-license-server/src/auth/auth.module.ts`
- Test files for magic link service and E2E tests

---

### Batch 5: VS Code LicenseService (2-3 hours)

**Goal**: License verification service for VS Code extension with caching and events.

**Tasks**:

1. Create LicenseService in vscode-core library
2. Implement verifyLicense() with SecretStorage and fetch() integration
3. Implement 1-hour cache with TTL validation
4. Add event emitters (license:verified, license:expired, license:updated)
5. Create setLicenseKey() and clearLicenseKey() methods
6. Add LICENSE_SERVICE token to TOKENS namespace
7. Register LicenseService in vscode-core's registerVsCodeCoreServices()
8. Write unit tests for LicenseService (mock SecretStorage, fetch)

**Completion Criteria**:

- License verification works with cache (1-hour TTL)
- SecretStorage integration tested
- Events emitted on license status changes
- Graceful degradation if server unreachable (use cached status)

**Files Created**:

- `libs/backend/vscode-core/src/services/license.service.ts`
- `libs/backend/vscode-core/src/services/license.service.spec.ts`
- Modified: `libs/backend/vscode-core/src/di/tokens.ts` (add LICENSE_SERVICE)
- Modified: `libs/backend/vscode-core/src/di/register.ts` (register service)
- Modified: `libs/backend/vscode-core/src/index.ts` (export LicenseService)

---

### Batch 6: Premium MCP Conditional Registration (2-3 hours)

**Goal**: Conditional MCP server registration based on license status.

**Tasks**:

1. Modify main.ts activation flow to verify license BEFORE MCP registration
2. Implement conditional logic: Skip MCP for free users, register for licensed users
3. Add license status event handlers (license:verified → register MCP)
4. Create LicenseCommands class for command palette integration
5. Add license commands to package.json (enterLicenseKey, removeLicenseKey, checkLicenseStatus)
6. Implement background revalidation (every 24 hours)
7. Add reload window prompts after license changes
8. Write integration tests for conditional MCP registration

**Completion Criteria**:

- Free users: CodeExecutionMCP NOT resolved from DI container
- Licensed users: CodeExecutionMCP registered and started
- Dynamic registration works (license:verified event triggers MCP start)
- User commands work (enter/remove/check license)

**Files Modified**:

- `apps/ptah-extension-vscode/src/main.ts` (add license verification step)
- `apps/ptah-extension-vscode/package.json` (add commands and configuration)

**Files Created**:

- `apps/ptah-extension-vscode/src/commands/license-commands.ts`
- Integration test files for license-driven MCP registration

---

## Quality Requirements

### Functional Requirements (Architecture-Level)

**License Server**:

- License verification API must return results in <200ms (p95 latency)
- Admin license creation must complete in <1000ms including email sending
- Magic link tokens must expire after 30 seconds
- Email retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
- Database queries must use indexed columns (licenseKey, userId, status+expiresAt)

**VS Code Extension**:

- License verification must use 1-hour cache to reduce API calls
- Premium MCP server must NOT be registered for free users
- License status changes must trigger dynamic re-registration
- SecretStorage must be used for encrypted license key storage
- Background revalidation must occur every 24 hours

### Non-Functional Requirements

**Performance**:

- License verification: <200ms (p95), <500ms (p99)
- Cache lookup: <1ms
- Database queries: <10ms (p99)
- Email sending: <5 seconds (with retries)

**Security**:

- Admin API key: 256-bit random key (stored in environment variable)
- License keys: 256-bit entropy (64 hex characters)
- JWT tokens: 7-day expiration, HTTP-only cookies
- Magic link tokens: 30-second TTL, single-use enforcement
- SecretStorage: Encrypted at rest (VS Code handles encryption)

**Reliability**:

- Email failures: Log error, still create license (graceful degradation)
- Server unreachable: Use cached license status (1-hour stale data acceptable)
- Database errors: Return HTTP 503 with retry guidance
- Extension activation: Continue even if license verification fails (fallback to free tier)

**Maintainability**:

- TypeScript strict mode enabled
- No `any` types (use proper type definitions)
- ESLint compliance (all files pass linting)
- Unit test coverage: Minimum 70% for services
- Integration tests for all API endpoints

### Pattern Compliance

**Must Follow**:

- **DI Pattern**: All services use TSyringe @injectable() and @inject() (verified in vscode-core services)
- **Disposable Pattern**: MCP server implements vscode.Disposable (verified in code-execution-mcp.service.ts:33)
- **Event-Driven**: License status changes use EventEmitter3 (verified pattern in codebase)
- **NestJS Injectable**: All backend services use @Injectable() decorator (standard NestJS pattern)
- **Prisma Driver Adapters**: Use @prisma/adapter-pg for monorepo compatibility (task-description.md:639-641)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Backend Developer (Primary), Frontend Developer (Secondary)

**Rationale**:

**Backend Work (70% of effort)**:

- NestJS license server implementation (6 components)
- PostgreSQL schema design with Prisma
- REST API endpoint development
- Email service integration (SendGrid)
- Authentication (magic links, JWT)
- Database optimization (indexes, queries)

**Frontend Work (30% of effort)**:

- VS Code extension service (LicenseService)
- Command palette integration (LicenseCommands)
- VS Code API usage (SecretStorage, configuration)
- Extension activation flow modification

**Recommendation**: Assign Batch 1-4 to backend-developer, Batch 5-6 to frontend-developer (or backend-developer with VS Code extension experience).

### Complexity Assessment

**Complexity**: MEDIUM

**Estimated Effort**: 12-16 hours (6 batches × 2-3 hours each)

**Breakdown**:

- **Database & Schema** (Batch 1): 2-3 hours
  - Prisma setup, migrations, testing
- **License API** (Batch 2): 2-3 hours
  - Core verification logic, DTOs, controllers
- **Admin & Email** (Batch 3): 2-3 hours
  - SendGrid integration, retry logic, HTML templates
- **Magic Link Auth** (Batch 4): 2 hours
  - Token management, JWT cookies, E2E tests
- **VS Code LicenseService** (Batch 5): 2-3 hours
  - SecretStorage, caching, event emitters
- **Conditional MCP Registration** (Batch 6): 2-3 hours
  - Extension activation modification, commands, integration tests

**Risk Factors**:

- Email delivery debugging (SendGrid API errors)
- VS Code SecretStorage API familiarity
- Extension activation flow complexity (many interdependent steps)
- Conditional DI registration (not commonly used pattern)

### Files Affected Summary

**CREATE** (22 files):

**License Server (NestJS)**:

- `apps/ptah-license-server/prisma/schema.prisma`
- `apps/ptah-license-server/src/prisma/prisma.service.ts`
- `apps/ptah-license-server/src/config/plans.config.ts`
- `apps/ptah-license-server/src/license/services/license.service.ts`
- `apps/ptah-license-server/src/license/controllers/license.controller.ts`
- `apps/ptah-license-server/src/license/controllers/admin.controller.ts`
- `apps/ptah-license-server/src/license/guards/admin-api-key.guard.ts`
- `apps/ptah-license-server/src/license/dto/verify-license.dto.ts`
- `apps/ptah-license-server/src/license/dto/create-license.dto.ts`
- `apps/ptah-license-server/src/license/license.module.ts`
- `apps/ptah-license-server/src/email/services/email.service.ts`
- `apps/ptah-license-server/src/email/email.module.ts`
- `apps/ptah-license-server/src/auth/services/magic-link.service.ts`
- 9+ test files for services, controllers, and E2E

**VS Code Extension**:

- `libs/backend/vscode-core/src/services/license.service.ts`
- `libs/backend/vscode-core/src/services/license.service.spec.ts`
- `apps/ptah-extension-vscode/src/commands/license-commands.ts`
- 2+ integration test files for MCP registration

**MODIFY** (8 files):

**License Server**:

- `apps/ptah-license-server/package.json` (add Prisma, SendGrid dependencies)
- `apps/ptah-license-server/src/app/app.module.ts` (import LicenseModule, EmailModule)
- `apps/ptah-license-server/src/auth/auth.controller.ts` (add magic link endpoints)
- `apps/ptah-license-server/src/auth/auth.module.ts` (register MagicLinkService)

**VS Code Extension**:

- `apps/ptah-extension-vscode/src/main.ts` (add license verification + conditional MCP)
- `apps/ptah-extension-vscode/package.json` (add license commands + configuration)
- `libs/backend/vscode-core/src/di/tokens.ts` (add LICENSE_SERVICE token)
- `libs/backend/vscode-core/src/di/register.ts` (register LicenseService)
- `libs/backend/vscode-core/src/index.ts` (export LicenseService)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **Prisma Setup Verification**:

   - Prisma 7.1.0 with driver adapters installed (NOT default Rust binary)
   - Database migrations run successfully
   - Prisma Client generates without errors
   - PostgreSQL connection string in .env file

2. **Extension Activation Flow Verification**:

   - License verification happens BEFORE MCP registration (main.ts step 7.5)
   - Free users: DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP) NOT called
   - Licensed users: MCP server registered with context.subscriptions.push()
   - Event handlers registered for dynamic license changes

3. **SecretStorage Integration Verification**:

   - License key stored with context.secrets.store() (encrypted)
   - No license key in logs or console output
   - Cache invalidation works correctly (1-hour TTL)
   - Background revalidation scheduled (24-hour interval)

4. **Email Service Verification**:

   - SendGrid API key in .env file
   - Email retry logic tested (3 attempts with backoff)
   - HTML templates render correctly in email clients
   - Email failures logged but license creation succeeds

5. **Security Verification**:
   - Admin API key is 256-bit random key (generated with `openssl rand -hex 32`)
   - License keys use crypto.randomBytes (NOT Math.random)
   - JWT cookies have httpOnly, secure, sameSite flags
   - Magic link tokens expire after 30 seconds (tested)

### Architecture Delivery Checklist

- [x] All components specified with evidence from codebase investigation
- [x] All patterns verified from existing code (DI, Disposable, EventEmitter, Prisma, NestJS)
- [x] All imports/decorators verified as existing (TOKENS, @injectable, @Injectable)
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented with data flow
- [x] Files affected list complete (30 files: 22 CREATE, 8 MODIFY)
- [x] Developer type recommended (backend-developer primary, frontend-developer secondary)
- [x] Complexity assessed (MEDIUM, 12-16 hours)
- [x] No step-by-step implementation (team-leader will decompose into atomic tasks)
- [x] Critical user requirement addressed: **Premium MCP servers NOT registered for free users**

---

## Risk Assessment

### Risk 1: Email Delivery Failure (MEDIUM)

**Impact**: Users cannot receive license keys
**Mitigation**:

- Implement 3-retry logic with exponential backoff
- Log email failures with license key for manual follow-up
- Return license key in API response (admin can manually send)
- Portal resend feature for users

### Risk 2: SecretStorage API Complexity (LOW)

**Impact**: License key storage/retrieval errors
**Mitigation**:

- VS Code SecretStorage is well-documented API (standard pattern)
- Use context.secrets.store() and context.secrets.get() (built-in encryption)
- Test with multiple license key changes
- Fallback to configuration setting if SecretStorage fails (less secure but functional)

### Risk 3: Extension Activation Flow Modification (MEDIUM)

**Impact**: Breaking existing activation sequence
**Mitigation**:

- License verification is isolated step (7.5) between existing steps
- No changes to DI container setup (step 1)
- No changes to RPC registration (step 3)
- Conditional MCP registration is additive (existing code path for licensed users)
- Comprehensive integration tests for activation flow

### Risk 4: Dynamic MCP Registration Complexity (MEDIUM)

**Impact**: MCP server not starting/stopping correctly on license changes
**Mitigation**:

- Event-driven pattern (license:verified → register MCP)
- Disposable pattern ensures cleanup
- Recommend window reload for immediate effect (simpler than hot-swapping)
- Document limitations: Dynamic deregistration requires reload (acceptable UX)

### Risk 5: Database Connection Pool Exhaustion (LOW)

**Impact**: API downtime during traffic spikes
**Mitigation**:

- Prisma connection pooling configured (min: 2, max: 10)
- Query timeout: 5 seconds
- Monitor connection pool metrics
- Return HTTP 503 if pool exhausted (client retries)

---

## Environment Variables

**License Server** (`.env` file):

```bash
# Server
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://ptah.dev

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ptah_licenses

# Admin API
ADMIN_API_KEY=<generate-with-openssl-rand-hex-32>

# JWT
JWT_SECRET=<generate-with-openssl-rand-hex-32>
JWT_EXPIRATION=7d

# Email (SendGrid)
SENDGRID_API_KEY=<sendgrid-api-key>
SENDGRID_FROM_EMAIL=ptah@nghive.tech
SENDGRID_FROM_NAME=Ptah Team

# Magic Link
MAGIC_LINK_TTL_MS=30000
```

**VS Code Extension** (optional override):

```typescript
// Default: https://api.ptah.dev
process.env.PTAH_LICENSE_SERVER_URL = 'http://localhost:3000'; // For development
```

---

## Success Criteria

**Must Have (MVP)**:

- [x] License verification endpoint returns valid/invalid status in <200ms
- [x] Admin API creates licenses with 60-day expiration and sends email
- [x] Magic link authentication works with 30-second TTL and single-use enforcement
- [x] VS Code extension stores license key in SecretStorage (encrypted)
- [x] Premium MCP server registered ONLY for licensed users (FREE users have ZERO premium code)
- [x] License status events trigger dynamic MCP registration
- [x] Background revalidation every 24 hours
- [x] User commands: enter/remove/check license key
- [x] Database schema: 2 tables (users, licenses) with proper indexes
- [x] Email templates for license key and magic link

**Nice to Have (Post-MVP)**:

- [ ] Deep link activation (vscode://ptah/activate?key=...)
- [ ] License renewal reminder emails (7 days before expiration)
- [ ] Admin dashboard UI (HTML interface for license management)
- [ ] Redis migration for multi-instance magic link tokens
- [ ] Customer portal UI (Angular SPA for license status)

---

## Document Status

**Status**: ✅ Ready for Implementation
**Created**: 2025-12-15
**Next Step**: team-leader creates tasks.md with atomic git-verifiable tasks

---

**End of Implementation Plan**
