# Implementation Plan - TASK_2025_043 (REVISED)

**Task**: Ptah License Server with Customer Portal Integration
**Software Architect**: Evidence-Based Architecture Agent
**Created**: 2025-12-07
**Target Completion**: 4-5 days (32-40 hours)
**Tech Stack**: Prisma 7.1.0 + NestJS + PostgreSQL + Paymob + Angular Landing Page

---

## 1. Updated Goal

Create a production-ready NestJS license server with integrated customer portal that:

1. **License Verification**: POST /api/v1/licenses/verify (unchanged from original)
2. **Paymob Webhooks**: POST /api/v1/webhooks/paymob (CORRECTED: query param HMAC)
3. **Customer Portal Integration**: Angular pages in existing landing page app
4. **Magic Link Authentication**: Email-based login (no passwords, reuses TicketService pattern)
5. **License Management**: Resend license key emails (NEVER display keys in portal)

**Timeline**: 4-5 days (increased from 2-3 days due to portal UI work)

**Critical Changes from Original Plan**:

- ✅ Prisma 7.1.0 with driver adapters (NO ZenStack - simplified for MVP)
- ✅ Paymob HMAC via query parameter (not header)
- ✅ Customer portal in ptah-landing-page app (not separate project)
- ✅ Magic link authentication (reuses existing TicketService crypto pattern)
- ✅ License keys NEVER displayed in portal (security requirement)

---

## 2. Tech Stack

### Backend (License Server)

**ORM**: Prisma 7.1.0 with Driver Adapters (NO Rust binary)

- Package: `prisma@7.1.0`, `@prisma/client@7.1.0`
- Driver: `@prisma/adapter-pg@7.1.0`, `pg@8.11.0`
- Reference: https://www.prisma.io/docs/orm/overview/databases/database-drivers#driver-adapters
- Reference: https://www.prisma.io/docs/guides/nestjs

**Why Driver Adapters?**

- No Rust binary compilation (faster CI/CD)
- Pure JavaScript PostgreSQL driver
- Better compatibility with serverless environments
- Same Prisma Client API

**Why NO ZenStack?**

- Simplified architecture for MVP
- Avoid learning curve complexity
- Still get full type safety with Prisma
- Can add ZenStack later if access policies needed

**Framework**: NestJS (existing in monorepo)

**Database**: PostgreSQL (existing in monorepo)

**Payment**: Paymob subscriptions (Egypt market)

