# Development Tasks - TASK_2025_043

**Total Tasks**: 20 | **Batches**: 5 | **Status**: 0/5 complete
**Estimated Time**: 4-5 days (32-40 hours)

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- **Prisma Driver Adapters**: Verified in official Prisma docs (v7.1.0)
- **Magic Link Pattern**: Verified - TicketService exists at `apps/ptah-license-server/src/app/auth/services/ticket.service.ts` with exact pattern needed
- **Landing Page App**: Verified - `apps/ptah-landing-page` exists with pages, sections, and services folders
- **License Server App**: Verified - `apps/ptah-license-server` exists with auth module structure

### Risks Identified

| Risk                                     | Severity | Mitigation                                                                                          |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| Paymob HMAC query parameter (not header) | HIGH     | Implementation plan provides exact guard code (line 587). Test in Paymob sandbox before production. |
| Driver adapters new to team              | MEDIUM   | Task 1.1 includes explicit setup instructions and verification steps.                               |
| Customer portal in existing landing page | LOW      | Landing page structure verified, portal pages will be added cleanly.                                |

### Edge Cases to Handle

- [x] License key collision (unlikely but handled) → Task 1.6 includes retry logic
- [x] Race condition: permission arrives before tool node → Not applicable to license server
- [x] Email delivery failures → Task 1.7 includes retry with exponential backoff
- [x] Duplicate webhook processing → Task 1.4 includes idempotency check

---

## Batch 1: Backend Core (Day 1-2) 🔄 IN PROGRESS

**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: None

### Task 1.1: Setup Prisma with driver adapters 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma (CREATE)
**Spec Reference**: implementation-plan.md:95-150
**Pattern**: https://www.prisma.io/docs/orm/overview/databases/database-drivers#driver-adapters

**Quality Requirements**:

- MUST use `previewFeatures = ["driverAdapters"]` in generator
- MUST NOT use Rust binary compilation
- Database connection MUST use `@prisma/adapter-pg` with `pg` driver

**Validation Notes**:

- This is a new Prisma 7.1.0 feature - verify official docs if any issues
- Test database connection succeeds before proceeding to Task 1.2

**Implementation Details**:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  createdAt     DateTime       @default(now())
  subscriptions Subscription[]
  licenses      License[]
  @@map("users")
}

model Subscription {
  id                   String   @id @default(uuid())
  userId               String
  paymobSubscriptionId String?  @unique
  status               String   @default("active")
  currentPeriodEnd     DateTime?
  createdAt            DateTime @default(now())
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("subscriptions")
}

model License {
  id         String   @id @default(uuid())
  userId     String
  licenseKey String   @unique
  status     String   @default("active")
  expiresAt  DateTime?
  createdAt  DateTime @default(now())
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([licenseKey])
  @@index([userId])
  @@map("licenses")
}
```

**Acceptance Criteria**:

- [ ] File created at exact path: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`
- [ ] Contains `previewFeatures = ["driverAdapters"]` in generator block
- [ ] All 3 models defined: User, Subscription, License
- [ ] Indexes on licenseKey and userId for fast lookups

**Estimated**: 1 hour

---

### Task 1.2: Create PrismaService with driver adapters 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\database\prisma.service.ts (CREATE)
**Dependencies**: Task 1.1 (needs schema.prisma)
**Spec Reference**: implementation-plan.md:159-197
**Pattern**: NestJS + Prisma driver adapters integration

**Quality Requirements**:

- MUST create PostgreSQL Pool with connection string from config
- MUST create PrismaPg adapter before PrismaClient initialization
- MUST implement OnModuleInit and OnModuleDestroy lifecycle hooks
- MUST close both Prisma client and Pool on destroy

**Validation Notes**:

- Driver adapter must be created BEFORE calling `super({ adapter })`
- Pool must be stored for cleanup in onModuleDestroy

**Implementation Details**:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {
    const pool = new Pool({
      connectionString: configService.get<string>('DATABASE_URL'),
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-license-server\src\database\prisma.service.ts`
- [ ] Uses `@prisma/adapter-pg` and `pg` packages
- [ ] Extends PrismaClient and implements lifecycle interfaces
- [ ] Pool cleanup in onModuleDestroy

**Estimated**: 1 hour

---

### Task 1.3: Run Prisma migrations to create database tables 🔄 IN PROGRESS

**File**: Database migration (generates `D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\*`)
**Dependencies**: Task 1.2 (needs PrismaService)
**Spec Reference**: implementation-plan.md:95-150

**Quality Requirements**:

- MUST verify DATABASE_URL environment variable is set
- MUST create migration with descriptive name: `init_license_tables`
- All 3 tables MUST exist after migration: users, subscriptions, licenses
- Indexes MUST be created on licenseKey and userId

**Validation Notes**:

- If DATABASE_URL not set, task will fail - verify environment first
- Test migration in development before running in any shared environment

**Implementation Commands**:

```bash
cd D:\projects\ptah-extension\apps\ptah-license-server
npx prisma migrate dev --name init_license_tables
npx prisma generate
```

**Acceptance Criteria**:

- [ ] Migration files created in `prisma/migrations/` directory
- [ ] Database contains 3 tables: users, subscriptions, licenses
- [ ] Unique constraints on email and licenseKey working
- [ ] Foreign key constraints working (cascade delete)
- [ ] Prisma client generated successfully

**Estimated**: 30 minutes

---

### Task 1.4: Implement POST /api/v1/licenses/verify endpoint 🔄 IN PROGRESS

**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\licenses\licenses.module.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\licenses\licenses.controller.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\licenses\licenses.service.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\licenses\dto\verify-license.dto.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\licenses\dto\verify-license-response.dto.ts`

**Dependencies**: Task 1.3 (needs database with tables)
**Spec Reference**: implementation-plan.md:281-336
**Pattern**: NestJS controller + service pattern

**Quality Requirements**:

- Response time MUST be <200ms (p95 latency)
- MUST return 200 OK for both valid and invalid licenses (not 404)
- MUST check subscription status (active vs canceled/past_due)
- MUST handle database errors gracefully (return 503)

**Validation Notes**:

- License verification is PUBLIC endpoint (no auth guard)
- Invalid license should return `{ valid: false, tier: "free" }` not error

**Implementation Details**:

LicensesController:

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { LicensesService } from './licenses.service';
import { VerifyLicenseDto } from './dto/verify-license.dto';

@Controller('api/v1/licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyLicense(@Body() dto: VerifyLicenseDto) {
    return this.licensesService.verifyLicense(dto.licenseKey);
  }
}
```

LicensesService:

```typescript
@Injectable()
export class LicensesService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyLicense(licenseKey: string) {
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
      include: { user: { include: { subscriptions: true } } },
    });

    if (!license || license.status !== 'active') {
      return { valid: false, tier: 'free' };
    }

    const subscription = license.user.subscriptions.find((s) => s.status === 'active');
    if (!subscription) {
      return { valid: false, tier: 'free' };
    }

    return {
      valid: true,
      tier: 'premium',
      email: license.user.email,
      expiresAt: subscription.currentPeriodEnd,
    };
  }
}
```

**Acceptance Criteria**:

- [ ] All 5 files created at correct paths
- [ ] POST /api/v1/licenses/verify responds with correct schema
- [ ] Returns `{ valid: false, tier: "free" }` for invalid keys
- [ ] Returns `{ valid: true, tier: "premium", email, expiresAt }` for valid keys
- [ ] Handles canceled subscriptions correctly (returns valid: false)
- [ ] Response time <200ms tested locally

**Estimated**: 2 hours

---

### Task 1.5: Implement Paymob webhook with HMAC guard (query param) 🔄 IN PROGRESS

**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\common\guards\paymob-hmac.guard.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\webhooks\webhooks.module.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\webhooks\webhooks.controller.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\webhooks\webhooks.service.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\webhooks\dto\paymob-webhook.dto.ts`

