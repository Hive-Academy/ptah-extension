# Implementation Plan - TASK_2025_043

**Task**: Ptah License Server Implementation  
**Software Architect**: Elite Architecture Agent  
**Created**: 2025-12-07  
**Target Completion**: 2-3 days (16-24 hours)

---

## 🎯 Goal

Create a minimal, production-ready NestJS license server with exactly **2 REST endpoints** and **3 database tables** to enable Ptah's premium SaaS business model. This is a **NEW standalone backend project** (not part of the main ptah-extension monorepo).

**Core Value**:

- Enable $8/month premium subscriptions
- Automated license generation via Paymob webhooks
- Fast license verification for VS Code extension (<200ms p95)
- Keep infrastructure cost <$50/month

---

## 📦 Project Structure

```
ptah-license-server/                    # NEW standalone NestJS project
├── src/
│   ├── app.module.ts                   # Root module
│   ├── main.ts                         # Application entry point
│   ├── common/                         # Shared utilities
│   │   ├── config/
│   │   │   └── configuration.ts        # Environment configuration
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts # Global error handling
│   │   └── guards/
│   │       └── hmac-signature.guard.ts  # Paymob signature verification
│   ├── database/                       # Database module
│   │   ├── database.module.ts
│   │   └── migrations/                 # TypeORM migrations
│   │       └── 1733594400000-InitialSchema.ts
│   ├── entities/                       # TypeORM entities (3 tables)
│   │   ├── user.entity.ts              # Users table
│   │   ├── subscription.entity.ts      # Subscriptions table
│   │   └── license.entity.ts           # Licenses table
│   ├── licenses/                       # License verification module
│   │   ├── licenses.module.ts
│   │   ├── licenses.controller.ts      # POST /api/v1/licenses/verify
│   │   ├── licenses.service.ts         # Business logic
│   │   ├── dto/
│   │   │   ├── verify-license.dto.ts   # Request DTO
│   │   │   └── verify-license-response.dto.ts # Response DTO
│   │   └── repositories/
│   │       └── license.repository.ts   # Database queries
│   ├── webhooks/                       # Paymob webhook module
│   │   ├── webhooks.module.ts
│   │   ├── webhooks.controller.ts      # POST /api/v1/webhooks/paymob
│   │   ├── webhooks.service.ts         # Webhook processing logic
│   │   ├── dto/
│   │   │   └── paymob-webhook.dto.ts   # Paymob payload DTO
│   │   └── services/
│   │       ├── license-key-generator.service.ts  # Crypto key generation
│   │       └── signature-verifier.service.ts     # HMAC verification
│   └── email/                          # Email delivery module
│       ├── email.module.ts
│       ├── email.service.ts            # SendGrid/Resend integration
│       └── templates/
│           └── license-activation.hbs   # Handlebars template
├── test/
│   └── app.e2e-spec.ts                 # E2E tests
├── .env.example                        # Environment template
├── Dockerfile                          # Production container
├── docker-compose.yml                  # Local development
├── package.json
├── tsconfig.json
└── README.md                           # Project documentation
```

---

## 🗄️ Database Schema (PostgreSQL)

### Entity 1: User

**Purpose**: Store user information (email only)

**File**: `src/entities/user.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { Subscription } from './subscription.entity';
import { License } from './license.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => Subscription, (subscription) => subscription.user, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  subscriptions: Subscription[];

  @OneToMany(() => License, (license) => license.user, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  licenses: License[];
}
```

**Indexes**:

- `UNIQUE INDEX` on `email` (auto-created by unique constraint)

---

### Entity 2: Subscription

**Purpose**: Track Paymob subscription status

**File**: `src/entities/subscription.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  PAST_DUE = 'past_due',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.subscriptions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  paymobSubscriptionId: string | null;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd: Date | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
```

**Indexes**:

- `UNIQUE INDEX` on `paymobSubscriptionId` (auto-created)
- `INDEX` on `userId` (foreign key, auto-indexed by TypeORM)

---

### Entity 3: License

**Purpose**: Store license keys with status

