# Implementation Plan - Phase A: Infrastructure + Backend

**Task ID**: TASK_2025_112A
**Phase**: Infrastructure + Backend
**Dependency**: None (this is the foundation)
**Blocks**: Phase B (Frontend Integration)

---

## Overview

Phase A establishes the infrastructure and backend services required for the production license system. This includes Docker development environment, Paddle payment integration, WorkOS authentication enhancement, and deployment documentation.

### Scope

| #   | Component          | Description                                               |
| --- | ------------------ | --------------------------------------------------------- |
| 1   | Docker Compose     | Local dev environment (PostgreSQL, Redis, license-server) |
| 2   | Paddle Webhooks    | Subscription lifecycle (created, updated, canceled)       |
| 3   | WorkOS PKCE        | Upgrade auth to OAuth 2.1 compliant PKCE flow             |
| 4   | Environment Config | Comprehensive .env.example with setup guides              |
| 5   | Deployment Docs    | DigitalOcean App Platform deployment guide                |

---

## Architecture Investigation Findings

### Current State Analysis

#### Finding 1: No Docker Compose

**Status**: ❌ Not configured
**Evidence**: `Glob("**/docker-compose*.yml")` returns no files

**Impact**: Developers must manually set up PostgreSQL and cannot run full stack locally

#### Finding 2: WorkOS Auth Without PKCE