**Email**: SendGrid (user's preferred choice from research)

**Authentication**: Magic link (30-second TTL tokens, reuse TicketService pattern)

### Frontend (Customer Portal)

**Framework**: Angular 20+ (existing ptah-landing-page app)

**Integration**: New portal pages added to existing app

- `/auth/login` - Magic link request form
- `/portal/dashboard` - Subscription overview
- `/portal/subscription` - Manage subscription
- `/portal/payments` - Payment history

**HTTP Client**: Angular HttpClient for API calls

**Security**: JWT in HTTP-only cookies (reuse existing JwtAuthGuard pattern)

### Nx Workspace Integration

**Nx Plugin**: `@nx-tools/nx-prisma@6.5.0`

**Project Structure**:

```
apps/
  ptah-license-server/          # NestJS backend (NEW)
  ptah-landing-page/            # Angular frontend (EXISTING - add portal pages)
```

---

## 3. Database Schema (Prisma)

**File**: `apps/ptah-license-server/prisma/schema.prisma`

```prisma
// Data source: PostgreSQL with driver adapters (NO Rust binary)
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Generator: Prisma Client with driver adapters preview feature
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

// Model: User (minimal - email only)
model User {
  id            String         @id @default(uuid())
  email         String         @unique
  createdAt     DateTime       @default(now())

  subscriptions Subscription[]
  licenses      License[]

  @@map("users")
}

// Model: Subscription (Paymob subscription tracking)
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

// Model: License (license key storage)
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

**Schema Notes**:

- **No Enums**: Using `String` instead of enums for simplicity (can validate in service layer)
- **Simple Relations**: One-to-many via foreign keys
- **Indexes**: Optimized for license key lookups (<10ms target)
- **Cascading Deletes**: User deletion removes subscriptions and licenses
- **Driver Adapters**: Enabled via `previewFeatures = ["driverAdapters"]`

**Prisma Service Implementation** (driver adapters pattern):

```typescript
// apps/ptah-license-server/src/database/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {
    // Create PostgreSQL connection pool
    const pool = new Pool({
      connectionString: configService.get<string>('DATABASE_URL'),
    });

    // Create Prisma adapter
    const adapter = new PrismaPg(pool);

    // Initialize Prisma Client with driver adapter
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

---

## 4. Project Structure

```
apps/ptah-license-server/
├── prisma/
│   ├── schema.prisma                  # Prisma schema
│   └── migrations/                    # Migration files
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── common/
│   │   ├── config/
│   │   │   └── configuration.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   └── guards/
│   │       └── paymob-hmac.guard.ts   # ✅ Query param validation
│   ├── database/
│   │   ├── database.module.ts
│   │   └── prisma.service.ts          # ✅ Driver adapters setup
│   ├── auth/                          # ✅ Reuse existing, remove WorkOS
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts         # ✅ Magic link endpoints
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts      # ✅ Keep as-is
│   │   └── services/
│   │       ├── auth.service.ts        # ✅ Remove WorkOS, add magic link
│   │       └── magic-link.service.ts  # ✅ NEW (reuse TicketService pattern)
│   ├── licenses/
│   │   ├── licenses.module.ts
│   │   ├── licenses.controller.ts     # ✅ verify + resend endpoints
│   │   ├── licenses.service.ts
│   │   └── dto/
│   │       ├── verify-license.dto.ts
│   │       └── verify-license-response.dto.ts
│   ├── subscriptions/                 # ✅ NEW (customer portal API)
│   │   ├── subscriptions.module.ts
│   │   ├── subscriptions.controller.ts
│   │   ├── subscriptions.service.ts
│   │   └── dto/
│   │       ├── subscription-response.dto.ts
│   │       └── payment-history-response.dto.ts
│   ├── webhooks/
│   │   ├── webhooks.module.ts
│   │   ├── webhooks.controller.ts     # ✅ Query param HMAC
│   │   ├── webhooks.service.ts
│   │   ├── dto/
│   │   │   └── paymob-webhook.dto.ts
│   │   └── services/
│   │       └── license-key-generator.service.ts
│   └── email/
│       ├── email.module.ts
│       ├── email.service.ts
│       └── templates/
│           ├── license-key.hbs
│           └── magic-link.hbs         # ✅ NEW

apps/ptah-landing-page/               # ✅ EXISTING app
├── src/
│   └── app/
│       ├── pages/
│       │   ├── landing-page.component.ts      # ✅ Existing
│       │   ├── auth-login.component.ts        # ✅ NEW
│       │   └── portal/
│       │       ├── dashboard.component.ts     # ✅ NEW
│       │       ├── subscription.component.ts  # ✅ NEW
│       │       └── payments.component.ts      # ✅ NEW
│       └── services/
│           └── license-api.service.ts         # ✅ NEW (HTTP client)
```

**Key Integration Points**:

- Backend: `apps/ptah-license-server/` (NEW NestJS app)
- Frontend: `apps/ptah-landing-page/` (EXISTING Angular app - add portal pages)

---

## 5. API Endpoints (Complete List)

### 5.1. License Verification (Unchanged)

**Endpoint**: `POST /api/v1/licenses/verify`

**Purpose**: Verify license key premium status for VS Code extension

**Request**:

```typescript
{
  "licenseKey": "ptah_lic_a1b2c3d4e5f6789012345678901234"
}
```

**Response (Valid)**:

```typescript
{
  "valid": true,
  "tier": "premium",
  "email": "user@example.com",
  "expiresAt": "2026-01-15T00:00:00Z"
}
```

**Response (Invalid)**:

```typescript
{
  "valid": false,
  "tier": "free"
}
```

**Implementation**:

```typescript
// apps/ptah-license-server/src/licenses/licenses.controller.ts
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

  @Post('resend')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async resendLicenseKey(@Req() request: Request) {
    const userId = request.user.id;
    return this.licensesService.resendLicenseKey(userId);
  }
}
```

### 5.2. Magic Link Authentication

**Endpoint 1**: `POST /api/v1/auth/magic-link`

**Purpose**: Generate magic link and send email

**Request**:

```typescript
{
  "email": "user@example.com"
}
```

**Response**:

```typescript
{
  "success": true,
  "message": "Check your email for login link"
}
```

**Endpoint 2**: `GET /api/v1/auth/verify?token=<magic-token>`

**Purpose**: Validate magic link token, set JWT cookie, redirect to portal

**Flow**:

```
1. User receives email with link: https://ptah.dev/auth/verify?token=abc123...
2. User clicks link
3. Backend validates token (30-second TTL, single-use)
4. Backend sets JWT cookie (HTTP-only, 7-day expiration)
5. Backend redirects to /portal/dashboard
```

**Implementation**:

```typescript
// apps/ptah-license-server/src/auth/auth.controller.ts
import { Controller, Post, Get, Body, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './services/auth.service';
import { MagicLinkService } from './services/magic-link.service';

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

    // Set HTTP-only cookie
    response.cookie('access_token', jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Redirect to portal dashboard
    return response.redirect(`${process.env.FRONTEND_URL}/portal/dashboard`);
  }
}
```

### 5.3. Customer Portal API

**Endpoint 1**: `GET /api/v1/subscriptions/me`

**Purpose**: Get current user's subscription status

**Headers**: `Cookie: access_token=<jwt>`

**Response**:

```typescript
{
  "id": "sub_abc123",
  "status": "active",
  "currentPeriodEnd": "2026-01-15T00:00:00Z",
  "plan": {
    "name": "Premium",
    "amount": 800
  }
}
```

**Endpoint 2**: `POST /api/v1/subscriptions/cancel`

**Purpose**: Cancel user's subscription via Paymob API

**Headers**: `Cookie: access_token=<jwt>`

**Response**:

```typescript
{
  "success": true,
  "message": "Subscription cancelled successfully"
}
```

**Implementation**:

```typescript
// apps/ptah-license-server/src/subscriptions/subscriptions.controller.ts
import { Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
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

  @Post('cancel')
  async cancelSubscription(@Req() request: Request) {
    const userId = request.user.id;
    return this.subscriptionsService.cancelSubscription(userId);
  }
}
```

**Endpoint 3**: `GET /api/v1/payments/history`

**Purpose**: Get user's payment history

**Headers**: `Cookie: access_token=<jwt>`

**Response**:

```typescript
[
  {
    date: '2025-12-15T00:00:00Z',
    amount: 800,
    status: 'paid',
    invoiceUrl: 'https://paymob.com/invoice/abc123',
  },
];
```

### 5.4. Paymob Webhook (CORRECTED)

**Endpoint**: `POST /api/v1/webhooks/paymob?hmac=<calculated-hash>`

**CRITICAL**: HMAC signature is in QUERY PARAMETER, NOT header

**Purpose**: Process Paymob subscription events

**Request Body**:

```typescript
{
  "type": "TRANSACTION" | "SUBSCRIPTION_CREATED" | "SUBSCRIPTION_CANCELED" | "SUBSCRIPTION_RENEWED",
  "obj": {
    "id": 12345,
    "success": true,
    "amount_cents": 80000,
    "currency": "EGP",
    "subscription_id": "sub_abc123",
    "billing_data": {
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "+201234567890"
    },
    "created_at": "2025-12-15T00:00:00Z"
  }
}
```

**Response**:

```typescript
{
  "received": true
}
```

**Implementation (Query Param HMAC)**:

```typescript
// apps/ptah-license-server/src/webhooks/webhooks.controller.ts
import { Controller, Post, Body, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PaymobHmacGuard } from '../common/guards/paymob-hmac.guard';
import { PaymobWebhookDto } from './dto/paymob-webhook.dto';

@Controller('api/v1/webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('paymob')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PaymobHmacGuard)
  async handlePaymob(
    @Body() payload: PaymobWebhookDto,
    @Query('hmac') hmac: string // ✅ Query parameter, NOT header
  ): Promise<{ received: true }> {
    await this.webhooksService.processPaymob(payload);
    return { received: true };
  }
}
```

---

## 6. Paymob HMAC Validation (Corrected)

**CRITICAL CORRECTION**: User's Postman collection shows HMAC in query parameter, NOT header

**Guard Implementation**:

```typescript
// apps/ptah-license-server/src/common/guards/paymob-hmac.guard.ts
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
    const hmacParam = request.query.hmac; // ✅ Query parameter, NOT header
    const body = request.body;

    if (!hmacParam) {
      throw new UnauthorizedException('Missing HMAC parameter');
    }

    // Calculate expected HMAC
    const expectedHmac = crypto.createHmac('sha256', this.hmacSecret).update(JSON.stringify(body)).digest('hex');

    // Constant-time comparison (timing attack prevention)
    if (!crypto.timingSafeEqual(Buffer.from(hmacParam), Buffer.from(expectedHmac))) {
      throw new UnauthorizedException('Invalid HMAC signature');
    }

    return true;
  }
}
```

**Paymob Dashboard Configuration**:

- Navigate to: Paymob Dashboard → Profile tab
- Copy: HMAC Secret
- Environment Variable: `PAYMOB_HMAC_SECRET`

**Webhook URL Format**:

```
https://your-server.com/api/v1/webhooks/paymob?hmac=<calculated-hash>
```

**Paymob calculates the hash and appends it as query parameter automatically**

---

## 7. Magic Link Service (Reuse TicketService Pattern)

**Source Pattern**: `apps/ptah-license-server/src/app/auth/services/ticket.service.ts`

**Implementation**:

```typescript
// apps/ptah-license-server/src/auth/services/magic-link.service.ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class MagicLinkService {
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
      return null; // Token expired or invalid
    }

    // Single-use enforcement
    clearTimeout(data.timeoutId);
    this.tokens.delete(token);

    return data.email;
  }
}
```

**Pattern Evidence**:

- Source: `apps/ptah-license-server/src/app/auth/services/ticket.service.ts:37-85`
- Uses: `crypto.randomBytes(32).toString('hex')` (128-bit entropy)
- TTL: 30 seconds (same as original TicketService)
- Storage: In-memory Map (sufficient for single-instance deployment)
- Cleanup: Automatic timeout with `setTimeout`

**Multi-Instance Note**: For production with multiple instances, replace Map with Redis

---

## 8. Customer Portal UI (Angular Pages)

### 8.1. Auth Login Page

**File**: `apps/ptah-landing-page/src/app/pages/auth-login.component.ts`

```typescript
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LicenseApiService } from '../services/license-api.service';

@Component({
  selector: 'app-auth-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container max-w-md mx-auto mt-20 p-8 bg-white rounded-lg shadow">
      <h1 class="text-2xl font-bold mb-4">Login to Ptah Portal</h1>

      <form (ngSubmit)="requestMagicLink()" #loginForm="ngForm">
        <div class="mb-4">
          <label class="block text-gray-700 mb-2">Email</label>
          <input type="email" name="email" [(ngModel)]="email" required email class="w-full px-4 py-2 border rounded" placeholder="user@example.com" />
        </div>

        <button type="submit" [disabled]="!loginForm.form.valid || loading" class="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          {{ loading ? 'Sending...' : 'Send Magic Link' }}
        </button>
      </form>

      <p *ngIf="message" class="mt-4 text-green-600">{{ message }}</p>
      <p *ngIf="error" class="mt-4 text-red-600">{{ error }}</p>
    </div>
  `,
})
export class AuthLoginComponent {
  email = '';
  loading = false;
  message = '';
  error = '';