**Dependencies**: Task 1.4 (needs PrismaService)
**Spec Reference**: implementation-plan.md:502-621
**Pattern**: NestJS guard for webhook signature verification

**Quality Requirements**:

- CRITICAL: HMAC MUST be read from query parameter (NOT header)
- MUST use timing-safe comparison to prevent timing attacks
- MUST return 401 Unauthorized for invalid signatures
- MUST process webhooks idempotently (check for duplicates)
- MUST handle TRANSACTION, SUBSCRIPTION_CANCELED, SUBSCRIPTION_RENEWED events

**Validation Notes**:

- Implementation plan line 587 clearly states: `@Query('hmac') hmac: string // Query param, NOT header`
- This is different from typical webhook patterns - test carefully in Paymob sandbox
- Guard must validate BEFORE controller method runs

**Implementation Details**:

PaymobHmacGuard:

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class PaymobHmacGuard implements CanActivate {
  private readonly hmacSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.hmacSecret = this.configService.get<string>('PAYMOB_HMAC_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const hmacParam = request.query.hmac; // ✅ Query parameter
    const body = request.body;

    if (!hmacParam) {
      throw new UnauthorizedException('Missing HMAC parameter');
    }

    const expectedHmac = crypto.createHmac('sha256', this.hmacSecret).update(JSON.stringify(body)).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(hmacParam), Buffer.from(expectedHmac))) {
      throw new UnauthorizedException('Invalid HMAC signature');
    }

    return true;
  }
}
```

WebhooksController:

```typescript
@Controller('api/v1/webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('paymob')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PaymobHmacGuard)
  async handlePaymob(
    @Body() payload: PaymobWebhookDto,
    @Query('hmac') hmac: string // ✅ Query param
  ): Promise<{ received: true }> {
    await this.webhooksService.processPaymob(payload);
    return { received: true };
  }
}
```

**Acceptance Criteria**:

- [ ] All 5 files created at correct paths
- [ ] PaymobHmacGuard reads HMAC from query parameter (verified in code review)
- [ ] Guard uses timing-safe comparison
- [ ] POST /api/v1/webhooks/paymob endpoint exists
- [ ] Returns 401 for invalid HMAC
- [ ] Returns 200 { received: true } for valid webhook

**Estimated**: 2 hours

---

### Task 1.6: Implement license key generator service 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\webhooks\services\license-key-generator.service.ts (CREATE)
**Dependencies**: Task 1.5 (WebhooksService needs this)
**Spec Reference**: implementation-plan.md:624-683
**Pattern**: Crypto randomBytes pattern (same as TicketService)

**Quality Requirements**:

- MUST use `crypto.randomBytes(32).toString('hex')` for 128-bit entropy
- MUST generate format: `ptah_lic_{32-hex-chars}`
- MUST retry on collision (check database unique constraint)
- MUST be cryptographically secure (no predictable patterns)

**Validation Notes**:

- Collision probability is extremely low (1 in 2^128) but handle gracefully
- Pattern matches existing TicketService at line 52 of ticket.service.ts

**Implementation Details**:

```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class LicenseKeyGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(): Promise<string> {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const randomHex = randomBytes(32).toString('hex');
      const licenseKey = `ptah_lic_${randomHex}`;

      // Check for collision
      const existing = await this.prisma.license.findUnique({
        where: { licenseKey },
      });

      if (!existing) {
        return licenseKey;
      }

      attempts++;
    }

    throw new Error('Failed to generate unique license key after 3 attempts');
  }
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-license-server\src\webhooks\services\license-key-generator.service.ts`
- [ ] Uses `crypto.randomBytes(32).toString('hex')`
- [ ] Format is exactly `ptah_lic_{32-hex}`
- [ ] Retry logic for collision (max 3 attempts)
- [ ] Injectable service with PrismaService dependency

**Estimated**: 1 hour

---

### Task 1.7: Implement email service with SendGrid 🔄 IN PROGRESS

**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\email.module.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\email.service.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\templates\license-key.hbs`

**Dependencies**: Task 1.6 (WebhooksService calls EmailService)
**Spec Reference**: implementation-plan.md:331-376 (SendGrid integration)
**Pattern**: SendGrid with Handlebars templates

**Quality Requirements**:

- MUST send email within 30 seconds of webhook processing
- MUST retry 3 times with exponential backoff (1s, 2s, 4s)
- MUST log failures for manual intervention
- Email subject MUST be "Your Ptah Premium License Key"
- Sender MUST be "noreply@ptah.dev"

**Validation Notes**:

- Email delivery is async - don't block webhook response
- If email fails after retries, log but don't throw (webhook already processed)

**Implementation Details**:

EmailService:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';
import * as handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    sgMail.setApiKey(apiKey);
  }

  async sendLicenseKey(email: string, licenseKey: string): Promise<void> {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const templatePath = path.join(__dirname, 'templates', 'license-key.hbs');
        const templateSource = await fs.readFile(templatePath, 'utf-8');
        const template = handlebars.compile(templateSource);
        const html = template({ licenseKey, email });

        await sgMail.send({
          to: email,
          from: 'noreply@ptah.dev',
          subject: 'Your Ptah Premium License Key',
          html,
        });

        this.logger.log(`License key email sent to ${email}`);
        return;
      } catch (error) {
        const retryDelay = Math.pow(2, attempt) * 1000;
        this.logger.error(`Email attempt ${attempt + 1} failed: ${error.message}`);

        if (attempt < maxRetries - 1) {
          await this.sleep(retryDelay);
        } else {
          this.logger.error(`Email delivery failed after ${maxRetries} attempts: ${email}`);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

license-key.hbs template:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Your Ptah Premium License Key</title>
  </head>
  <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1>Welcome to Ptah Premium!</h1>
    <p>Thank you for subscribing to Ptah Premium. Your license key is:</p>
    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <code style="font-size: 16px; font-weight: bold;">{{licenseKey}}</code>
    </div>
    <h2>How to activate:</h2>
    <ol>
      <li>Open VS Code</li>
      <li>Go to Settings (Ctrl+,)</li>
      <li>Search for "ptah.licenseKey"</li>
      <li>Paste your license key</li>
      <li>Restart VS Code</li>
    </ol>
    <p>Your premium features are now active!</p>
    <p style="margin-top: 40px; color: #666; font-size: 12px;">This email was sent to {{email}}. If you didn't subscribe, please contact support.</p>
  </body>
</html>
```

**Acceptance Criteria**:

- [ ] All 3 files created at correct paths
- [ ] SendGrid API key loaded from environment variable
- [ ] Retry logic with exponential backoff implemented
- [ ] Handlebars template renders correctly
- [ ] Email subject and sender match requirements
- [ ] Failures logged but don't throw errors

**Estimated**: 2 hours

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build ptah-license-server`
- Database tables created and migrations applied
- POST /api/v1/licenses/verify responds correctly
- POST /api/v1/webhooks/paymob validates HMAC from query param
- License key generation tested (format correct)
- Email service tested (template renders, retry works)

---

## Batch 2: Magic Link Auth (Day 2) ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete

### Task 2.1: Implement MagicLinkService (reuse TicketService pattern) ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\auth\services\magic-link.service.ts (CREATE)
**Dependencies**: Batch 1 (needs PrismaService for user lookup)
**Spec Reference**: implementation-plan.md:624-683
**Pattern to Follow**: apps/ptah-license-server/src/app/auth/services/ticket.service.ts:37-85

**Quality Requirements**:

- MUST use `crypto.randomBytes(32).toString('hex')` (same as TicketService)
- TTL MUST be exactly 30 seconds (matches TicketService)
- MUST enforce single-use (delete token after validation)
- MUST use in-memory Map with automatic cleanup
- MUST clear timeouts on module destroy

**Validation Notes**:

- Existing TicketService at apps/ptah-license-server/src/app/auth/services/ticket.service.ts is the EXACT pattern
- Copy the crypto and timeout patterns directly
- Replace userId/tenantId with just email for magic link

**Implementation Details**:

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class MagicLinkService implements OnModuleDestroy {
  private readonly MAGIC_LINK_TTL_MS = 30000; // 30 seconds
  private readonly tokens = new Map<
    string,
    {
      email: string;
      createdAt: number;
      timeoutId: NodeJS.Timeout;
    }
  >();

  async create(email: string): Promise<string> {
    const token = randomBytes(32).toString('hex');

    const timeoutId = setTimeout(() => {
      this.tokens.delete(token);
    }, this.MAGIC_LINK_TTL_MS);

    this.tokens.set(token, {
      email,
      createdAt: Date.now(),
      timeoutId,
    });

    return token;
  }

  async validateAndConsume(token: string): Promise<string | null> {
    const data = this.tokens.get(token);
    if (!data) {
      return null;
    }

    clearTimeout(data.timeoutId);
    this.tokens.delete(token);

    return data.email;
  }

  onModuleDestroy() {
    for (const data of this.tokens.values()) {
      clearTimeout(data.timeoutId);
    }
    this.tokens.clear();
  }
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-license-server\src\auth\services\magic-link.service.ts`
- [ ] Uses `crypto.randomBytes(32).toString('hex')` (verified in code)
- [ ] TTL is 30 seconds (verified in code)
- [ ] Single-use enforcement (token deleted after validation)
- [ ] Implements OnModuleDestroy for cleanup
- [ ] Pattern matches TicketService structure

**Estimated**: 1 hour

---

### Task 2.2: Modify existing AuthModule to add magic link endpoints ⏸️ PENDING

**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\app\auth\auth.module.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\app\auth\auth.controller.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\app\auth\services\auth.service.ts`

**Dependencies**: Task 2.1 (needs MagicLinkService)
**Spec Reference**: implementation-plan.md:340-421
**Pattern**: Existing auth module with WorkOS (we're removing WorkOS, adding magic link)

**Quality Requirements**:

- MUST remove WorkOS imports and dependencies
- MUST add MagicLinkService to providers
- POST /api/v1/auth/magic-link MUST send email with magic link
- GET /api/v1/auth/verify MUST validate token, set JWT cookie, redirect to portal
- JWT cookie MUST be HTTP-only, secure in production, 7-day expiration

**Validation Notes**:

- Keep JwtAuthGuard - it's reused for portal endpoints
- Remove WorkOS-specific code from AuthService
- Magic link URL format: `${FRONTEND_URL}/auth/verify?token=<token>`

**Implementation Details**:

AuthController additions:

```typescript
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly magicLinkService: MagicLinkService) {}

  @Post('magic-link')
  async requestMagicLink(@Body() body: { email: string }) {
    await this.authService.sendMagicLink(body.email);
    return {
      success: true,
      message: 'Check your email for login link',
    };
  }

  @Get('verify')
  async verifyMagicLink(@Query('token') token: string, @Res() response: Response) {
    const email = await this.magicLinkService.validateAndConsume(token);

    if (!email) {
      return response.redirect(`${process.env.FRONTEND_URL}/auth/login?error=invalid_token`);
    }

    const jwt = await this.authService.generateJwtForEmail(email);

    response.cookie('access_token', jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return response.redirect(`${process.env.FRONTEND_URL}/portal/dashboard`);
  }
}
```

AuthService modifications:

```typescript
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly magicLinkService: MagicLinkService, private readonly emailService: EmailService, private readonly jwtService: JwtService) {}

  async sendMagicLink(email: string): Promise<void> {
    // Verify user exists in database
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('No subscription found for this email');
    }

    const token = await this.magicLinkService.create(email);
    const magicLink = `${process.env.FRONTEND_URL}/auth/verify?token=${token}`;

    await this.emailService.sendMagicLinkEmail(email, magicLink);
  }

  async generateJwtForEmail(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    const payload = {
      sub: user.id,
      email: user.email,
    };

    return this.jwtService.sign(payload);
  }
}
```

**Acceptance Criteria**:

- [ ] WorkOS imports removed from all auth files
- [ ] MagicLinkService added to AuthModule providers
- [ ] POST /api/v1/auth/magic-link endpoint exists
- [ ] GET /api/v1/auth/verify endpoint exists
- [ ] JWT cookie set correctly (HTTP-only, 7-day expiration)
- [ ] Redirect to portal dashboard after successful verification
- [ ] Redirect to login page with error for invalid token

**Estimated**: 2 hours

---

### Task 2.3: Create magic-link.hbs email template ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-license-server\src\email\templates\magic-link.hbs (CREATE)
**Dependencies**: Task 2.2 (EmailService needs this template)
**Spec Reference**: implementation-plan.md:252-256

**Quality Requirements**:

- Template MUST render magic link URL correctly
- Email subject MUST be "Login to Ptah Portal"
- Link MUST expire in 30 seconds (mentioned in email copy)
- Template MUST be mobile-friendly (responsive design)

**Validation Notes**:

- Similar structure to license-key.hbs template
- Clear call-to-action button for magic link
- Warn user about 30-second expiration

**Implementation Details**:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Login to Ptah Portal</title>
  </head>
  <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1>Login to Your Ptah Portal</h1>
    <p>Click the button below to access your subscription dashboard:</p>

    <div style="margin: 30px 0; text-align: center;">
      <a href="{{magicLink}}" style="background: #0066ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;"> Access Portal </a>
    </div>

    <p style="color: #d32f2f; font-weight: bold;">⚠️ This link expires in 30 seconds and can only be used once.</p>

    <p style="color: #666; font-size: 14px;">If you didn't request this login link, you can safely ignore this email.</p>

    <hr style="margin: 40px 0; border: none; border-top: 1px solid #ddd;" />

    <p style="color: #999; font-size: 12px;">This email was sent to {{email}}. If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="color: #999; font-size: 12px; word-break: break-all;">{{magicLink}}</p>
  </body>
</html>
```

EmailService addition:

```typescript
async sendMagicLinkEmail(email: string, magicLink: string): Promise<void> {
  const templatePath = path.join(__dirname, 'templates', 'magic-link.hbs');
  const templateSource = await fs.readFile(templatePath, 'utf-8');
  const template = handlebars.compile(templateSource);
  const html = template({ magicLink, email });

  await sgMail.send({
    to: email,
    from: 'noreply@ptah.dev',
    subject: 'Login to Ptah Portal',
    html
  });
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-license-server\src\email\templates\magic-link.hbs`
- [ ] Template includes magic link button
- [ ] Template warns about 30-second expiration
- [ ] Template includes fallback link (copy-paste)
- [ ] EmailService.sendMagicLinkEmail method added

**Estimated**: 1 hour

---

### Task 2.4: Test magic link authentication flow end-to-end ⏸️ PENDING

**Files**: None (testing task)
**Dependencies**: Tasks 2.1, 2.2, 2.3 complete
**Spec Reference**: implementation-plan.md:1049-1063 (Flow 2: Portal Access)

**Quality Requirements**:

- MUST verify token expires after 30 seconds
- MUST verify token is single-use (second use fails)
- MUST verify JWT cookie is set after successful verification
- MUST verify redirect to portal dashboard works
- MUST verify invalid token redirects to login with error

**Validation Notes**:

- This is critical security testing - don't skip
- Test both happy path and all failure modes

**Test Cases**:

1. **Happy Path**:

   - User requests magic link with valid email → email received
   - User clicks link within 30 seconds → JWT cookie set, redirect to dashboard
   - User can access protected portal endpoints with cookie

2. **Token Expiration**:

   - User requests magic link
   - Wait 31 seconds
   - Click link → redirect to login with error

3. **Single-Use Enforcement**:

   - User requests magic link
   - Click link → success
   - Click same link again → redirect to login with error

4. **Invalid Email**:

   - User requests magic link with email not in database → 404 error

5. **Malformed Token**:
   - User visits /auth/verify?token=invalid → redirect to login with error

**Acceptance Criteria**:

- [ ] All 5 test cases pass
- [ ] Token expiration at 30 seconds verified
- [ ] Single-use enforcement verified
- [ ] JWT cookie creation verified
- [ ] Redirect logic verified
- [ ] No errors in server logs for valid flows

**Estimated**: 1 hour

---

**Batch 2 Verification**:

- MagicLinkService implemented and matches TicketService pattern
- AuthModule modified to remove WorkOS and add magic link
- Magic link email template created and renders correctly
- End-to-end flow tested (all 5 test cases pass)
- Build passes: `npx nx build ptah-license-server`

---

## Batch 3: Customer Portal API (Day 3) ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 2 complete

### Task 3.1: Create SubscriptionsModule with GET /api/v1/subscriptions/me ⏸️ PENDING

**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\subscriptions.module.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\subscriptions.controller.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\subscriptions.service.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\dto\subscription-response.dto.ts`

**Dependencies**: Batch 2 (needs JwtAuthGuard working)
**Spec Reference**: implementation-plan.md:424-482
**Pattern**: NestJS controller + service with JWT auth guard

**Quality Requirements**:

- MUST protect endpoint with JwtAuthGuard (user must be authenticated)
- MUST extract userId from JWT payload (request.user.id)
- MUST return subscription status, plan details, and renewal date
- MUST handle user with no active subscription gracefully

**Validation Notes**:

- JwtAuthGuard extracts user from JWT cookie and populates request.user
- Return 404 if user has no subscription (or return empty subscription)

**Implementation Details**:

SubscriptionsController:

```typescript
import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';

@Controller('api/v1/subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('me')
  async getCurrentSubscription(@Req() request: Request) {
    const userId = request.user.id;
    return this.subscriptionsService.getSubscriptionByUserId(userId);
  }
}
```

SubscriptionsService:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscriptionByUserId(userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'active',
      },
      include: { user: true },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    return {
      id: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      plan: {
        name: 'Premium',
        amount: 800, // EGP cents ($8 equivalent)
      },
    };
  }
}
```

**Acceptance Criteria**:

- [ ] All 4 files created at correct paths
- [ ] GET /api/v1/subscriptions/me requires JWT authentication
- [ ] Returns subscription details for authenticated user
- [ ] Returns 401 if no JWT cookie present
- [ ] Returns 404 if user has no active subscription
- [ ] Response matches schema in implementation-plan.md:432-442

**Estimated**: 1.5 hours

---

### Task 3.2: Implement POST /api/v1/subscriptions/cancel (Paymob integration) ⏸️ PENDING

**File**: MODIFY `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\subscriptions.service.ts`
**Dependencies**: Task 3.1 (needs SubscriptionsService)
**Spec Reference**: implementation-plan.md:444-481
**Pattern**: HTTP client to call Paymob API

**Quality Requirements**:

- MUST call Paymob API to cancel subscription
- MUST update local subscription status to 'canceled'
- MUST revoke associated license (set status to 'revoked')
- MUST handle Paymob API errors gracefully
- MUST protect endpoint with JwtAuthGuard

**Validation Notes**:

- Paymob API endpoint for cancellation: research-report.md mentions it but exact endpoint TBD
- Fallback: Just update local DB if Paymob API unavailable (manual cancellation in Paymob dashboard)
- License revocation must happen atomically with subscription cancellation

**Implementation Details**:

SubscriptionsController addition:

```typescript
@Post('cancel')
async cancelSubscription(@Req() request: Request) {
  const userId = request.user.id;
  return this.subscriptionsService.cancelSubscription(userId);
}
```

SubscriptionsService addition:

```typescript
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

async cancelSubscription(userId: string) {
  const subscription = await this.prisma.subscription.findFirst({
    where: { userId, status: 'active' }
  });

  if (!subscription) {
    throw new NotFoundException('No active subscription to cancel');
  }

  // Call Paymob API to cancel subscription
  // Note: Exact endpoint TBD - may need to contact Paymob support
  try {
    if (subscription.paymobSubscriptionId) {
      await this.callPaymobCancelAPI(subscription.paymobSubscriptionId);
    }
  } catch (error) {
    this.logger.error(`Paymob cancel API failed: ${error.message}`);
    // Continue with local cancellation even if Paymob fails
  }

  // Update local subscription and revoke license
  await this.prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: 'canceled' }
    });

    await tx.license.updateMany({
      where: { userId },
      data: { status: 'revoked' }
    });
  });

  return {
    success: true,
    message: 'Subscription cancelled successfully'
  };
}