**File**: `src/entities/license.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';

export enum LicenseStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

@Entity('licenses')
@Index('idx_license_key', ['licenseKey']) // Explicit index for fast lookups
export class License {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.licenses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 255, unique: true })
  licenseKey: string; // Format: ptah_lic_{32-hex}

  @Column({
    type: 'enum',
    enum: LicenseStatus,
    default: LicenseStatus.ACTIVE,
  })
  status: LicenseStatus;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null; // NULL = never expires (for lifetime licenses)

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
```

**Indexes**:

- `UNIQUE INDEX` on `licenseKey` (enforced by unique constraint)
- `INDEX` on `licenseKey` (explicit index for <10ms queries)
- `INDEX` on `userId` (foreign key, auto-indexed)

---

## 🔌 API Endpoints

### Endpoint 1: License Verification

**File**: `src/licenses/licenses.controller.ts`

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LicensesService } from './licenses.service';
import { VerifyLicenseDto } from './dto/verify-license.dto';
import { VerifyLicenseResponseDto } from './dto/verify-license-response.dto';

@ApiTags('licenses')
@Controller('api/v1/licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify license key premium status' })
  @ApiResponse({
    status: 200,
    description: 'License verification result',
    type: VerifyLicenseResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid license key format' })
  @ApiResponse({ status: 503, description: 'Database unavailable' })
  async verifyLicense(@Body() dto: VerifyLicenseDto): Promise<VerifyLicenseResponseDto> {
    return this.licensesService.verifyLicense(dto.licenseKey);
  }
}
```

**Service Logic**: `src/licenses/licenses.service.ts`

```typescript
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { License, LicenseStatus } from '../entities/license.entity';
import { Subscription, SubscriptionStatus } from '../entities/subscription.entity';
import { VerifyLicenseResponseDto } from './dto/verify-license-response.dto';

@Injectable()
export class LicensesService {
  constructor(
    @InjectRepository(License)
    private readonly licenseRepo: Repository<License>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>
  ) {}

  async verifyLicense(licenseKey: string): Promise<VerifyLicenseResponseDto> {
    try {
      // Query with index on licenseKey (<10ms p99)
      const license = await this.licenseRepo.findOne({
        where: { licenseKey },
        relations: ['user'],
      });

      // Non-existent or revoked license → free tier
      if (!license || license.status !== LicenseStatus.ACTIVE) {
        return { valid: false, tier: 'free' };
      }

      // Check if subscription is still active
      const subscription = await this.subscriptionRepo.findOne({
        where: { userId: license.userId },
        order: { createdAt: 'DESC' }, // Get most recent subscription
      });

      if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE) {
        return { valid: false, tier: 'free' };
      }

      // Check expiration (if expiresAt is set and in the past)
      if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) < new Date()) {
        return { valid: false, tier: 'free' };
      }

      // Valid premium license
      return {
        valid: true,
        tier: 'premium',
        email: license.user.email,
        expiresAt: subscription.currentPeriodEnd?.toISOString() || null,
      };
    } catch (error) {
      // Database connection failure → 503
      throw new HttpException('Service temporarily unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
```

**DTOs**:

`src/licenses/dto/verify-license.dto.ts`:

```typescript
import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyLicenseDto {
  @ApiProperty({
    example: 'ptah_lic_a1b2c3d4e5f6789012345678901234',
    pattern: '^ptah_lic_[a-f0-9]{32}$',
  })
  @IsString()
  @Matches(/^ptah_lic_[a-f0-9]{32}$/, {
    message: 'License key must be format: ptah_lic_{32-hex}',
  })
  licenseKey: string;
}
```

`src/licenses/dto/verify-license-response.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class VerifyLicenseResponseDto {
  @ApiProperty({ example: true })
  valid: boolean;

  @ApiProperty({ example: 'premium', enum: ['free', 'premium'] })
  tier: 'free' | 'premium';

  @ApiProperty({ example: 'user@example.com', required: false })
  email?: string;

  @ApiProperty({
    example: '2026-12-31T23:59:59.000Z',
    required: false,
    nullable: true,
  })
  expiresAt?: string | null;
}
```

---

### Endpoint 2: Paymob Webhook

**File**: `src/webhooks/webhooks.controller.ts`

```typescript
import { Controller, Post, Body, Headers, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { PaymobWebhookDto } from './dto/paymob-webhook.dto';
import { HmacSignatureGuard } from '../common/guards/hmac-signature.guard';

@ApiTags('webhooks')
@Controller('api/v1/webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('paymob')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HmacSignatureGuard) // Verify HMAC-SHA256 signature
  @ApiOperation({ summary: 'Handle Paymob payment webhooks' })
  @ApiHeader({ name: 'x-paymob-signature', required: true })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async handlePaymob(@Body() payload: PaymobWebhookDto, @Headers('x-paymob-signature') signature: string): Promise<{ received: true }> {
    await this.webhooksService.processPaymob(payload);
    return { received: true };
  }
}
```

**Service Logic**: `src/webhooks/webhooks.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Subscription, SubscriptionStatus } from '../entities/subscription.entity';
import { License, LicenseStatus } from '../entities/license.entity';
import { LicenseKeyGeneratorService } from './services/license-key-generator.service';
import { EmailService } from '../email/email.service';
import { PaymobWebhookDto } from './dto/paymob-webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(License)
    private readonly licenseRepo: Repository<License>,
    private readonly keyGenerator: LicenseKeyGeneratorService,
    private readonly emailService: EmailService
  ) {}

  async processPaymob(payload: PaymobWebhookDto): Promise<void> {
    const { type, obj } = payload;

    if (type === 'TRANSACTION' && obj.success) {
      await this.handleSuccessfulPayment(obj);
    } else if (type === 'SUBSCRIPTION_CANCELED') {
      await this.handleSubscriptionCancellation(obj);
    }
  }

  private async handleSuccessfulPayment(obj: any): Promise<void> {
    const email = obj.billing_data.email;
    const paymobSubscriptionId = obj.subscription_id;

    // Idempotency: check if subscription already processed
    const existingSubscription = await this.subscriptionRepo.findOne({
      where: { paymobSubscriptionId },
    });

    if (existingSubscription) {
      this.logger.log(`Duplicate webhook for subscription ${paymobSubscriptionId}, skipping`);
      return;
    }

    // Create or find user
    let user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      user = this.userRepo.create({ email });
      user = await this.userRepo.save(user);
      this.logger.log(`Created new user: ${email}`);
    }

    // Create subscription
    const subscription = this.subscriptionRepo.create({
      userId: user.id,
      paymobSubscriptionId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });
    await this.subscriptionRepo.save(subscription);
    this.logger.log(`Created subscription for user ${email}`);

    // Generate license key with collision retry
    const licenseKey = await this.keyGenerator.generateUnique();

    const license = this.licenseRepo.create({
      userId: user.id,
      licenseKey,
      status: LicenseStatus.ACTIVE,
      expiresAt: null, // NULL = never expires for now
    });
    await this.licenseRepo.save(license);
    this.logger.log(`Generated license key: ${licenseKey}`);

    // Send email (async, fire-and-forget with retry)
    this.emailService.sendLicenseKey(email, licenseKey).catch((error) => {
      this.logger.error(`Failed to send email to ${email}: ${error.message}`, error.stack);
      // Log for manual intervention (don't throw - webhook already processed)
    });
  }

  private async handleSubscriptionCancellation(obj: any): Promise<void> {
    const paymobSubscriptionId = obj.subscription_id;

    const subscription = await this.subscriptionRepo.findOne({
      where: { paymobSubscriptionId },
    });

    if (!subscription) {
      this.logger.warn(`Cancellation webhook for unknown subscription ${paymobSubscriptionId}`);
      return;
    }

    // Update subscription status
    subscription.status = SubscriptionStatus.CANCELED;
    await this.subscriptionRepo.save(subscription);

    // Revoke all licenses for this user
    await this.licenseRepo.update({ userId: subscription.userId }, { status: LicenseStatus.REVOKED });

    this.logger.log(`Canceled subscription and revoked licenses for user ${subscription.userId}`);
  }
}
```

**HMAC Signature Verification Guard**: `src/common/guards/hmac-signature.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class HmacSignatureGuard implements CanActivate {
  private readonly logger = new Logger(HmacSignatureGuard.name);
  private readonly paymobSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.paymobSecret = this.configService.get<string>('PAYMOB_SECRET_KEY');
    if (!this.paymobSecret) {
      throw new Error('PAYMOB_SECRET_KEY environment variable is required');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-paymob-signature'];
    const body = request.body;

    if (!signature) {
      this.logger.warn('Missing x-paymob-signature header');
      throw new UnauthorizedException('Missing signature header');
    }

    // Compute HMAC-SHA256 (Paymob spec: HMAC of JSON body)
    const payload = JSON.stringify(body);
    const expectedSignature = crypto.createHmac('sha256', this.paymobSecret).update(payload).digest('hex');

    if (signature !== expectedSignature) {
      this.logger.error('Invalid Paymob signature', {
        received: signature,
        expected: expectedSignature,
      });
      throw new UnauthorizedException('Invalid signature');
    }

    this.logger.log('Paymob signature verified successfully');
    return true;
  }
}
```

**License Key Generator**: `src/webhooks/services/license-key-generator.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { License } from '../../entities/license.entity';