**Status**: ⚠️ Functional but not OAuth 2.1 compliant
**Evidence**: [auth.service.ts:40-44](file:///d:/projects/ptah-extension/apps/ptah-license-server/src/app/auth/services/auth.service.ts:40-44)

```typescript
return this.workos.userManagement.getAuthorizationUrl({
  provider: 'authkit',
  clientId,
  redirectUri,
});
// Missing: codeVerifier, codeChallenge (PKCE)
```

**Impact**: Less secure; OAuth 2.1 mandates PKCE for all clients

#### Finding 3: No Paddle Integration

**Status**: ❌ Not implemented
**Evidence**: No `@paddle/paddle-node-sdk` in package.json, no webhook handlers

**Impact**: Cannot automate license provisioning from payments

#### Finding 4: Prisma Schema Ready

**Status**: ✅ User and License models exist
**Evidence**: [schema.prisma:14-40](file:///d:/projects/ptah-extension/apps/ptah-license-server/prisma/schema.prisma:14-40)

**Impact**: Database structure supports license management; may need Subscription model for Paddle

#### Finding 5: Partial .env.example

**Status**: ⚠️ Exists but incomplete
**Evidence**: [.env.example](file:///d:/projects/ptah-extension/apps/ptah-license-server/.env.example)

Missing:

- WorkOS configuration (WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_REDIRECT_URI)
- Paddle configuration (PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET)
- Redis configuration (REDIS_URL)

---

## Proposed Changes

### Phase A.1: Docker Compose Setup

#### [NEW] docker-compose.yml

**Path**: `d:\projects\ptah-extension\docker-compose.yml`

**Purpose**: One-command local development environment

**Services**:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: ptah_postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-ptah_licenses}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - '${POSTGRES_PORT:-5432}:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - ptah-network

  redis:
    image: redis:7-alpine
    container_name: ptah_redis
    volumes:
      - redis-data:/data
    ports:
      - '${REDIS_PORT:-6379}:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - ptah-network

  license-server:
    build:
      context: .
      dockerfile: apps/ptah-license-server/Dockerfile.dev
    container_name: ptah_license_server
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - apps/ptah-license-server/.env
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/ptah_licenses
      REDIS_URL: redis://redis:6379
    volumes:
      - ./apps/ptah-license-server:/app
      - license-server-node-modules:/app/node_modules
    ports:
      - '${LICENSE_SERVER_PORT:-3000}:3000'
    command: >
      sh -c "npx prisma migrate deploy && npm run start:dev"
    networks:
      - ptah-network

volumes:
  postgres-data:
  redis-data:
  license-server-node-modules:

networks:
  ptah-network:
    driver: bridge
```

**Evidence**: Research findings - Docker Compose best practices with health checks

---

#### [NEW] Dockerfile.dev (License Server)

**Path**: `d:\projects\ptah-extension\apps\ptah-license-server\Dockerfile.dev`

**Purpose**: Development container with hot-reload

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies for Prisma
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY apps/ptah-license-server/package*.json ./apps/ptah-license-server/

# Install dependencies
RUN npm ci

# Copy Prisma schema
COPY apps/ptah-license-server/prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code (will be overwritten by volume mount)
COPY apps/ptah-license-server ./

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
```

---

#### [NEW] .env.docker

**Path**: `d:\projects\ptah-extension\.env.docker`

**Purpose**: Docker Compose environment variables

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

---

### Phase A.2: Paddle Payment Integration

#### [NEW] Paddle Webhook Module

**Path**: `d:\projects\ptah-extension\apps\ptah-license-server\src\paddle\`

**Files**:

- `paddle.module.ts` - NestJS module
- `paddle.controller.ts` - Webhook handler
- `paddle.service.ts` - Business logic
- `dto/paddle-webhook.dto.ts` - Webhook payload DTOs

---

#### [NEW] paddle.controller.ts

**Purpose**: Handle Paddle webhook events

```typescript
@Controller('webhooks/paddle')
export class PaddleController {
  constructor(private readonly paddleService: PaddleService) {}

  /**
   * Paddle webhook endpoint
   *
   * POST /webhooks/paddle
   *
   * Handles events:
   * - subscription.created → Create license
   * - subscription.updated → Update license tier
   * - subscription.canceled → Revoke license on period end
   *
   * Security:
   * - Verifies webhook signature (HMAC SHA256)
   * - Idempotent processing (checks event ID)
   */
  @Post()
  @HttpCode(200)
  async handleWebhook(@Headers('paddle-signature') signature: string, @Body() payload: any, @Req() req: Request) {
    // Step 1: Verify signature
    const isValid = this.paddleService.verifySignature(signature, req.rawBody);
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Step 2: Process event (idempotent)
    const eventType = payload.event_type;
    const eventId = payload.event_id;

    switch (eventType) {
      case 'subscription.created':
        return this.paddleService.handleSubscriptionCreated(payload.data, eventId);
      case 'subscription.updated':
        return this.paddleService.handleSubscriptionUpdated(payload.data, eventId);
      case 'subscription.canceled':
        return this.paddleService.handleSubscriptionCanceled(payload.data, eventId);
      default:
        return { received: true };
    }
  }
}
```

**Evidence**: Research findings - Paddle webhook security best practices

---

#### [NEW] paddle.service.ts

**Purpose**: Paddle business logic and license provisioning

```typescript
@Injectable()
export class PaddleService {
  private readonly paddle: Paddle;

  constructor(private readonly configService: ConfigService, private readonly prisma: PrismaService, private readonly emailService: EmailService) {
    this.paddle = new Paddle({
      apiKey: this.configService.get('PADDLE_API_KEY'),
      environment: this.configService.get('NODE_ENV') === 'production' ? 'production' : 'sandbox',
    });
  }

  /**
   * Verify Paddle webhook signature
   */
  verifySignature(signature: string, rawBody: Buffer): boolean {
    const [ts, h1] = signature.split(';').map((pair) => pair.split('=')[1]);
    const signedPayload = `${ts}:${rawBody.toString()}`;
    const secret = this.configService.get('PADDLE_WEBHOOK_SECRET');

    const expectedSignature = createHmac('sha256', secret).update(signedPayload).digest('hex');

    return timingSafeEqual(Buffer.from(h1), Buffer.from(expectedSignature));
  }

  /**
   * Handle subscription.created event
   * Creates user (if new) and license, sends welcome email
   */
  async handleSubscriptionCreated(data: any, eventId: string) {
    // Idempotency check
    const existing = await this.prisma.license.findFirst({
      where: { createdBy: `paddle_${eventId}` },
    });
    if (existing) return { duplicate: true };

    // Extract customer info
    const email = data.customer.email;
    const priceId = data.items[0]?.price?.id;
    const plan = this.mapPriceIdToPlan(priceId);

    // Create or find user
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({ data: { email } });
    }

    // Generate license key
    const licenseKey = this.generateLicenseKey();

    // Create license
    const license = await this.prisma.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan,
        status: 'active',
        expiresAt: new Date(data.current_billing_period.ends_at),
        createdBy: `paddle_${eventId}`,
      },
    });

    // Send license email
    await this.emailService.sendLicenseKey({
      email,
      licenseKey,
      plan,
      expiresAt: license.expiresAt,
    });

    return { success: true, licenseId: license.id };
  }

  /**
   * Handle subscription.updated event
   * Updates license tier or expiration
   */
  async handleSubscriptionUpdated(data: any, eventId: string) {
    const email = data.customer.email;
    const priceId = data.items[0]?.price?.id;
    const newPlan = this.mapPriceIdToPlan(priceId);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { error: 'User not found' };

    await this.prisma.license.updateMany({
      where: { userId: user.id, status: 'active' },
      data: {
        plan: newPlan,
        expiresAt: new Date(data.current_billing_period.ends_at),
      },
    });

    return { success: true };
  }

  /**
   * Handle subscription.canceled event
   * Marks license for expiration at period end
   */
  async handleSubscriptionCanceled(data: any, eventId: string) {
    const email = data.customer.email;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { error: 'User not found' };

    // Don't revoke immediately - let them use until period ends
    // Status will change to 'expired' via cron job after expiresAt
    await this.prisma.license.updateMany({
      where: { userId: user.id, status: 'active' },
      data: {
        expiresAt: new Date(data.current_billing_period.ends_at),
      },
    });

    return { success: true };
  }

  private mapPriceIdToPlan(priceId: string): string {
    const mapping = {
      [this.configService.get('PADDLE_PRICE_ID_EARLY_ADOPTER')]: 'early_adopter',
      [this.configService.get('PADDLE_PRICE_ID_PRO')]: 'pro',
    };
    return mapping[priceId] || 'free';
  }

  private generateLicenseKey(): string {
    return `PTAH-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
```

---

#### [MODIFY] schema.prisma

**Add Subscription model** for Paddle subscription tracking:

```diff
+// Subscription model - tracks Paddle subscription state
+model Subscription {
+  id                String    @id @default(uuid()) @db.Uuid
+  userId            String    @map("user_id") @db.Uuid
+  paddleSubscriptionId String @unique @map("paddle_subscription_id")
+  paddleCustomerId  String    @map("paddle_customer_id")
+  status            String    // "active" | "paused" | "canceled" | "past_due"
+  priceId           String    @map("price_id")
+  currentPeriodEnd  DateTime  @map("current_period_end")
+  canceledAt        DateTime? @map("canceled_at")
+  createdAt         DateTime  @default(now()) @map("created_at")
+  updatedAt         DateTime  @updatedAt @map("updated_at")
+
+  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
+
+  @@index([paddleSubscriptionId])
+  @@index([userId])
+  @@map("subscriptions")
+}

 model User {
   id        String    @id @default(uuid()) @db.Uuid
   email     String    @unique
   createdAt DateTime  @default(now()) @map("created_at")
   licenses  License[]
+  subscriptions Subscription[]

   @@map("users")
 }
```

---

#### [MODIFY] app.module.ts

**Add Paddle and Auth modules**:

```diff
 import { Module } from '@nestjs/common';
+import { ConfigModule } from '@nestjs/config';
 import { AppController } from './app.controller';
 import { AppService } from './app.service';
 import { PrismaModule } from '../prisma/prisma.module';
 import { LicenseModule } from '../license/license.module';
+import { AuthModule } from './auth/auth.module';
+import { PaddleModule } from '../paddle/paddle.module';

 @Module({
-  imports: [PrismaModule, LicenseModule],
+  imports: [
+    ConfigModule.forRoot({ isGlobal: true }),
+    PrismaModule,
+    LicenseModule,
+    AuthModule,
+    PaddleModule,
+  ],
   controllers: [AppController],
   providers: [AppService],
 })
 export class AppModule {}
```

---

### Phase A.3: WorkOS PKCE Enhancement

#### [MODIFY] auth.service.ts

**Add PKCE support** (OAuth 2.1 compliant):

```diff
+import { randomBytes, createHash } from 'crypto';

 @Injectable()
 export class AuthService {
   private readonly workos: WorkOS;
+  private readonly codeVerifiers: Map<string, { verifier: string; expiresAt: number }> = new Map();

   // ... existing constructor ...

   /**
    * Generate WorkOS authorization URL with PKCE
    */
-  async getAuthorizationUrl(): Promise<string> {
+  async getAuthorizationUrl(): Promise<{ url: string; state: string }> {
     const clientId = this.configService.get<string>('WORKOS_CLIENT_ID');
     const redirectUri = this.configService.get<string>('WORKOS_REDIRECT_URI');

     if (!clientId || !redirectUri) {
       throw new Error('WORKOS_CLIENT_ID and WORKOS_REDIRECT_URI must be configured');
     }

+    // Generate PKCE code verifier (43-128 characters)
+    const codeVerifier = randomBytes(32).toString('base64url');
+
+    // Generate code challenge (SHA256 hash of verifier)
+    const codeChallenge = createHash('sha256')
+      .update(codeVerifier)
+      .digest('base64url');
+
+    // Generate state for CSRF protection
+    const state = randomBytes(16).toString('hex');
+
+    // Store code verifier with 5-minute expiration
+    this.codeVerifiers.set(state, {
+      verifier: codeVerifier,
+      expiresAt: Date.now() + 5 * 60 * 1000,
+    });

-    return this.workos.userManagement.getAuthorizationUrl({
+    const url = this.workos.userManagement.getAuthorizationUrl({
       provider: 'authkit',
       clientId,
       redirectUri,
+      state,
+      codeChallenge,
+      codeChallengeMethod: 'S256',
     });
+
+    return { url, state };
   }

   /**
    * Authenticate with PKCE code exchange
    */
   async authenticateWithCode(
-    code: string
+    code: string,
+    state: string
   ): Promise<{ token: string; user: RequestUser }> {
     const clientId = this.configService.get<string>('WORKOS_CLIENT_ID');

     if (!clientId) {
       throw new UnauthorizedException('WorkOS client ID not configured');
     }

+    // Retrieve and validate code verifier
+    const stored = this.codeVerifiers.get(state);
+    if (!stored) {
+      throw new UnauthorizedException('Invalid or expired state');
+    }
+    if (Date.now() > stored.expiresAt) {
+      this.codeVerifiers.delete(state);
+      throw new UnauthorizedException('State expired');
+    }
+
+    const codeVerifier = stored.verifier;
+    this.codeVerifiers.delete(state); // Single-use

     try {
       const { user, organizationId } =
         await this.workos.userManagement.authenticateWithCode({
           clientId,
           code,
+          codeVerifier,
         });

       // ... rest of method unchanged ...
     }
   }
```

---

#### [MODIFY] auth.controller.ts

**Update login and callback to use PKCE**:

```diff
   @Get('login')
   async login(@Res() res: Response): Promise<void> {
-    const authorizationUrl = await this.authService.getAuthorizationUrl();
-    res.redirect(authorizationUrl);
+    const { url, state } = await this.authService.getAuthorizationUrl();
+
+    // Store state in short-lived cookie for CSRF validation
+    res.cookie('workos_state', state, {
+      httpOnly: true,
+      secure: process.env.NODE_ENV === 'production',
+      sameSite: 'lax',
+      maxAge: 5 * 60 * 1000, // 5 minutes
+      path: '/',
+    });
+
+    res.redirect(url);
   }

   @Get('callback')
   async callback(
     @Query('code') code: string,
+    @Query('state') state: string,
+    @Req() req: Request,
     @Res() res: Response
   ): Promise<void> {
     if (!code) {
       res.status(400).json({ error: 'Authorization code is required' });
       return;
     }

+    // Validate state matches cookie (CSRF protection)
+    const storedState = req.cookies?.workos_state;
+    if (!storedState || storedState !== state) {
+      res.status(401).json({ error: 'Invalid state parameter' });
+      return;
+    }
+
+    // Clear state cookie
+    res.clearCookie('workos_state');

     try {
-      const { token } = await this.authService.authenticateWithCode(code);
+      const { token } = await this.authService.authenticateWithCode(code, state);
       // ... rest unchanged ...
     }
   }
```

---

### Phase A.4: Environment Configuration

#### [MODIFY] .env.example (License Server)

**Path**: `d:\projects\ptah-extension\apps\ptah-license-server\.env.example`

```env
# ============================================
# Ptah License Server Environment Configuration
# ============================================
# Copy this file to .env and fill in your values
# NEVER commit .env to version control

# ============================================
# DATABASE CONFIGURATION
# ============================================
# PostgreSQL connection string
# Local: postgresql://postgres:postgres@localhost:5432/ptah_licenses
# Docker: postgresql://postgres:postgres@postgres:5432/ptah_licenses
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ptah_licenses"

# ============================================
# REDIS CONFIGURATION
# ============================================
# Used for session storage and caching
# Local: redis://localhost:6379
# Docker: redis://redis:6379
REDIS_URL="redis://localhost:6379"

# ============================================
# SERVER CONFIGURATION
# ============================================
PORT=3000
NODE_ENV=development

# Frontend URL for redirects after auth
FRONTEND_URL=http://localhost:4200

# ============================================
# JWT CONFIGURATION
# ============================================
# Generate with: openssl rand -hex 32
# SECURITY WARNING: Use a unique, random value in production
JWT_SECRET=CHANGE_ME_generate_with_openssl_rand_hex_32
JWT_EXPIRATION=7d

# ============================================
# ADMIN API SECURITY
# ============================================
# Generate with: openssl rand -hex 32
# Used for admin endpoints (license creation, etc.)
ADMIN_API_KEY=CHANGE_ME_generate_with_openssl_rand_hex_32

# ============================================
# WORKOS AUTHENTICATION
# ============================================
# Create account: https://workos.com/
# Dashboard: https://dashboard.workos.com/
#
# 1. Create new environment (Development/Production)
# 2. Copy API Key from "API Keys" section
# 3. Copy Client ID from "Configuration" → "OAuth"
# 4. Add redirect URI: http://localhost:3000/auth/callback

WORKOS_API_KEY=sk_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
WORKOS_CLIENT_ID=client_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback

# Optional: WorkOS logout redirect
WORKOS_LOGOUT_REDIRECT_URI=http://localhost:4200

# ============================================
# PADDLE PAYMENT INTEGRATION
# ============================================
# Create account: https://www.paddle.com/
# Sandbox: https://sandbox-vendors.paddle.com/
# Production: https://vendors.paddle.com/
#
# 1. Go to Developer Tools → Authentication
# 2. Generate API key
# 3. Go to Developer Tools → Webhooks
# 4. Add endpoint: https://your-domain.com/webhooks/paddle
# 5. Copy webhook secret

PADDLE_API_KEY=pdl_sbox_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_WEBHOOK_SECRET=pdl_ntfset_XXXXXXXXXXXXXXXXXXXXXXXX

# Paddle Price IDs (from Products → Prices in Paddle dashboard)
PADDLE_PRICE_ID_EARLY_ADOPTER=pri_XXXXXXXXXXXXXXXXXXXXXXXX
PADDLE_PRICE_ID_PRO=pri_YYYYYYYYYYYYYYYYYYYYYYYY

# ============================================
# EMAIL SERVICE (SendGrid)
# ============================================
# Create account: https://sendgrid.com/
# Get API key: Settings → API Keys → Create API Key
#
# Required permissions: Mail Send

SENDGRID_API_KEY=SG.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SENDGRID_FROM_EMAIL=ptah@nghive.tech
SENDGRID_FROM_NAME=Ptah Team

# ============================================
# MAGIC LINK CONFIGURATION
# ============================================
# TTL in milliseconds (30 seconds = 30000)
MAGIC_LINK_TTL_MS=30000
```

---

#### [NEW] .env.docker.example

**Path**: `d:\projects\ptah-extension\.env.docker.example`

```env
# ============================================
# Docker Compose Environment Variables
# ============================================
# Copy this file to .env.docker and customize if needed
# Default values work out of the box

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

---

### Phase A.5: DigitalOcean Deployment Documentation

#### [NEW] docs/deployment/DIGITALOCEAN.md

**Path**: `d:\projects\ptah-extension\docs\deployment\DIGITALOCEAN.md`

**Purpose**: Step-by-step deployment guide

**Content outline**:

1. **Prerequisites**

   - DigitalOcean account with API token
   - Domain name (optional but recommended)
   - Paddle production account configured
   - WorkOS production environment configured

2. **Architecture Overview**

   ```
   [Landing Page] → DigitalOcean Spaces + CDN
                   ↓
   [License Server] → App Platform (auto-scaling)
                   ↓
   [Database] → Managed PostgreSQL HA
                   ↓
   [Cache] → Managed Redis
   ```

3. **Step-by-Step Deployment**

   - Create Managed PostgreSQL cluster
   - Create Managed Redis cluster
   - Deploy license server to App Platform
   - Deploy frontend to Spaces with CDN
   - Configure custom domain and SSL
   - Set up monitoring and alerts

4. **App Platform spec.yaml**

   ```yaml
   name: ptah-license-server
   services:
     - name: api
       github:
         repo: your-org/ptah-extension
         branch: main
         deploy_on_push: true
       source_dir: apps/ptah-license-server
       build_command: npm run build
       run_command: node dist/main.js
       http_port: 3000
       instance_count: 1
       instance_size_slug: basic-xxs
       envs:
         - key: DATABASE_URL
           scope: RUN_TIME
           type: SECRET
         - key: REDIS_URL
           scope: RUN_TIME
           type: SECRET
         # ... other env vars
   ```

5. **Cost Estimation**

   | Service            | Size  | Monthly Cost   |
   | ------------------ | ----- | -------------- |
   | App Platform       | Basic | $5             |
   | Managed PostgreSQL | 1GB   | $15            |
   | Managed Redis      | 1GB   | $15            |
   | Spaces + CDN       | 250GB | $5             |
   | **Total**          |       | **~$40/month** |

6. **Scaling Guidelines**
   - When to upgrade PostgreSQL (CPU > 70%)
   - When to add App Platform instances (response time > 500ms)
   - CDN caching configuration

---

## Verification Plan

### Docker Compose Verification

```bash
# Start all services
docker-compose up -d

# Verify services are running
docker-compose ps

# Expected output:
# ptah_postgres      running   0.0.0.0:5432->5432/tcp
# ptah_redis         running   0.0.0.0:6379->6379/tcp
# ptah_license_server running  0.0.0.0:3000->3000/tcp

# Test license server health
curl http://localhost:3000/health

# Test database connection
docker exec ptah_postgres pg_isready -U postgres

# Test Redis connection
docker exec ptah_redis redis-cli ping
```

### Paddle Webhook Verification

```bash
# Use Paddle CLI or webhook testing tool
# Simulate subscription.created event

curl -X POST http://localhost:3000/webhooks/paddle \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: ts=..;h1=..." \
  -d '{
    "event_type": "subscription.created",
    "event_id": "evt_test_123",
    "data": {
      "customer": { "email": "test@example.com" },
      "items": [{ "price": { "id": "pri_early_adopter" } }],
      "current_billing_period": { "ends_at": "2026-02-22T00:00:00Z" }
    }
  }'