private async callPaymobCancelAPI(subscriptionId: string): Promise<void> {
  // TODO: Get exact Paymob cancel endpoint from support
  // Placeholder implementation
  const apiKey = this.configService.get<string>('PAYMOB_API_KEY');

  await firstValueFrom(
    this.httpService.post(
      `https://accept.paymob.com/api/acceptance/subscriptions/${subscriptionId}/cancel`,
      {},
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    )
  );
}
```

**Acceptance Criteria**:

- [ ] POST /api/v1/subscriptions/cancel endpoint exists
- [ ] Requires JWT authentication
- [ ] Updates subscription status to 'canceled' in database
- [ ] Revokes associated license (status = 'revoked')
- [ ] Handles Paymob API errors gracefully
- [ ] Returns success response even if Paymob API fails (local cancellation works)

**Estimated**: 2 hours

---

### Task 3.3: Implement GET /api/v1/payments/history endpoint ⏸️ PENDING

**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\dto\payment-history-response.dto.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\subscriptions.controller.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\subscriptions\subscriptions.service.ts`

**Dependencies**: Task 3.2 (same controller/service)
**Spec Reference**: implementation-plan.md:483-500

**Quality Requirements**:

- MUST return array of payment transactions
- MUST include date, amount, status, and invoice URL
- MUST be sorted by date (most recent first)
- MUST protect endpoint with JwtAuthGuard