@Injectable()
export class LicenseKeyGeneratorService {
  constructor(
    @InjectRepository(License)
    private readonly licenseRepo: Repository<License>
  ) {}

  /**
   * Generate cryptographically secure license key
   * Format: ptah_lic_{32-hex} (total 40 chars)
   * Entropy: 128-bit (crypto.randomBytes(16))
   */
  generate(): string {
    const randomBytes = crypto.randomBytes(16); // 128-bit entropy
    const hexString = randomBytes.toString('hex'); // 32 hex characters
    return `ptah_lic_${hexString}`;
  }

  /**
   * Generate unique license key with collision retry
   * Collision probability: <1 in 2^128 (extremely unlikely)
   */
  async generateUnique(maxRetries = 3): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const licenseKey = this.generate();

      // Check for collision (should never happen in practice)
      const existing = await this.licenseRepo.findOne({
        where: { licenseKey },
      });

      if (!existing) {
        return licenseKey;
      }

      // Collision detected (log for investigation)
      console.warn(`License key collision detected (attempt ${attempt + 1}/${maxRetries}): ${licenseKey}`);
    }

    throw new Error('Failed to generate unique license key after retries (extremely rare)');
  }
}
```

---

## 📧 Email Service

**File**: `src/email/email.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';

// Email provider interfaces (SendGrid OR Resend)
interface EmailProvider {
  send(to: string, subject: string, html: string): Promise<void>;
}