  constructor(private readonly licenseApi: LicenseApiService) {}

  async requestMagicLink() {
    this.loading = true;
    this.message = '';
    this.error = '';

    try {
      await this.licenseApi.requestMagicLink(this.email);
      this.message = 'Check your email for the login link!';
    } catch (err) {
      this.error = 'Failed to send magic link. Please try again.';
    } finally {
      this.loading = false;
    }
  }
}
```

### 8.2. Portal Dashboard

**File**: `apps/ptah-landing-page/src/app/pages/portal/dashboard.component.ts`

```typescript
import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LicenseApiService } from '../../services/license-api.service';

@Component({
  selector: 'app-portal-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container mx-auto mt-10 p-8">
      <h1 class="text-3xl font-bold mb-6">Subscription Dashboard</h1>

      <div *ngIf="subscription()" class="bg-white rounded-lg shadow p-6">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-gray-600">Status</p>
            <p class="text-xl font-semibold">{{ subscription().status }}</p>
          </div>
          <div>
            <p class="text-gray-600">Renewal Date</p>
            <p class="text-xl font-semibold">
              {{ subscription().currentPeriodEnd | date : 'mediumDate' }}
            </p>
          </div>
        </div>

        <div class="mt-6">
          <button (click)="resendLicenseKey()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Resend License Key Email</button>
        </div>

        <p class="mt-4 text-sm text-gray-500">Your license key was sent to {{ subscription().email }}</p>
      </div>

      <p *ngIf="message()" class="mt-4 text-green-600">{{ message() }}</p>
    </div>
  `,
})
export class PortalDashboardComponent implements OnInit {
  subscription = signal<any>(null);
  message = signal('');

  constructor(private readonly licenseApi: LicenseApiService) {}

  async ngOnInit() {
    this.subscription.set(await this.licenseApi.getSubscription());
  }

  async resendLicenseKey() {
    await this.licenseApi.resendLicenseKey();
    this.message.set('License key email sent!');
  }
}
```

### 8.3. License API Service

**File**: `apps/ptah-landing-page/src/app/services/license-api.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LicenseApiService {
  private readonly baseUrl = 'https://api.ptah.dev/api/v1';

  constructor(private readonly http: HttpClient) {}

  async requestMagicLink(email: string): Promise<void> {
    await lastValueFrom(this.http.post(`${this.baseUrl}/auth/magic-link`, { email }));
  }

  async getSubscription(): Promise<any> {
    return lastValueFrom(this.http.get(`${this.baseUrl}/subscriptions/me`, { withCredentials: true }));
  }

  async resendLicenseKey(): Promise<void> {
    await lastValueFrom(this.http.post(`${this.baseUrl}/licenses/resend`, {}, { withCredentials: true }));
  }

  async cancelSubscription(): Promise<void> {
    await lastValueFrom(this.http.post(`${this.baseUrl}/subscriptions/cancel`, {}, { withCredentials: true }));
  }

  async getPaymentHistory(): Promise<any[]> {
    return lastValueFrom(this.http.get<any[]>(`${this.baseUrl}/payments/history`, { withCredentials: true }));
  }
}
```

**Key Pattern**: `withCredentials: true` ensures JWT cookie is sent with requests

---

## 9. Paymob API Flow (Complete)

**Reference**: User's Postman collection + research-report.md

### Step 1: Create Subscription Plan (One-Time Setup)

**Endpoint**: `POST https://accept.paymob.com/api/acceptance/subscription-plans`

**Request**:

```json
{
  "frequency": 30,
  "amount_cents": 80000,
  "integration": <MOTO_INTEGRATION_ID>,
  "webhook_url": "https://api.ptah.dev/api/v1/webhooks/paymob"
}
```

**Response**:

```json
{
  "id": 12345,
  "frequency": 30,
  "amount_cents": 80000
}
```

**Save**: `PAYMOB_SUBSCRIPTION_PLAN_ID=12345` in environment variables

### Step 2: Customer Subscribes

**Endpoint**: `POST https://accept.paymob.com/v1/intention/`

**Request**:

```json
{
  "amount": 80000,
  "subscription_plan_id": 12345,
  "billing_data": {
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "phone_number": "+201234567890"
  }
}
```

**Response**:

```json
{
  "payment_url": "https://accept.paymob.com/subscription/checkout?token=abc123"
}
```

**Frontend**: Redirect user to `payment_url` to complete payment

### Step 3: Webhook Events

**Event 1: TRANSACTION (Successful Payment)**

```json
{
  "type": "TRANSACTION",
  "obj": {
    "success": true,
    "subscription_id": "sub_abc123",
    "billing_data": {
      "email": "user@example.com"
    }
  }
}
```

**Backend Action**:

1. Create User (if new)
2. Create Subscription
3. Generate License Key
4. Send Email

**Event 2: SUBSCRIPTION_CANCELED**

```json
{
  "type": "SUBSCRIPTION_CANCELED",
  "obj": {
    "subscription_id": "sub_abc123"
  }
}
```

**Backend Action**:

1. Update Subscription status to "canceled"
2. Revoke License Key

**Event 3: SUBSCRIPTION_RENEWED**

```json
{
  "type": "SUBSCRIPTION_RENEWED",
  "obj": {
    "subscription_id": "sub_abc123",
    "current_period_end": "2026-01-15T00:00:00Z"
  }
}
```

**Backend Action**:

1. Update Subscription currentPeriodEnd

---

## 10. Environment Variables

```bash
# Database (Prisma with driver adapters)
DATABASE_URL=postgresql://user:password@host:5432/ptah_licenses

# Paymob (from dashboard)
PAYMOB_API_KEY=<from dashboard>
PAYMOB_HMAC_SECRET=<from dashboard profile tab>
PAYMOB_SUBSCRIPTION_PLAN_ID=<created via API>
PAYMOB_MOTO_INTEGRATION_ID=<from dashboard>

# Email (SendGrid)
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=<from sendgrid>

# JWT (for portal authentication)
JWT_SECRET=<random-secret-32-chars>
JWT_EXPIRATION=7d

# Frontend URL (for magic link redirects)
FRONTEND_URL=https://ptah.dev

# Node Environment
NODE_ENV=production
PORT=3000
```

**Security Notes**:

- `JWT_SECRET`: Generate with `openssl rand -hex 32`
- `PAYMOB_HMAC_SECRET`: Copy from Paymob Dashboard → Profile tab
- Never commit `.env` to git (use `.env.example` template)

---

## 11. User Experience Flow (Complete)

### Flow 1: First-Time Subscription

```
1. User visits ptah.dev
2. Clicks "Subscribe to Premium" ($8/month)
3. Redirected to Paymob checkout
4. Completes payment
5. Paymob webhook fires → Backend receives TRANSACTION event
6. Backend:
   a. Creates User (email from billing_data)
   b. Creates Subscription
   c. Generates License Key: ptah_lic_<32-hex>
   d. Sends email with:
      - License Key
      - Magic link for portal access
7. User receives email:
   Subject: "Your Ptah Premium License Key"
   Body:
     - License Key: ptah_lic_abc123...
     - Magic Link: https://ptah.dev/auth/verify?token=xyz789...
     - Instructions: Copy license key to VS Code settings
8. User clicks magic link → Auto-login to portal
9. Portal shows:
   - Subscription status: active
   - Renewal date: 2026-01-15
   - "Resend License Key Email" button
```

### Flow 2: Portal Access (Returning User)

```
1. User visits ptah.dev/auth/login
2. Enters email
3. Clicks "Send Magic Link"
4. Backend:
   a. Generates 30-second token
   b. Sends email with magic link
5. User clicks link → JWT cookie set → Redirect to portal
6. Portal dashboard loads:
   - Subscription status
   - Renewal date
   - Payment history
   - Cancel subscription button
```

### Flow 3: License Key Resend

```
1. User in portal dashboard
2. Clicks "Resend License Key Email"
3. Backend:
   a. Validates JWT (user is authenticated)
   b. Finds user's active license
   c. Sends email with license key
4. User receives email (same template as initial email)
```

**CRITICAL SECURITY**: License key is NEVER displayed in portal UI (only emailed)

### Flow 4: Subscription Cancellation

```
1. User in portal → Clicks "Cancel Subscription"
2. Frontend calls POST /api/v1/subscriptions/cancel
3. Backend:
   a. Calls Paymob API to cancel subscription
   b. Updates Subscription status to "canceled"
   c. Revokes License Key (status = "revoked")
4. VS Code extension next verification:
   - POST /api/v1/licenses/verify
   - Response: { valid: false, tier: "free" }
   - Extension disables premium features
```

---

## 12. Team-Leader Handoff

### Developer Type Recommendation

**Backend Work**: backend-developer (Batches 1-3)

- NestJS services
- Prisma schema
- Paymob integration
- Magic link authentication

**Frontend Work**: frontend-developer (Batch 4)

- Angular components
- Portal pages
- HTTP client service

**Testing**: senior-tester (Batch 5)

- E2E flow testing
- Paymob sandbox integration
- Email delivery verification

### Batch Strategy (4-5 Day Timeline)

**Batch 1: Backend Core** (Day 1-2)

- Task 1.1: Setup Prisma with driver adapters (schema.prisma + PrismaService)
- Task 1.2: Run Prisma migrations (create tables: users, subscriptions, licenses)
- Task 1.3: Implement POST /api/v1/licenses/verify endpoint
- Task 1.4: Implement Paymob webhook with CORRECTED HMAC validation (query param)

**Batch 2: Magic Link Auth** (Day 2)

- Task 2.1: Implement MagicLinkService (reuse TicketService pattern)
- Task 2.2: Implement POST /api/v1/auth/magic-link endpoint
- Task 2.3: Implement GET /api/v1/auth/verify endpoint with JWT cookie
- Task 2.4: Create magic-link.hbs email template

**Batch 3: Customer Portal API** (Day 3)

- Task 3.1: Implement GET /api/v1/subscriptions/me endpoint
- Task 3.2: Implement POST /api/v1/subscriptions/cancel (integrate Paymob API)
- Task 3.3: Implement GET /api/v1/payments/history endpoint
- Task 3.4: Implement POST /api/v1/licenses/resend endpoint

**Batch 4: Landing Page Portal UI** (Day 4)

- Task 4.1: Create auth-login.component.ts (magic link form)
- Task 4.2: Create portal/dashboard.component.ts (subscription overview)
- Task 4.3: Create portal/subscription.component.ts (cancel subscription)
- Task 4.4: Create portal/payments.component.ts (payment history table)
- Task 4.5: Create license-api.service.ts (HTTP client for API calls)

**Batch 5: Integration & Testing** (Day 5)

- Task 5.1: E2E test: Subscribe → Webhook → Email → Portal login
- Task 5.2: Test Paymob sandbox integration (trigger test webhooks)
- Task 5.3: Deploy to DigitalOcean (environment variables + migrations)
- Task 5.4: Verify production webhook endpoint (HMAC validation)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 32-40 hours (4-5 days)

**Breakdown**:

- Backend API: 16-20 hours (3 developers-days)
- Frontend Portal: 8-10 hours (1 developer-day)
- Integration/Testing: 8-10 hours (1 developer-day)

### Files Affected Summary

**CREATE (Backend)**:

- `apps/ptah-license-server/prisma/schema.prisma`
- `apps/ptah-license-server/src/database/prisma.service.ts`
- `apps/ptah-license-server/src/auth/services/magic-link.service.ts`
- `apps/ptah-license-server/src/subscriptions/subscriptions.module.ts`
- `apps/ptah-license-server/src/subscriptions/subscriptions.controller.ts`
- `apps/ptah-license-server/src/subscriptions/subscriptions.service.ts`
- `apps/ptah-license-server/src/email/templates/magic-link.hbs`
- `apps/ptah-license-server/src/common/guards/paymob-hmac.guard.ts`

**CREATE (Frontend)**:

- `apps/ptah-landing-page/src/app/pages/auth-login.component.ts`
- `apps/ptah-landing-page/src/app/pages/portal/dashboard.component.ts`
- `apps/ptah-landing-page/src/app/pages/portal/subscription.component.ts`
- `apps/ptah-landing-page/src/app/pages/portal/payments.component.ts`
- `apps/ptah-landing-page/src/app/services/license-api.service.ts`

**MODIFY (Backend)**:

- `apps/ptah-license-server/src/auth/auth.controller.ts` (add magic link endpoints)
- `apps/ptah-license-server/src/auth/auth.service.ts` (remove WorkOS, add magic link logic)
- `apps/ptah-license-server/src/licenses/licenses.controller.ts` (add resend endpoint)
- `apps/ptah-license-server/src/webhooks/webhooks.controller.ts` (change to query param HMAC)

**REWRITE**: None (all changes are additive or minor modifications)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **Prisma Driver Adapters Setup**:

   - Verify `previewFeatures = ["driverAdapters"]` in schema.prisma
   - Verify `@prisma/adapter-pg` and `pg` packages installed
   - Verify PrismaService uses `PrismaPg` adapter
   - Reference: `apps/ptah-license-server/src/database/prisma.service.ts:9-24`

2. **Paymob HMAC Query Parameter**:

   - Verify HMAC read from `request.query.hmac` (NOT header)
   - Verify guard implementation matches user's Postman collection
   - Reference: `apps/ptah-license-server/src/common/guards/paymob-hmac.guard.ts:14`

3. **Magic Link Pattern Reuse**:

   - Verify MagicLinkService uses `crypto.randomBytes(32).toString('hex')`
   - Verify 30-second TTL matches TicketService pattern
   - Verify single-use enforcement (token deleted after validation)
   - Reference: `apps/ptah-license-server/src/app/auth/services/ticket.service.ts:37-85`

4. **Portal JWT Cookie Pattern**:

   - Verify HTTP-only cookie set in /auth/verify endpoint
   - Verify JwtAuthGuard extracts user from cookie
   - Verify frontend sends `withCredentials: true` in HTTP calls
   - Reference: Existing JwtAuthGuard pattern in auth module

5. **License Key Security**:
   - Verify license keys NEVER returned in portal API responses
   - Verify /licenses/resend endpoint only sends email (not display key)
   - Verify portal components don't display license keys

### Architecture Delivery Checklist

- [x] Prisma schema with driver adapters specified
- [x] Paymob HMAC validation corrected (query param)
- [x] Magic link authentication specified (reuses TicketService pattern)
- [x] Customer portal API endpoints defined
- [x] Landing page component specifications provided
- [x] License key security enforced (never displayed in portal)
- [x] User experience flows documented
- [x] Environment variables listed
- [x] Batch strategy defined (4-5 days)
- [x] Files affected summary complete
- [x] Critical verification points documented

---

## 13. Quality Requirements (Architecture-Level)

### Functional Requirements

**License Verification**:

- Must respond <200ms (p95 latency)
- Must handle invalid license keys gracefully
- Must check subscription status and expiration

**Paymob Webhooks**:

- Must validate HMAC signature (query param)
- Must process idempotently (duplicate webhooks ignored)
- Must send emails asynchronously (non-blocking)

**Magic Link Authentication**:

- Must expire tokens after 30 seconds
- Must enforce single-use (token consumed on validation)
- Must set secure HTTP-only cookies

**Customer Portal**:

- Must protect routes with JWT authentication
- Must NEVER display license keys in UI
- Must allow subscription cancellation

### Non-Functional Requirements

**Performance**:

- License verification: <200ms p95 latency
- Webhook processing: <5s end-to-end
- Email delivery: <10s (with 3 retries)

**Security**:

- HMAC signature validation (timing-safe comparison)
- HTTP-only cookies for JWT
- Single-use magic link tokens
- License keys never in frontend

**Maintainability**:

- Prisma schema as single source of truth
- Type-safe API with Prisma Client
- Clear separation: backend (NestJS) / frontend (Angular)

**Testability**:

- Unit tests for services (LicensesService, WebhooksService, MagicLinkService)
- E2E tests for API endpoints
- Paymob sandbox integration for webhooks

### Pattern Compliance

**Prisma Driver Adapters**:

- Must use `@prisma/adapter-pg` with `pg` driver
- Must enable `previewFeatures = ["driverAdapters"]`
- Reference: https://www.prisma.io/docs/orm/overview/databases/database-drivers#driver-adapters

**Magic Link Pattern**:

- Must reuse TicketService crypto pattern
- Must use `crypto.randomBytes(32).toString('hex')`
- Reference: `apps/ptah-license-server/src/app/auth/services/ticket.service.ts:37-85`

**JWT Cookie Pattern**:

- Must reuse existing JwtAuthGuard pattern
- Must set `httpOnly: true, secure: true, sameSite: 'strict'`
- Reference: Existing auth module patterns

---

## 14. Success Metrics

**Technical Metrics**:

- License verification latency: <200ms (p95) ✅
- Webhook processing time: <5s end-to-end ✅
- Email delivery success rate: >99% ✅
- Database query latency: <10ms (p99) ✅

**Business Metrics**:

- Infrastructure cost: <$50/month ✅
- Deployment time: <10 minutes (Docker) ✅
- Zero critical bugs in production first 2 weeks ✅
- User can access portal within 30 seconds of payment ✅

**Evidence Quality**:

- All patterns verified from existing codebase ✅
- Prisma driver adapters implementation documented ✅
- Paymob HMAC query param verified from user's Postman ✅
- Magic link reuses proven TicketService pattern ✅

---

## Architecture Blueprint Complete

**Deliverables**:

- ✅ Prisma schema with driver adapters (NO Rust binary)
- ✅ Corrected Paymob HMAC validation (query parameter)
- ✅ Magic link authentication (reuses TicketService pattern)
- ✅ Customer portal integration (landing page + backend APIs)
- ✅ License key security enforced (never displayed)
- ✅ Complete user experience flows documented
- ✅ Batch strategy (4-5 days) with task breakdown
- ✅ All evidence cited from existing codebase

**Ready for Team-Leader Decomposition**

Team-leader will:

1. Create tasks.md with atomic, git-verifiable tasks
2. Assign Batch 1-3 to backend-developer
3. Assign Batch 4 to frontend-developer
4. Assign Batch 5 to senior-tester
5. Verify git commits after each task completion