**Validation Notes**:

- Payment history is NOT in our database (Paymob stores it)
- Options: 1) Call Paymob API for history, 2) Return empty array for MVP
- Recommendation: Return empty array with TODO for Paymob integration

**Implementation Details**:

SubscriptionsController addition:

```typescript
@Get('payments/history')
async getPaymentHistory(@Req() request: Request) {
  const userId = request.user.id;
  return this.subscriptionsService.getPaymentHistory(userId);
}
```

SubscriptionsService addition:

```typescript
async getPaymentHistory(userId: string): Promise<PaymentHistoryResponse[]> {
  // TODO: Integrate with Paymob Transactions API
  // For MVP, return empty array
  this.logger.warn('Payment history not yet implemented - Paymob integration pending');
  return [];

  // Future implementation:
  // const subscription = await this.prisma.subscription.findFirst({
  //   where: { userId }
  // });
  //
  // if (!subscription?.paymobSubscriptionId) {
  //   return [];
  // }
  //
  // const payments = await this.callPaymobTransactionsAPI(subscription.paymobSubscriptionId);
  // return payments.map(p => ({
  //   date: p.created_at,
  //   amount: p.amount_cents,
  //   status: p.success ? 'paid' : 'failed',
  //   invoiceUrl: p.invoice_url
  // }));
}
```

PaymentHistoryResponse DTO:

```typescript
export class PaymentHistoryResponse {
  date: string;
  amount: number;
  status: 'paid' | 'failed';
  invoiceUrl?: string;
}
```

**Acceptance Criteria**:

- [ ] GET /api/v1/payments/history endpoint exists
- [ ] Requires JWT authentication
- [ ] Returns array of PaymentHistoryResponse (empty array for MVP)
- [ ] DTO created with correct schema
- [ ] TODO comment added for future Paymob integration

**Estimated**: 1 hour

---

### Task 3.4: Implement POST /api/v1/licenses/resend endpoint ⏸️ PENDING

**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\licenses\licenses.controller.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-license-server\src\licenses\licenses.service.ts`

**Dependencies**: Batch 1 (LicensesService), Batch 2 (JwtAuthGuard)
**Spec Reference**: implementation-plan.md:327-335

**Quality Requirements**:

- MUST protect endpoint with JwtAuthGuard
- MUST find user's active license
- MUST send license key email (reuse EmailService)
- MUST NOT display license key in API response (security)
- MUST return success message only

**Validation Notes**:

- License key NEVER returned in API response (portal never shows it)
- Email-only delivery enforced for security

**Implementation Details**:

LicensesController addition:

```typescript
@Post('resend')
@UseGuards(JwtAuthGuard)
@HttpCode(HttpStatus.OK)
async resendLicenseKey(@Req() request: Request) {
  const userId = request.user.id;
  return this.licensesService.resendLicenseKey(userId);
}
```

LicensesService addition:

```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly emailService: EmailService,
) {}

async resendLicenseKey(userId: string) {
  const license = await this.prisma.license.findFirst({
    where: {
      userId,
      status: 'active'
    },
    include: { user: true }
  });

  if (!license) {
    throw new NotFoundException('No active license found');
  }

  await this.emailService.sendLicenseKey(license.user.email, license.licenseKey);

  return {
    success: true,
    message: 'License key email sent'
  };
}
```

**Acceptance Criteria**:

- [ ] POST /api/v1/licenses/resend endpoint exists
- [ ] Requires JWT authentication
- [ ] Sends license key email to user
- [ ] Returns success message (NOT the license key)
- [ ] Returns 404 if user has no active license

**Estimated**: 1 hour

---

**Batch 3 Verification**:

- SubscriptionsModule created with all endpoints
- GET /api/v1/subscriptions/me returns subscription details
- POST /api/v1/subscriptions/cancel works (local cancellation)
- GET /api/v1/payments/history returns empty array (MVP)
- POST /api/v1/licenses/resend sends email
- All endpoints protected with JwtAuthGuard
- Build passes: `npx nx build ptah-license-server`

---

## Batch 4: Landing Page Portal UI (Day 4) ⏸️ PENDING

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 3 complete

### Task 4.1: Create auth-login.component.ts (magic link form) ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\auth-login.component.ts (CREATE)
**Dependencies**: Batch 3 (needs POST /api/v1/auth/magic-link endpoint)
**Spec Reference**: implementation-plan.md:689-757
**Pattern**: Angular standalone component with FormsModule

**Quality Requirements**:

- MUST be standalone component (no NgModule)
- MUST use Angular FormsModule for form handling
- MUST validate email format before submission
- MUST show loading state during API call
- MUST show success/error messages
- MUST be mobile-responsive

**Validation Notes**:

- Landing page app is Angular 20+ with standalone components
- Use signal-based state if available in landing page

**Implementation Details**:

```typescript
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LicenseApiService } from '../services/license-api.service';