class SendGridProvider implements EmailProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    // SendGrid API integration
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(this.apiKey);

    await sgMail.send({
      to,
      from: 'noreply@ptah.dev',
      subject,
      html,
    });
  }
}

class ResendProvider implements EmailProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    // Resend API integration
    const { Resend } = require('resend');
    const resend = new Resend(this.apiKey);

    await resend.emails.send({
      from: 'noreply@ptah.dev',
      to,
      subject,
      html,
    });
  }
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly provider: EmailProvider;
  private readonly templateCache = new Map<string, HandlebarsTemplateDelegate>();

  constructor(private readonly configService: ConfigService) {
    const emailProvider = this.configService.get<string>('EMAIL_PROVIDER'); // 'sendgrid' or 'resend'
    const apiKey = this.configService.get<string>('EMAIL_API_KEY');

    if (!apiKey) {
      throw new Error('EMAIL_API_KEY environment variable is required');
    }

    if (emailProvider === 'sendgrid') {
      this.provider = new SendGridProvider(apiKey);
    } else if (emailProvider === 'resend') {
      this.provider = new ResendProvider(apiKey);
    } else {
      throw new Error(`Invalid EMAIL_PROVIDER: ${emailProvider}. Use 'sendgrid' or 'resend'`);
    }
  }

  async sendLicenseKey(email: string, licenseKey: string): Promise<void> {
    const subject = 'Your Ptah Premium License Key';

    // Render email template
    const html = await this.renderTemplate('license-activation', {
      licenseKey,
      email,
      activationUrl: 'vscode://ptah.ptah-extension/activate',
      supportUrl: 'https://ptah.dev/support',
    });

    // Retry logic with exponential backoff (1s, 2s, 4s)
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.provider.send(email, subject, html);
        this.logger.log(`License key email sent to ${email}`);
        return;
      } catch (error) {
        const retryDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        this.logger.error(`Email delivery failed (attempt ${attempt + 1}/${maxRetries}): ${error.message}`);

        if (attempt < maxRetries - 1) {
          await this.sleep(retryDelay);
        } else {
          // Final failure - log for manual intervention
          this.logger.error(`Failed to send email to ${email} after ${maxRetries} attempts. License key: ${licenseKey}`);
          throw error;
        }
      }
    }
  }

  private async renderTemplate(templateName: string, context: any): Promise<string> {
    // Load template (with caching)
    if (!this.templateCache.has(templateName)) {
      const templatePath = path.join(__dirname, 'templates', `${templateName}.hbs`);
      const templateSource = await fs.readFile(templatePath, 'utf-8');
      const template = handlebars.compile(templateSource);
      this.templateCache.set(templateName, template);
    }

    const template = this.templateCache.get(templateName)!;
    return template(context);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

**Email Template**: `src/email/templates/license-activation.hbs`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Your Ptah Premium License Key</title>
  </head>
  <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="color: #333;">Welcome to Ptah Premium! 🚀</h1>

    <p>Thank you for subscribing to Ptah Premium. Your license key is ready:</p>

    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <code style="font-size: 16px; font-weight: bold; color: #0066cc;">{{licenseKey}}</code>
    </div>

    <h2>Activation Instructions</h2>
    <ol>
      <li>Open VS Code</li>
      <li>Go to Settings (Cmd+, on Mac, Ctrl+, on Windows)</li>
      <li>Search for "Ptah"</li>
      <li>Paste your license key in the "Ptah: License Key" field</li>
      <li>Reload VS Code</li>
    </ol>

    <p>Or click here to activate automatically: <a href="{{activationUrl}}?key={{licenseKey}}" style="color: #0066cc;">Activate in VS Code</a></p>

    <h2>Need Help?</h2>
    <p>Visit our <a href="{{supportUrl}}" style="color: #0066cc;">support page</a> or reply to this email.</p>

    <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;" />

    <p style="font-size: 12px; color: #888;">
      You're receiving this email because you subscribed to Ptah Premium.<br />
      Email: {{email}}<br />
      <a href="https://ptah.dev/unsubscribe?email={{email}}" style="color: #888;">Unsubscribe</a>
    </p>
  </body>
</html>
```

---

## 🚀 Deployment Configuration

### Dockerfile

```dockerfile
# Multi-stage build for production
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy node_modules and built files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run application
CMD ["node", "dist/main.js"]
```

### docker-compose.yml (Local Development)

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/ptah_licenses
      - PAYMOB_SECRET_KEY=your_paymob_secret
      - EMAIL_PROVIDER=sendgrid
      - EMAIL_API_KEY=your_sendgrid_api_key
    depends_on:
      - db
    volumes:
      - ./src:/app/src
    command: npm run start:dev

  db:
    image: postgres:15-alpine
    ports:
      - '5432:5432'
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=ptah_licenses
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Environment Variables (.env.example)

```bash
# Server
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Paymob
PAYMOB_SECRET_KEY=your_paymob_hmac_secret

# Email
EMAIL_PROVIDER=sendgrid  # or 'resend'
EMAIL_API_KEY=your_email_api_key

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

---

## ✅ Verification Plan

### Automated Tests

#### 1. Unit Tests

**Test File**: `src/licenses/licenses.service.spec.ts`

```typescript
describe('LicensesService', () => {
  it('should return valid=true for active premium license', async () => {
    // Test valid license key verification
  });

  it('should return valid=false for non-existent license', async () => {
    // Test invalid license key handling
  });

  it('should return valid=false for revoked license', async () => {
    // Test revoked license status
  });

  it('should return valid=false for expired subscription', async () => {
    // Test subscription expiration logic
  });
});
```

**Run Command**:

```bash
npm run test -- licenses.service.spec.ts
```

#### 2. E2E Tests

**Test File**: `test/app.e2e-spec.ts`

```typescript
describe('License Server E2E', () => {
  it('POST /api/v1/licenses/verify - valid license', () => {
    return request(app.getHttpServer())
      .post('/api/v1/licenses/verify')
      .send({ licenseKey: 'ptah_lic_a1b2c3d4e5f6789012345678901234' })
      .expect(200)
      .expect((res) => {
        expect(res.body.valid).toBe(true);
        expect(res.body.tier).toBe('premium');
      });
  });

  it('POST /api/v1/webhooks/paymob - valid signature', () => {
    const payload = { type: 'TRANSACTION', obj: { success: true } };
    const signature = generateHmac(payload);

    return request(app.getHttpServer()).post('/api/v1/webhooks/paymob').set('x-paymob-signature', signature).send(payload).expect(200);
  });

  it('POST /api/v1/webhooks/paymob - invalid signature', () => {
    return request(app.getHttpServer()).post('/api/v1/webhooks/paymob').set('x-paymob-signature', 'invalid_signature').send({ type: 'TRANSACTION', obj: {} }).expect(401);
  });
});
```

**Run Command**:

```bash
npm run test:e2e
```

#### 3. Database Migration Tests

**Test Command**:

```bash
npm run typeorm:migration:run
npm run typeorm:migration:revert
```

**Verification**:

- Confirm 3 tables created: `users`, `subscriptions`, `licenses`
- Verify foreign key constraints (DELETE CASCADE)
- Check unique constraints on `email`, `licenseKey`, `paymobSubscriptionId`
- Verify indexes created (`idx_license_key`)

---

### Manual Verification

#### 1. License Verification Endpoint

**Test with cURL**:

```bash
# Valid license (create test data first)
curl -X POST http://localhost:3000/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"ptah_lic_test12345678901234567890123"}'

# Expected: {"valid":true,"tier":"premium","email":"test@example.com","expiresAt":"2026-01-01T00:00:00Z"}

# Invalid license
curl -X POST http://localhost:3000/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"ptah_lic_invalid000000000000000000000"}'

# Expected: {"valid":false,"tier":"free"}

# Malformed license key
curl -X POST http://localhost:3000/api/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"invalid_format"}'

# Expected: 400 Bad Request with validation error
```

#### 2. Paymob Webhook Endpoint

**Test with Paymob Sandbox**:

1. Configure Paymob webhook URL: `https://your-server.com/api/v1/webhooks/paymob`
2. Trigger test payment in Paymob dashboard
3. Verify:
   - User created in database
   - Subscription created with status `active`
   - License key generated (format: `ptah_lic_{32-hex}`)
   - Email sent to user (check SendGrid/Resend dashboard)

**Manual cURL Test** (compute signature manually):

```bash
# Generate HMAC-SHA256 signature
PAYLOAD='{"type":"TRANSACTION","obj":{"success":true,"billing_data":{"email":"test@example.com"},"subscription_id":"sub_test123"}}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your_paymob_secret" | awk '{print $2}')

# Send webhook
curl -X POST http://localhost:3000/api/v1/webhooks/paymob \
  -H "Content-Type: application/json" \
  -H "x-paymob-signature: $SIGNATURE" \
  -d "$PAYLOAD"

# Expected: {"received":true}
```

#### 3. Email Delivery

**Verification Steps**:

1. Trigger webhook (see above)
2. Check SendGrid/Resend dashboard for email delivery status
3. Verify email content:
   - Subject: "Your Ptah Premium License Key"
   - From: "noreply@ptah.dev"
   - Body includes license key, activation instructions, support link
4. Test retry logic by temporarily disabling email API key (should see 3 retry attempts in logs)

#### 4. Database Integrity

**Manual SQL Checks**:

```sql
-- Verify 3 tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public';

-- Check foreign key constraints
SELECT * FROM users WHERE id = 'some-user-id';
DELETE FROM users WHERE id = 'some-user-id'; -- Should cascade delete subscriptions + licenses

-- Verify unique constraints
INSERT INTO users (email) VALUES ('existing@example.com'); -- Should fail with unique constraint error
INSERT INTO licenses (user_id, license_key) VALUES ('user-id', 'duplicate-key'); -- Should fail
```

#### 5. Performance Testing

**Load Test with Apache Bench**:

```bash
# License verification endpoint (target: 100 req/sec)
ab -n 1000 -c 10 -p verify.json -T application/json \
  http://localhost:3000/api/v1/licenses/verify

# Check p95 latency (<200ms requirement)
```

**Verify Resource Usage**:

```bash
# Monitor memory (<256MB requirement)
docker stats ptah-license-server

# Check CPU usage (<60% under load requirement)
```

---

## 📦 Dependencies (package.json)

```json
{
  "name": "ptah-license-server",
  "version": "1.0.0",
  "description": "Minimal NestJS license server for Ptah premium subscriptions",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "typeorm": "typeorm-ts-node-commonjs",
    "typeorm:migration:generate": "npm run typeorm -- migration:generate",
    "typeorm:migration:run": "npm run typeorm -- migration:run",
    "typeorm:migration:revert": "npm run typeorm -- migration:revert"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/typeorm": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "@sendgrid/mail": "^8.0.0",
    "resend": "^3.0.0",
    "handlebars": "^4.7.8",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.1",
    "typeorm": "^0.3.17",
    "pg": "^8.11.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@types/supertest": "^6.0.0",
    "jest": "^29.5.0",
    "supertest": "^6.3.3",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.1",
    "typescript": "^5.1.3"
  }
}
```

---

## 🎯 Team-Leader Handoff

### Implementation Complexity: **Medium**

- **Developer Type**: backend-developer
- **Estimated Tasks**: 8-10 atomic tasks
- **Total Effort**: 16-24 hours (2-3 days)

### Batch Strategy: **Layer-based**

**Batch 1: Project Setup + Database** (Day 1)

- Task 1.1: Initialize NestJS project, install dependencies
- Task 1.2: Create TypeORM entities (User, Subscription, License)
- Task 1.3: Create database migration, test schema

**Batch 2: License Verification API** (Day 1-2)

- Task 2.1: Implement licenses module (controller, service, DTOs)
- Task 2.2: Write unit tests for LicensesService
- Task 2.3: Write E2E test for /api/v1/licenses/verify

**Batch 3: Paymob Webhook Integration** (Day 2)

- Task 3.1: Implement HMAC signature guard
- Task 3.2: Implement webhooks module (controller, service)
- Task 3.3: Implement license key generator service
- Task 3.4: Write E2E test for /api/v1/webhooks/paymob

**Batch 4: Email Service** (Day 2-3)

- Task 4.1: Implement email service with SendGrid/Resend
- Task 4.2: Create Handlebars email template
- Task 4.3: Test email delivery with retry logic

**Batch 5: Deployment** (Day 3)

- Task 5.1: Create Dockerfile and docker-compose.yml
- Task 5.2: Configure environment variables and health check
- Task 5.3: Deploy to DigitalOcean App Platform, test production

### Critical Path

Database setup → License verification → Paymob webhooks → Email delivery → Deployment

### Quality Gates

- All unit tests passing
- E2E tests covering both endpoints
- Manual cURL verification successful
- Performance targets met (<200ms p95 latency)
- Email delivery confirmed

---

## 📊 Success Metrics

**Technical Metrics**:

- License verification latency: <200ms (p95) ✅
- Webhook processing time: <5s end-to-end ✅
- Email delivery success rate: >99% ✅
- Database query latency: <10ms (p99) ✅

**Business Metrics**:

- Infrastructure cost: <$50/month ✅
- Deployment time: <10 minutes (Docker) ✅
- Zero critical bugs in production first 2 weeks ✅

---

## 🚨 Risk Mitigation

**Risk 1: Paymob Signature Verification**

- Mitigation: Test with Paymob sandbox before production
- Contingency: Manual license generation interface for first 100 users

**Risk 2: Email Delivery Failures**

- Mitigation: Retry logic (3 attempts, exponential backoff)
- Contingency: Display license key in Paymob success page

**Risk 3: Database Connection Pool**

- Mitigation: TypeORM pool config (max=10, min=2)
- Contingency: Vertical scaling (DigitalOcean droplet resize)

---

**Architecture Review Complete**. Ready for team-leader task decomposition.