# Verify license was created
curl http://localhost:3000/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{ "licenseKey": "PTAH-XXXX-XXXX-XXXX" }'
```

### WorkOS PKCE Verification

```bash
# 1. Navigate to login endpoint
open http://localhost:3000/auth/login

# 2. Check redirect URL contains:
#    - code_challenge parameter
#    - code_challenge_method=S256
#    - state parameter

# 3. Complete auth flow
# 4. Verify JWT cookie is set with correct claims
```

### Environment Configuration Checklist

- [ ] `.env.example` has all required variables documented
- [ ] `.env.docker.example` has Docker-specific variables
- [ ] All secrets have generation instructions
- [ ] All external services have setup URLs
- [ ] Security warnings on sensitive variables

---

## Dependencies

### NPM Packages to Install

```bash
# Backend
npm install @paddle/paddle-node-sdk@^2.0.0
npm install ioredis@^5.0.0  # For session storage (if needed)

# Already installed (verify versions):
# @workos-inc/node@^6.0.0
# @nestjs/config@^3.0.0
# @prisma/client@^7.1.0
```

### External Services Setup

| Service      | Purpose  | Setup URL                             |
| ------------ | -------- | ------------------------------------- |
| Paddle       | Payments | <https://sandbox-vendors.paddle.com/> |
| WorkOS       | Auth     | <https://dashboard.workos.com/>       |
| SendGrid     | Email    | <https://app.sendgrid.com/>           |
| DigitalOcean | Hosting  | <https://cloud.digitalocean.com/>     |

---

## Risk Mitigation

### Risk 1: Paddle Webhook Failures

**Probability**: Medium (15%)
**Impact**: Critical (users pay but don't get license)

**Mitigation**:

- Idempotent handlers (check event ID)
- Manual license creation admin endpoint as fallback
- Alert on webhook processing errors

### Risk 2: WorkOS PKCE State Storage

**Probability**: Low (10%)
**Impact**: Medium (auth failures if state lost)

**Mitigation**:

- In-memory Map for development (current)
- Redis for production (stateless servers)
- 5-minute expiration prevents memory leaks

### Risk 3: Docker Volume Performance on Windows

**Probability**: Medium (25%)
**Impact**: Medium (slow development)

**Mitigation**:

- Document WSL2 filesystem recommendation
- Use named volumes for node_modules
- Provide non-Docker setup instructions as fallback

---

## Out of Scope (Phase B)

- ❌ Angular routing infrastructure
- ❌ Pricing page UI
- ❌ Login page UI
- ❌ Profile page UI
- ❌ Design assets integration
- ❌ Paddle Checkout SDK (frontend)

---

## Approved By

**Status**: **PENDING USER REVIEW** ✋

> **User**: Please review this Phase A implementation plan and reply with:
>
> 1. "APPROVED ✅" to proceed to Team-Leader for task breakdown
> 2. Feedback, questions, or changes if needed

---

**Document Version**: 1.0
**Created**: 2026-01-22T16:00:00+02:00
**Phase**: A (Infrastructure + Backend)
**Software Architect**: Orchestrator (Evidence-Driven)