@Component({
  selector: 'app-auth-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container max-w-md mx-auto mt-20 p-8 bg-white rounded-lg shadow-lg">
      <h1 class="text-3xl font-bold mb-6 text-center">Login to Ptah Portal</h1>

      <form (ngSubmit)="requestMagicLink()" #loginForm="ngForm">
        <div class="mb-6">
          <label class="block text-gray-700 mb-2 font-medium">Email Address</label>
          <input type="email" name="email" [(ngModel)]="email" required email class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="your@email.com" />
          <p class="mt-2 text-sm text-gray-500">We'll send you a secure login link that expires in 30 seconds.</p>
        </div>

        <button type="submit" [disabled]="!loginForm.form.valid || loading()" class="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {{ loading() ? 'Sending...' : 'Send Magic Link' }}
        </button>
      </form>

      <div *ngIf="message()" class="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
        <p class="text-green-800">{{ message() }}</p>
      </div>

      <div *ngIf="error()" class="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
        <p class="text-red-800">{{ error() }}</p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }
    `,
  ],
})
export class AuthLoginComponent {
  email = '';
  loading = signal(false);
  message = signal('');
  error = signal('');

  constructor(private readonly licenseApi: LicenseApiService) {}

  async requestMagicLink() {
    this.loading.set(true);
    this.message.set('');
    this.error.set('');

    try {
      await this.licenseApi.requestMagicLink(this.email);
      this.message.set('Check your email! We sent you a login link (valid for 30 seconds).');
    } catch (err: any) {
      this.error.set(err.error?.message || 'Failed to send magic link. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\auth-login.component.ts`
- [ ] Standalone component with FormsModule
- [ ] Email validation working
- [ ] Loading state displays during API call
- [ ] Success/error messages display correctly
- [ ] Mobile-responsive design

**Estimated**: 1.5 hours

---

### Task 4.2: Create portal/dashboard.component.ts (subscription overview) ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\portal\dashboard.component.ts (CREATE)
**Dependencies**: Task 4.1, Batch 3 (needs GET /api/v1/subscriptions/me)
**Spec Reference**: implementation-plan.md:759-823
**Pattern**: Angular standalone component with signals

**Quality Requirements**:

- MUST fetch subscription data on component init
- MUST display subscription status, renewal date, and plan
- MUST include "Resend License Key Email" button (NEVER display key)
- MUST be protected by route guard (JWT auth)
- MUST handle loading and error states

**Validation Notes**:

- License key is NEVER displayed in portal - only resend button
- Use Angular's OnInit lifecycle hook
- Handle 401 errors (redirect to login if not authenticated)

**Implementation Details**:

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LicenseApiService } from '../../services/license-api.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-portal-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container mx-auto max-w-4xl mt-10 p-8">
      <h1 class="text-4xl font-bold mb-8">Subscription Dashboard</h1>

      <div *ngIf="loading()" class="text-center py-12">
        <p class="text-gray-600">Loading subscription details...</p>
      </div>

      <div *ngIf="error()" class="bg-red-50 border border-red-200 rounded-lg p-6">
        <p class="text-red-800">{{ error() }}</p>
      </div>

      <div *ngIf="subscription() && !loading()" class="bg-white rounded-lg shadow-lg p-8">
        <div class="grid md:grid-cols-3 gap-6 mb-8">
          <div class="border-l-4 border-green-500 pl-4">
            <p class="text-gray-600 text-sm font-medium">Status</p>
            <p class="text-2xl font-bold text-green-600">{{ subscription().status | titlecase }}</p>
          </div>

          <div class="border-l-4 border-blue-500 pl-4">
            <p class="text-gray-600 text-sm font-medium">Plan</p>
            <p class="text-2xl font-bold text-blue-600">{{ subscription().plan.name }}</p>
          </div>

          <div class="border-l-4 border-purple-500 pl-4">
            <p class="text-gray-600 text-sm font-medium">Renewal Date</p>
            <p class="text-2xl font-bold text-purple-600">
              {{ subscription().currentPeriodEnd | date : 'mediumDate' }}
            </p>
          </div>
        </div>

        <div class="border-t pt-6">
          <h2 class="text-xl font-semibold mb-4">License Key</h2>
          <p class="text-gray-600 mb-4">Your license key was sent to your email. If you need it again, click the button below.</p>

          <button (click)="resendLicenseKey()" [disabled]="resendLoading()" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {{ resendLoading() ? 'Sending...' : 'Resend License Key Email' }}
          </button>

          <p *ngIf="resendMessage()" class="mt-4 text-green-600 font-medium">
            {{ resendMessage() }}
          </p>
        </div>
      </div>
    </div>
  `,
})
export class PortalDashboardComponent implements OnInit {
  subscription = signal<any>(null);
  loading = signal(true);
  error = signal('');
  resendLoading = signal(false);
  resendMessage = signal('');

  constructor(private readonly licenseApi: LicenseApiService, private readonly router: Router) {}

  async ngOnInit() {
    try {
      const sub = await this.licenseApi.getSubscription();
      this.subscription.set(sub);
    } catch (err: any) {
      if (err.status === 401) {
        this.router.navigate(['/auth/login']);
      } else {
        this.error.set('Failed to load subscription details');
      }
    } finally {
      this.loading.set(false);
    }
  }

  async resendLicenseKey() {
    this.resendLoading.set(true);
    this.resendMessage.set('');

    try {
      await this.licenseApi.resendLicenseKey();
      this.resendMessage.set('License key email sent! Check your inbox.');
    } catch (err) {
      this.resendMessage.set('Failed to send email. Please try again.');
    } finally {
      this.resendLoading.set(false);
    }
  }
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\portal\dashboard.component.ts`
- [ ] Displays subscription status, plan, and renewal date
- [ ] "Resend License Key Email" button works
- [ ] License key is NEVER displayed
- [ ] Handles loading and error states
- [ ] Redirects to login if 401 error

**Estimated**: 2 hours

---

### Task 4.3: Create portal/subscription.component.ts (cancel subscription UI) ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\portal\subscription.component.ts (CREATE)
**Dependencies**: Task 4.2, Batch 3 (needs POST /api/v1/subscriptions/cancel)
**Spec Reference**: implementation-plan.md:1080-1094 (Flow 4: Subscription Cancellation)

**Quality Requirements**:

- MUST show confirmation dialog before cancellation
- MUST call POST /api/v1/subscriptions/cancel API
- MUST update UI after successful cancellation
- MUST display warning about feature loss
- MUST be protected by route guard

**Validation Notes**:

- Cancellation is irreversible - require explicit confirmation
- After cancellation, subscription status changes to 'canceled'
- License is revoked immediately

**Implementation Details**:

```typescript
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LicenseApiService } from '../../services/license-api.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-portal-subscription',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container mx-auto max-w-2xl mt-10 p-8">
      <h1 class="text-3xl font-bold mb-6">Manage Subscription</h1>

      <div class="bg-white rounded-lg shadow-lg p-8">
        <h2 class="text-xl font-semibold mb-4 text-red-600">Cancel Subscription</h2>

        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p class="text-yellow-800 font-medium mb-2">⚠️ Warning</p>
          <ul class="text-yellow-700 text-sm space-y-1 list-disc list-inside">
            <li>Your premium features will stop working immediately</li>
            <li>Your license key will be revoked</li>
            <li>You will lose access to all premium tools</li>
            <li>This action cannot be undone</li>
          </ul>
        </div>

        <div *ngIf="!showConfirm()">
          <button (click)="showConfirm.set(true)" class="bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors">Cancel My Subscription</button>
        </div>

        <div *ngIf="showConfirm()" class="space-y-4">
          <p class="font-medium text-gray-800">Are you absolutely sure you want to cancel your subscription?</p>

          <div class="flex gap-4">
            <button (click)="cancelSubscription()" [disabled]="loading()" class="bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
              {{ loading() ? 'Cancelling...' : 'Yes, Cancel Subscription' }}
            </button>

            <button (click)="showConfirm.set(false)" [disabled]="loading()" class="bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 disabled:opacity-50 transition-colors">No, Keep Subscription</button>
          </div>
        </div>

        <p *ngIf="error()" class="mt-4 text-red-600">{{ error() }}</p>
        <p *ngIf="success()" class="mt-4 text-green-600">{{ success() }}</p>
      </div>
    </div>
  `,
})
export class PortalSubscriptionComponent {
  showConfirm = signal(false);
  loading = signal(false);
  error = signal('');
  success = signal('');

  constructor(private readonly licenseApi: LicenseApiService, private readonly router: Router) {}

  async cancelSubscription() {
    this.loading.set(true);
    this.error.set('');
    this.success.set('');

    try {
      await this.licenseApi.cancelSubscription();
      this.success.set('Subscription cancelled successfully. Redirecting to dashboard...');

      setTimeout(() => {
        this.router.navigate(['/portal/dashboard']);
      }, 3000);
    } catch (err: any) {
      this.error.set(err.error?.message || 'Failed to cancel subscription. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\portal\subscription.component.ts`
- [ ] Shows confirmation dialog before cancellation
- [ ] Displays warning about feature loss
- [ ] Calls POST /api/v1/subscriptions/cancel API
- [ ] Redirects to dashboard after successful cancellation
- [ ] Handles errors gracefully

**Estimated**: 1.5 hours

---

### Task 4.4: Create portal/payments.component.ts (payment history table) ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\portal\payments.component.ts (CREATE)
**Dependencies**: Task 4.2, Batch 3 (needs GET /api/v1/payments/history)
**Spec Reference**: implementation-plan.md:483-500

**Quality Requirements**:

- MUST display payment history table (even if empty for MVP)
- MUST show date, amount, status for each payment
- MUST handle empty state gracefully
- MUST be protected by route guard

**Validation Notes**:

- GET /api/v1/payments/history returns empty array for MVP
- Show "No payments yet" message for empty state
- Future: Will display actual Paymob transaction history

**Implementation Details**:

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LicenseApiService } from '../../services/license-api.service';

@Component({
  selector: 'app-portal-payments',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container mx-auto max-w-4xl mt-10 p-8">
      <h1 class="text-3xl font-bold mb-6">Payment History</h1>

      <div *ngIf="loading()" class="text-center py-12">
        <p class="text-gray-600">Loading payment history...</p>
      </div>

      <div *ngIf="!loading() && payments().length === 0" class="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p class="text-gray-600">No payment history available yet.</p>
        <p class="text-sm text-gray-500 mt-2">Your payment transactions will appear here.</p>
      </div>

      <div *ngIf="!loading() && payments().length > 0" class="bg-white rounded-lg shadow-lg overflow-hidden">
        <table class="w-full">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <tr *ngFor="let payment of payments()">
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ payment.date | date : 'mediumDate' }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">EGP {{ payment.amount / 100 | number : '1.2-2' }}</td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span [class]="payment.status === 'paid' ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'" class="px-2 py-1 text-xs font-semibold rounded-full">
                  {{ payment.status | uppercase }}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <a *ngIf="payment.invoiceUrl" [href]="payment.invoiceUrl" target="_blank" class="text-blue-600 hover:text-blue-800"> View Invoice </a>
                <span *ngIf="!payment.invoiceUrl" class="text-gray-400">N/A</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class PortalPaymentsComponent implements OnInit {
  payments = signal<any[]>([]);
  loading = signal(true);

  constructor(private readonly licenseApi: LicenseApiService) {}

  async ngOnInit() {
    try {
      const history = await this.licenseApi.getPaymentHistory();
      this.payments.set(history);
    } catch (err) {
      console.error('Failed to load payment history', err);
    } finally {
      this.loading.set(false);
    }
  }
}
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\portal\payments.component.ts`
- [ ] Displays empty state message (since API returns empty array)
- [ ] Table structure ready for future payment data
- [ ] Shows date, amount, status, invoice link columns
- [ ] Handles loading state

**Estimated**: 1 hour

---

### Task 4.5: Create license-api.service.ts (HTTP client for API) ⏸️ PENDING

**File**: D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\license-api.service.ts (CREATE)
**Dependencies**: Batch 3 (all backend endpoints must exist)
**Spec Reference**: implementation-plan.md:828-869
**Pattern**: Angular service with HttpClient

**Quality Requirements**:

- MUST use `withCredentials: true` for all requests (JWT cookie)
- MUST handle errors and convert to user-friendly messages
- MUST use correct API base URL from environment
- MUST be injectable service (providedIn: 'root')

**Validation Notes**:

- `withCredentials: true` is CRITICAL - sends JWT cookie with requests
- API base URL should come from environment config
- Convert Observable to Promise using lastValueFrom for cleaner async/await

**Implementation Details**:

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class LicenseApiService {
  private readonly baseUrl = environment.apiUrl || 'https://api.ptah.dev/api/v1';

  constructor(private readonly http: HttpClient) {}

  async requestMagicLink(email: string): Promise<void> {
    await lastValueFrom(this.http.post(`${this.baseUrl}/auth/magic-link`, { email }));
  }

  async getSubscription(): Promise<any> {
    return lastValueFrom(
      this.http.get(`${this.baseUrl}/subscriptions/me`, {
        withCredentials: true,
      })
    );
  }

  async cancelSubscription(): Promise<void> {
    await lastValueFrom(
      this.http.post(
        `${this.baseUrl}/subscriptions/cancel`,
        {},
        {
          withCredentials: true,
        }
      )
    );
  }

  async getPaymentHistory(): Promise<any[]> {
    return lastValueFrom(
      this.http.get<any[]>(`${this.baseUrl}/payments/history`, {
        withCredentials: true,
      })
    );
  }

  async resendLicenseKey(): Promise<void> {
    await lastValueFrom(
      this.http.post(
        `${this.baseUrl}/licenses/resend`,
        {},
        {
          withCredentials: true,
        }
      )
    );
  }
}
```

Environment config (if not exists):

```typescript
// apps/ptah-landing-page/src/environments/environment.ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1',
};

// apps/ptah-landing-page/src/environments/environment.prod.ts
export const environment = {
  production: true,
  apiUrl: 'https://api.ptah.dev/api/v1',
};
```

**Acceptance Criteria**:

- [ ] File created at: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\license-api.service.ts`
- [ ] All 5 API methods implemented
- [ ] Uses `withCredentials: true` for authenticated endpoints
- [ ] Uses lastValueFrom to convert Observable to Promise
- [ ] API base URL from environment config
- [ ] Service is injectable with providedIn: 'root'

**Estimated**: 1 hour

---

**Batch 4 Verification**:

- All 4 portal components created
- LicenseApiService created with all methods
- Auth login page renders and sends magic link
- Portal dashboard displays subscription details
- Cancel subscription page shows confirmation dialog
- Payment history page shows empty state
- All components use `withCredentials: true` for API calls
- Build passes: `npx nx build ptah-landing-page`

---

## Batch 5: Integration & Testing (Day 5) ⏸️ PENDING

**Developer**: senior-tester
**Tasks**: 4 | **Dependencies**: Batch 4 complete

### Task 5.1: E2E test - Subscribe → Webhook → Email → Portal login ⏸️ PENDING

**Files**: None (testing task)
**Dependencies**: All batches complete
**Spec Reference**: implementation-plan.md:1020-1047 (Flow 1: First-Time Subscription)

**Quality Requirements**:

- Test complete user journey from payment to portal access
- Verify webhook processing creates user, subscription, and license
- Verify email sent with license key and magic link
- Verify magic link login works
- Verify portal dashboard displays correct data

**Test Steps**:

1. **Simulate Paymob Webhook**:

   - Use curl or Postman to send POST /api/v1/webhooks/paymob
   - Include valid HMAC in query parameter
   - Payload: TRANSACTION event with success=true, user email

2. **Verify Database Records**:

   - Check User created with email
   - Check Subscription created with status='active'
   - Check License created with ptah*lic* format

3. **Verify Email Sent**:

   - Check SendGrid logs or test email inbox
   - Verify email contains license key
   - Verify email contains magic link

4. **Test Magic Link Login**:

   - Click magic link from email
   - Verify redirected to /portal/dashboard
   - Verify JWT cookie set

5. **Test Portal Dashboard**:
   - Verify subscription details displayed
   - Verify "Resend License Key" button works
   - Click button, verify email received

**Acceptance Criteria**:

- [ ] Webhook processing creates all database records
- [ ] License key format is ptah*lic*{32-hex}
- [ ] Email sent with license key and magic link
- [ ] Magic link login sets JWT cookie
- [ ] Portal dashboard displays subscription correctly
- [ ] Resend license key button works

**Estimated**: 2 hours

---

### Task 5.2: Test Paymob sandbox integration ⏸️ PENDING

**Files**: None (testing task)
**Dependencies**: Task 5.1
**Spec Reference**: implementation-plan.md:879-982 (Paymob API Flow)

**Quality Requirements**:

- Test with Paymob sandbox environment
- Verify HMAC signature validation
- Test all webhook event types (TRANSACTION, CANCELED, RENEWED)
- Verify idempotency (duplicate webhooks handled)

**Test Cases**:

1. **Valid Webhook - TRANSACTION**:

   - Send webhook with correct HMAC
   - Verify 200 { received: true } response
   - Verify database records created

2. **Invalid HMAC**:

   - Send webhook with incorrect HMAC
   - Verify 401 Unauthorized response
   - Verify no database changes

3. **Duplicate Webhook**:

   - Send same webhook twice
   - Verify both return 200
   - Verify only one set of records created

4. **SUBSCRIPTION_CANCELED Event**:

   - Send SUBSCRIPTION_CANCELED webhook
   - Verify subscription status updated to 'canceled'
   - Verify license status updated to 'revoked'

5. **SUBSCRIPTION_RENEWED Event**:
   - Send SUBSCRIPTION_RENEWED webhook
   - Verify currentPeriodEnd updated

**Acceptance Criteria**:

- [ ] HMAC validation working (query parameter)
- [ ] Valid webhooks processed correctly
- [ ] Invalid HMAC rejected with 401
- [ ] Duplicate webhooks handled idempotently
- [ ] All event types handled correctly

**Estimated**: 2 hours

---

### Task 5.3: Test magic link authentication (30s TTL, single-use) ⏸️ PENDING

**Files**: None (testing task)
**Dependencies**: Batch 2 (magic link implementation)
**Spec Reference**: implementation-plan.md:624-683

**Quality Requirements**:

- Verify token expires after exactly 30 seconds
- Verify token is single-use (cannot be reused)
- Verify JWT cookie set on successful verification
- Verify redirect to portal dashboard

**Test Cases**:

1. **Happy Path**:

   - Request magic link
   - Click link within 30 seconds
   - Verify JWT cookie set
   - Verify redirect to /portal/dashboard

2. **Token Expiration**:

   - Request magic link
   - Wait 31 seconds
   - Click link
   - Verify redirect to /auth/login with error

3. **Single-Use Enforcement**:

   - Request magic link
   - Click link (success)
   - Click same link again
   - Verify redirect to /auth/login with error

4. **Invalid Token**:
   - Visit /auth/verify?token=invalid
   - Verify redirect to /auth/login with error

**Acceptance Criteria**:

- [ ] Token expires after 30 seconds
- [ ] Token is single-use (cannot be reused)
- [ ] JWT cookie set on successful verification
- [ ] All redirect logic works correctly
- [ ] Error messages displayed for failures

**Estimated**: 1 hour

---

### Task 5.4: Test license key verification (VS Code extension flow) ⏸️ PENDING

**Files**: None (testing task)
**Dependencies**: Batch 1 (license verification endpoint)
**Spec Reference**: implementation-plan.md:281-309

**Quality Requirements**:

- Verify endpoint responds <200ms (p95 latency)
- Test valid license keys return premium tier
- Test invalid/expired/revoked keys return free tier
- Test malformed license keys return 400 error

**Test Cases**:

1. **Valid Active License**:

   - POST /api/v1/licenses/verify with valid key
   - Verify response: `{ valid: true, tier: "premium", email, expiresAt }`
   - Verify response time <200ms

2. **Invalid License Key**:

   - POST /api/v1/licenses/verify with non-existent key
   - Verify response: `{ valid: false, tier: "free" }`

3. **Revoked License**:

   - Revoke license in database (status = 'revoked')
   - POST /api/v1/licenses/verify
   - Verify response: `{ valid: false, tier: "free" }`

4. **Canceled Subscription**:

   - Update subscription status to 'canceled'
   - POST /api/v1/licenses/verify
   - Verify response: `{ valid: false, tier: "free" }`

5. **Malformed License Key**:
   - POST /api/v1/licenses/verify with malformed key
   - Verify 400 Bad Request response

**Performance Test**:

- Send 100 requests to /api/v1/licenses/verify
- Measure p95 latency
- Verify <200ms requirement

**Acceptance Criteria**:

- [ ] Valid licenses return premium tier
- [ ] Invalid licenses return free tier
- [ ] Revoked licenses return free tier
- [ ] Canceled subscriptions return free tier
- [ ] Malformed keys return 400 error
- [ ] p95 latency <200ms

**Estimated**: 1.5 hours

---

**Batch 5 Verification**:

- E2E flow tested (webhook → email → portal login)
- Paymob sandbox integration verified
- Magic link authentication tested (30s TTL, single-use)
- License verification tested (all scenarios)
- Performance requirements verified (<200ms)
- All test cases documented and passing

---

## Summary

**Total Batches**: 5
**Total Tasks**: 20
**Estimated Time**: 4-5 days (32-40 hours)

**Critical Path**:

- Batch 1 (Backend Core) → Batch 2 (Magic Link Auth) → Batch 3 (Portal API) → Batch 4 (Portal UI) → Batch 5 (Testing)

**Key Files Created** (17 new files):

Backend (12 files):

1. `apps/ptah-license-server/prisma/schema.prisma`
2. `apps/ptah-license-server/src/database/prisma.service.ts`
3. `apps/ptah-license-server/src/licenses/licenses.module.ts`
4. `apps/ptah-license-server/src/licenses/licenses.controller.ts`
5. `apps/ptah-license-server/src/licenses/licenses.service.ts`
6. `apps/ptah-license-server/src/common/guards/paymob-hmac.guard.ts`
7. `apps/ptah-license-server/src/webhooks/webhooks.module.ts`
8. `apps/ptah-license-server/src/webhooks/webhooks.controller.ts`
9. `apps/ptah-license-server/src/webhooks/services/license-key-generator.service.ts`
10. `apps/ptah-license-server/src/auth/services/magic-link.service.ts`
11. `apps/ptah-license-server/src/subscriptions/subscriptions.module.ts`
12. `apps/ptah-license-server/src/email/templates/magic-link.hbs`

Frontend (5 files): 13. `apps/ptah-landing-page/src/app/pages/auth-login.component.ts` 14. `apps/ptah-landing-page/src/app/pages/portal/dashboard.component.ts` 15. `apps/ptah-landing-page/src/app/pages/portal/subscription.component.ts` 16. `apps/ptah-landing-page/src/app/pages/portal/payments.component.ts` 17. `apps/ptah-landing-page/src/app/services/license-api.service.ts`

**Key Files Modified** (4 files):

1. `apps/ptah-license-server/src/app/auth/auth.module.ts` (remove WorkOS, add magic link)
2. `apps/ptah-license-server/src/app/auth/auth.controller.ts` (add magic link endpoints)
3. `apps/ptah-license-server/src/app/auth/services/auth.service.ts` (remove WorkOS, add magic link logic)
4. `apps/ptah-license-server/src/licenses/licenses.service.ts` (add resend method)

**Critical Success Factors**:

1. Prisma driver adapters setup correctly (Batch 1, Task 1.1)
2. Paymob HMAC from query parameter (Batch 1, Task 1.5)
3. Magic link reuses TicketService pattern (Batch 2, Task 2.1)
4. License keys NEVER displayed in portal (Batch 4, all tasks)
5. All tests pass (Batch 5)
