# 🏗️ Ptah License Server: NestJS + WorkOS + Paymob + DigitalOcean

**Date**: 2025-12-04
**Strategy**: Accelerated 8-Week Launch (Launch Fast!)
**Tech Stack**: NestJS + WorkOS + Paymob + PostgreSQL + DigitalOcean

---

## 🎯 Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    VS CODE EXTENSION                         │
│                      (Ptah Client)                           │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               LICENSE SERVER (NestJS)                        │
│          Hosted on DigitalOcean App Platform                │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Authentication & Authorization (WorkOS)            │    │
│  │  • User sign-up / sign-in                           │    │
│  │  • OAuth token storage                              │    │
│  │  • JWT issuance                                     │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Subscription Management (Paymob)                   │    │
│  │  • Create subscriptions                             │    │
│  │  • Handle webhooks                                  │    │
│  │  • Update license tiers                             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  License Verification                               │    │
│  │  • Verify premium status                            │    │
│  │  • Feature entitlements                             │    │
│  │  • Device management (max 3)                        │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  OAuth Token Vault (AES-256-GCM)                    │    │
│  │  • Store Claude OAuth tokens (encrypted)            │    │
│  │  • Decrypt for SDK adapter                          │    │
│  │  • Automatic rotation                               │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL Database                             │
│           (DigitalOcean Managed Database)                   │
│                                                               │
│  Tables:                                                     │
│  • users                                                     │
│  • subscriptions                                             │
│  • licenses                                                  │
│  • oauth_tokens (encrypted)                                 │
│  • devices                                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema

### PostgreSQL Tables

```sql
-- Users table (managed by WorkOS)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id VARCHAR(255) UNIQUE NOT NULL, -- WorkOS user ID
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Subscriptions table (synced with Paymob)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paymob_subscription_id VARCHAR(255) UNIQUE, -- Paymob subscription ID
  tier VARCHAR(50) NOT NULL DEFAULT 'free', -- 'free', 'premium', 'team'
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'canceled', 'past_due'
  billing_cycle VARCHAR(50), -- 'monthly', 'yearly'
  amount_cents INTEGER, -- Price in cents (800 = $8.00)
  currency VARCHAR(10) DEFAULT 'USD',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  canceled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- Licenses table (JWT tokens issued to VS Code extension)
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  token_hash VARCHAR(255) UNIQUE NOT NULL, -- SHA-256 hash of JWT
  features JSONB NOT NULL DEFAULT '[]', -- ['session_forking', 'structured_outputs', ...]
  issued_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  last_verified_at TIMESTAMP,
  device_id VARCHAR(255), -- VS Code machine ID
  device_name VARCHAR(255), -- Device name (OS + hostname)
  revoked_at TIMESTAMP
);

CREATE INDEX idx_licenses_user_id ON licenses(user_id);
CREATE INDEX idx_licenses_token_hash ON licenses(token_hash);
CREATE INDEX idx_licenses_device_id ON licenses(device_id);

-- OAuth tokens table (encrypted Claude tokens)
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL, -- AES-256-GCM encrypted
  iv VARCHAR(255) NOT NULL, -- Initialization vector (base64)
  auth_tag VARCHAR(255) NOT NULL, -- Authentication tag (base64)
  token_type VARCHAR(50) DEFAULT 'claude_oauth', -- Future: support other providers
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_oauth_tokens_user_id ON oauth_tokens(user_id);

-- Devices table (track user devices for license limits)
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL, -- VS Code machine ID
  device_name VARCHAR(255),
  os_type VARCHAR(50), -- 'Windows', 'macOS', 'Linux'
  os_version VARCHAR(100),
  vscode_version VARCHAR(50),
  extension_version VARCHAR(50),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  deactivated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_devices_user_device ON devices(user_id, device_id) WHERE deactivated_at IS NULL;
CREATE INDEX idx_devices_user_id ON devices(user_id);

-- Audit log (for security & compliance)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL, -- 'license_verified', 'token_stored', 'subscription_created'
  resource_type VARCHAR(100), -- 'license', 'subscription', 'oauth_token'
  resource_id UUID,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

---

## 🏛️ NestJS Project Structure

```
ptah-license-server/
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root module
│   │
│   ├── auth/                            # WorkOS authentication
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts           # Sign-up, sign-in endpoints
│   │   ├── auth.service.ts              # WorkOS SDK wrapper
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts        # JWT authentication guard
│   │   └── strategies/
│   │       └── jwt.strategy.ts          # Passport JWT strategy
│   │
│   ├── subscriptions/                   # Paymob subscriptions
│   │   ├── subscriptions.module.ts
│   │   ├── subscriptions.controller.ts  # Create, cancel endpoints
│   │   ├── subscriptions.service.ts     # Paymob SDK wrapper
│   │   ├── webhooks.controller.ts       # Paymob webhooks
│   │   └── dto/
│   │       ├── create-subscription.dto.ts
│   │       └── subscription-webhook.dto.ts
│   │
│   ├── licenses/                        # License verification
│   │   ├── licenses.module.ts
│   │   ├── licenses.controller.ts       # Verify, issue endpoints
│   │   ├── licenses.service.ts          # JWT issuance, verification
│   │   └── dto/
│   │       ├── verify-license.dto.ts
│   │       └── license-response.dto.ts
│   │
│   ├── oauth-tokens/                    # OAuth token vault
│   │   ├── oauth-tokens.module.ts
│   │   ├── oauth-tokens.controller.ts   # Store, retrieve endpoints
│   │   ├── oauth-tokens.service.ts      # AES-256-GCM encryption
│   │   ├── token-vault.ts               # Encryption/decryption logic
│   │   └── dto/
│   │       ├── store-token.dto.ts
│   │       └── retrieve-token.dto.ts
│   │
│   ├── devices/                         # Device management
│   │   ├── devices.module.ts
│   │   ├── devices.controller.ts        # Register, list, deactivate
│   │   ├── devices.service.ts           # Device tracking (max 3)
│   │   └── dto/
│   │       └── register-device.dto.ts
│   │
│   ├── users/                           # User management
│   │   ├── users.module.ts
│   │   ├── users.controller.ts          # Profile, settings
│   │   ├── users.service.ts
│   │   └── entities/
│   │       └── user.entity.ts
│   │
│   ├── audit/                           # Audit logging
│   │   ├── audit.module.ts
│   │   ├── audit.service.ts
│   │   └── entities/
│   │       └── audit-log.entity.ts
│   │
│   ├── database/                        # Database configuration
│   │   ├── database.module.ts
│   │   └── migrations/                  # TypeORM migrations
│   │
│   ├── config/                          # Configuration
│   │   ├── configuration.ts             # Environment variables
│   │   └── validation.ts                # Config validation schema
│   │
│   └── common/                          # Shared utilities
│       ├── decorators/
│       │   └── premium-only.decorator.ts
│       ├── filters/
│       │   └── http-exception.filter.ts
│       ├── interceptors/
│       │   └── logging.interceptor.ts
│       └── types/
│           └── subscription-tier.enum.ts
│
├── test/                                # E2E tests
├── .env.example                         # Environment template
├── .env                                 # Local environment (gitignored)
├── nest-cli.json                        # NestJS configuration
├── package.json
├── tsconfig.json
└── docker-compose.yml                   # Local PostgreSQL
```

---

## 🔌 API Endpoints

### 1. Authentication (WorkOS)

#### POST `/api/v1/auth/signup`

**Description**: Create new user account via WorkOS
**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response**:

```json
{
  "userId": "user_01J4...",
  "email": "user@example.com",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### POST `/api/v1/auth/signin`

**Description**: Sign in existing user
**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response**:

```json
{
  "userId": "user_01J4...",
  "email": "user@example.com",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "subscription": {
    "tier": "free",
    "status": "active"
  }
}
```

#### GET `/api/v1/auth/me`

**Description**: Get current user profile
**Headers**: `Authorization: Bearer <jwt>`

**Response**:

```json
{
  "userId": "user_01J4...",
  "email": "user@example.com",
  "name": "John Doe",
  "subscription": {
    "tier": "premium",
    "status": "active",
    "currentPeriodEnd": "2025-12-31T23:59:59Z"
  }
}
```

---

### 2. Subscriptions (Paymob)

#### POST `/api/v1/subscriptions`

**Description**: Create new subscription (redirects to Paymob checkout)
**Headers**: `Authorization: Bearer <jwt>`
**Request Body**:

```json
{
  "tier": "premium",
  "billingCycle": "monthly",
  "successUrl": "https://ptah.dev/success",
  "cancelUrl": "https://ptah.dev/cancel"
}
```

**Response**:

```json
{
  "subscriptionId": "sub_abc123",
  "checkoutUrl": "https://accept.paymob.com/iframe/abc123",
  "status": "pending_payment"
}
```

#### POST `/api/v1/subscriptions/webhooks` (Paymob Webhook)

**Description**: Handle Paymob subscription events
**Headers**: `X-Paymob-Signature: <hmac_signature>`
**Request Body** (example: subscription created):

```json
{
  "type": "TRANSACTION",
  "obj": {
    "id": 12345,
    "success": true,
    "subscription_id": "sub_abc123",
    "amount_cents": 800,
    "currency": "USD"
  }
}
```

**Response**: `200 OK`

#### DELETE `/api/v1/subscriptions/:subscriptionId`

**Description**: Cancel subscription
**Headers**: `Authorization: Bearer <jwt>`

**Response**:

```json
{
  "subscriptionId": "sub_abc123",
  "status": "canceled",
  "canceledAt": "2025-12-04T12:00:00Z",
  "accessUntil": "2025-12-31T23:59:59Z"
}
```

---

### 3. Licenses (JWT Verification)

#### GET `/api/v1/licenses/verify`

**Description**: Verify premium license and get features
**Headers**: `Authorization: Bearer <jwt>`

**Response**:

```json
{
  "userId": "user_01J4...",
  "subscription": {
    "tier": "premium",
    "status": "active"
  },
  "features": ["session_forking", "structured_outputs", "custom_tools", "dynamic_permissions"],
  "expiresAt": "2025-12-31T23:59:59Z",
  "devicesUsed": 2,
  "devicesLimit": 3
}
```

#### POST `/api/v1/licenses/issue`

**Description**: Issue new license JWT for device
**Headers**: `Authorization: Bearer <jwt>`
**Request Body**:

```json
{
  "deviceId": "vscode-machine-id-abc123",
  "deviceName": "MacBook Pro (macOS 14.2)",
  "osType": "macOS",
  "vscodeVersion": "1.95.0",
  "extensionVersion": "1.0.0"
}
```

**Response**:

```json
{
  "licenseToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-12-31T23:59:59Z",
  "features": ["session_forking", "structured_outputs", "custom_tools"]
}
```

---

### 4. OAuth Tokens (Encrypted Vault)

#### POST `/api/v1/oauth-tokens`

**Description**: Store Claude OAuth token (encrypted)
**Headers**: `Authorization: Bearer <jwt>`
**Request Body**:

```json
{
  "claudeOAuthToken": "claude_oauth_abc123...",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

**Response**:

```json
{
  "success": true,
  "message": "OAuth token stored securely"
}
```

#### GET `/api/v1/oauth-tokens`

**Description**: Retrieve decrypted OAuth token
**Headers**: `Authorization: Bearer <jwt>`

**Response**:

```json
{
  "token": "claude_oauth_abc123...",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

#### DELETE `/api/v1/oauth-tokens`

**Description**: Delete OAuth token
**Headers**: `Authorization: Bearer <jwt>`

**Response**:

```json
{
  "success": true,
  "message": "OAuth token deleted"
}
```

---

### 5. Devices

#### GET `/api/v1/devices`

**Description**: List user's registered devices
**Headers**: `Authorization: Bearer <jwt>`

**Response**:

```json
{
  "devices": [
    {
      "deviceId": "vscode-machine-id-abc123",
      "deviceName": "MacBook Pro (macOS 14.2)",
      "osType": "macOS",
      "lastSeenAt": "2025-12-04T12:00:00Z",
      "active": true
    },
    {
      "deviceId": "vscode-machine-id-def456",
      "deviceName": "Windows Desktop",
      "osType": "Windows",
      "lastSeenAt": "2025-12-03T10:00:00Z",
      "active": true
    }
  ],
  "devicesUsed": 2,
  "devicesLimit": 3
}
```

#### DELETE `/api/v1/devices/:deviceId`

**Description**: Deactivate device
**Headers**: `Authorization: Bearer <jwt>`

**Response**:

```json
{
  "success": true,
  "message": "Device deactivated",
  "devicesUsed": 1,
  "devicesLimit": 3
}
```

---

## 🔐 Security Implementation

### 1. WorkOS Authentication

**File**: `src/auth/auth.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { WorkOS } from '@workos-inc/node';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  private workos: WorkOS;

  constructor(private jwtService: JwtService, private usersService: UsersService) {
    this.workos = new WorkOS(process.env.WORKOS_API_KEY);
  }

  async signUp(email: string, password: string, name: string) {
    // Create user in WorkOS
    const workosUser = await this.workos.userManagement.createUser({
      email,
      password,
      firstName: name.split(' ')[0],
      lastName: name.split(' ')[1] || '',
    });

    // Create user in our database
    const user = await this.usersService.create({
      workosUserId: workosUser.id,
      email: workosUser.email,
      name,
    });

    // Issue JWT
    const accessToken = this.jwtService.sign({
      userId: user.id,
      email: user.email,
      workosUserId: workosUser.id,
    });

    return {
      userId: user.id,
      email: user.email,
      accessToken,
    };
  }

  async signIn(email: string, password: string) {
    // Authenticate with WorkOS
    const authResponse = await this.workos.userManagement.authenticateWithPassword({
      email,
      password,
      clientId: process.env.WORKOS_CLIENT_ID,
    });

    // Get user from database
    const user = await this.usersService.findByWorkosId(authResponse.user.id);
    if (!user) {
      throw new Error('User not found');
    }

    // Issue JWT
    const accessToken = this.jwtService.sign({
      userId: user.id,
      email: user.email,
      workosUserId: authResponse.user.id,
    });

    // Get subscription
    const subscription = await this.usersService.getSubscription(user.id);

    return {
      userId: user.id,
      email: user.email,
      accessToken,
      subscription,
    };
  }

  async validateUser(userId: string): Promise<any> {
    return this.usersService.findById(userId);
  }
}
```

---

### 2. OAuth Token Encryption

**File**: `src/oauth-tokens/token-vault.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class TokenVault {
  private readonly algorithm = 'aes-256-gcm';
  private readonly masterKey: Buffer;

  constructor() {
    // Master key from environment (32 bytes for AES-256)
    const masterKeyHex = process.env.ENCRYPTION_MASTER_KEY;
    if (!masterKeyHex || masterKeyHex.length !== 64) {
      throw new Error('ENCRYPTION_MASTER_KEY must be 64 hex characters (32 bytes)');
    }
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
  }

  /**
   * Encrypt OAuth token
   */
  encrypt(token: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.masterKey, iv);

    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  /**
   * Decrypt OAuth token
   */
  decrypt(encrypted: string, iv: string, authTag: string): string {
    const decipher = createDecipheriv(this.algorithm, this.masterKey, Buffer.from(iv, 'base64'));

    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);

    return decrypted.toString('utf8');
  }
}
```

**File**: `src/oauth-tokens/oauth-tokens.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OAuthToken } from './entities/oauth-token.entity';
import { TokenVault } from './token-vault';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OAuthTokensService {
  constructor(
    @InjectRepository(OAuthToken)
    private oauthTokensRepository: Repository<OAuthToken>,
    private tokenVault: TokenVault,
    private auditService: AuditService
  ) {}

  async storeToken(userId: string, claudeOAuthToken: string, expiresAt?: Date): Promise<void> {
    // Encrypt token
    const { encrypted, iv, authTag } = this.tokenVault.encrypt(claudeOAuthToken);

    // Store in database
    await this.oauthTokensRepository.upsert(
      {
        userId,
        encryptedToken: encrypted,
        iv,
        authTag,
        tokenType: 'claude_oauth',
        expiresAt,
      },
      ['userId']
    );

    // Audit log
    await this.auditService.log({
      userId,
      action: 'oauth_token_stored',
      resourceType: 'oauth_token',
      resourceId: userId,
    });
  }

  async retrieveToken(userId: string): Promise<string | null> {
    const record = await this.oauthTokensRepository.findOne({
      where: { userId },
    });

    if (!record) {
      return null;
    }

    // Check expiry
    if (record.expiresAt && record.expiresAt < new Date()) {
      return null;
    }

    // Decrypt token
    const decrypted = this.tokenVault.decrypt(record.encryptedToken, record.iv, record.authTag);

    // Audit log
    await this.auditService.log({
      userId,
      action: 'oauth_token_retrieved',
      resourceType: 'oauth_token',
      resourceId: userId,
    });

    return decrypted;
  }

  async deleteToken(userId: string): Promise<void> {
    await this.oauthTokensRepository.delete({ userId });

    // Audit log
    await this.auditService.log({
      userId,
      action: 'oauth_token_deleted',
      resourceType: 'oauth_token',
      resourceId: userId,
    });
  }
}
```

---

### 3. Paymob Subscription Webhooks

**File**: `src/subscriptions/webhooks.controller.ts`

```typescript
import { Controller, Post, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { createHmac } from 'crypto';

@Controller('api/v1/subscriptions/webhooks')
export class WebhooksController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handlePaymobWebhook(@Body() payload: any, @Headers('x-paymob-signature') signature: string) {
    // Verify webhook signature
    this.verifySignature(payload, signature);

    // Handle different event types
    if (payload.type === 'TRANSACTION' && payload.obj.success) {
      await this.handleSuccessfulPayment(payload.obj);
    } else if (payload.type === 'SUBSCRIPTION_CANCELED') {
      await this.handleSubscriptionCanceled(payload.obj);
    }

    return { received: true };
  }

  private verifySignature(payload: any, signature: string) {
    const secret = process.env.PAYMOB_HMAC_SECRET;
    const computed = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');

    if (computed !== signature) {
      throw new Error('Invalid webhook signature');
    }
  }

  private async handleSuccessfulPayment(transaction: any) {
    // Get subscription ID
    const subscriptionId = transaction.subscription_id;

    // Update subscription status in database
    await this.subscriptionsService.updateStatus(subscriptionId, 'active', transaction);

    // Upgrade user's license
    await this.subscriptionsService.upgradeLicense(subscriptionId);
  }

  private async handleSubscriptionCanceled(subscription: any) {
    // Update subscription status
    await this.subscriptionsService.updateStatus(subscription.id, 'canceled', subscription);

    // Downgrade user's license (grace period until period end)
    await this.subscriptionsService.scheduleLicenseDowngrade(subscription.id);
  }
}
```

---

## 🚀 DigitalOcean Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              DigitalOcean App Platform                       │
│          (Managed NestJS Application Hosting)               │
│                                                               │
│  • Auto-scaling (1-3 instances)                             │
│  • HTTPS with automatic SSL                                 │
│  • Environment variables (secrets)                          │
│  • GitHub auto-deploy on push                               │
│  • Health checks & monitoring                               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         DigitalOcean Managed PostgreSQL Database            │
│                                                               │
│  • Automatic backups (daily)                                │
│  • Connection pooling                                       │
│  • Read replicas (if needed)                                │
│  • Encrypted at rest                                        │
└─────────────────────────────────────────────────────────────┘
```

### App Platform Configuration

**File**: `.do/app.yaml`

```yaml
name: ptah-license-server
region: nyc
services:
  - name: api
    github:
      repo: your-username/ptah-license-server
      branch: main
      deploy_on_push: true
    build_command: npm run build
    run_command: npm run start:prod
    environment_slug: node-js
    instance_count: 1
    instance_size_slug: basic-xs # $5/month
    http_port: 3000
    health_check:
      http_path: /health
    envs:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: '3000'
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
      - key: WORKOS_API_KEY
        value: ${WORKOS_API_KEY}
        type: SECRET
      - key: WORKOS_CLIENT_ID
        value: ${WORKOS_CLIENT_ID}
        type: SECRET
      - key: PAYMOB_API_KEY
        value: ${PAYMOB_API_KEY}
        type: SECRET
      - key: PAYMOB_HMAC_SECRET
        value: ${PAYMOB_HMAC_SECRET}
        type: SECRET
      - key: ENCRYPTION_MASTER_KEY
        value: ${ENCRYPTION_MASTER_KEY}
        type: SECRET
      - key: JWT_SECRET
        value: ${JWT_SECRET}
        type: SECRET

databases:
  - name: db
    engine: PG
    version: '15'
    size: db-s-1vcpu-1gb # $15/month
    num_nodes: 1
```

### Deployment Steps

1. **Create DigitalOcean Account**

   - Sign up at https://cloud.digitalocean.com
   - Add payment method

2. **Create App**

   ```bash
   # Install doctl CLI
   brew install doctl # macOS
   # OR
   snap install doctl # Linux

   # Authenticate
   doctl auth init

   # Create app from config
   doctl apps create --spec .do/app.yaml
   ```

3. **Set Environment Variables**

   ```bash
   # Generate encryption master key (32 bytes = 64 hex chars)
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

   # Generate JWT secret
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

   # Set secrets in DigitalOcean dashboard
   # Or via CLI:
   doctl apps update <app-id> --env "ENCRYPTION_MASTER_KEY=<key>"
   ```

4. **Connect GitHub**

   - In DigitalOcean dashboard, go to Apps → Your App → Settings
   - Connect GitHub repository
   - Enable auto-deploy on push to main branch

5. **Run Migrations**

   ```bash
   # SSH into app container
   doctl apps logs <app-id>

   # Or run migration via NestJS CLI
   npm run migration:run
   ```

---

## 📦 Environment Variables

**File**: `.env.example`

```bash
# Application
NODE_ENV=development
PORT=3000

# Database (provided by DigitalOcean)
DATABASE_URL=postgresql://username:password@host:25060/database?sslmode=require

# WorkOS Authentication
WORKOS_API_KEY=sk_live_...
WORKOS_CLIENT_ID=client_...

# Paymob Subscriptions
PAYMOB_API_KEY=ZXlKaGJHY2lPaUpJVXpVeE1pSXN...
PAYMOB_HMAC_SECRET=your_hmac_secret

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_MASTER_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# JWT Secret (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=your_jwt_secret_here

# CORS (VS Code extension origin)
CORS_ORIGIN=vscode-webview://,http://localhost:4200

# Rate Limiting
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100
```

---

## 🧪 Testing

### Unit Tests

```bash
npm run test
```

### E2E Tests

**File**: `test/auth.e2e-spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AuthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('/api/v1/auth/signup (POST)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: 'test@example.com',
        password: 'SecurePassword123!',
        name: 'Test User',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('userId');
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
```

---

## 📊 Monitoring & Observability

### DigitalOcean Monitoring

- **Application Metrics**: CPU, memory, request count
- **Database Metrics**: Connections, query latency
- **Alerts**: Email/Slack notifications for:
  - CPU > 80%
  - Memory > 80%
  - Error rate > 5%

### Audit Logging

All sensitive operations are logged:

- License verifications
- OAuth token storage/retrieval
- Subscription changes
- Device registrations

**Query audit logs**:

```sql
SELECT * FROM audit_logs
WHERE user_id = 'user_01J4...'
ORDER BY created_at DESC
LIMIT 50;
```

---

## 💰 Cost Estimate (DigitalOcean)

| Service          | Plan               | Monthly Cost  |
| ---------------- | ------------------ | ------------- |
| **App Platform** | Basic (1 instance) | $5            |
| **PostgreSQL**   | 1GB RAM, 1 vCPU    | $15           |
| **Bandwidth**    | First 1TB free     | $0            |
| **Backups**      | Daily (included)   | $0            |
| **Total**        |                    | **$20/month** |

**Scaling costs** (as you grow):

- **10K users**: Same ($20/month)
- **50K users**: Add 1 app instance ($5) + upgrade DB ($30) = **$40/month**
- **100K users**: 3 app instances ($15) + 4GB DB ($60) = **$75/month**

**Break-even**: At ~3 paying users ($8 × 3 = $24), you cover infrastructure costs!

---

## ✅ Next Steps (Week-by-Week)

### Week 1: NestJS Boilerplate

- ✅ Initialize NestJS project
- ✅ Set up PostgreSQL (docker-compose for local)
- ✅ Create database schema (TypeORM entities)
- ✅ Configure WorkOS authentication

### Week 2: Core APIs

- ✅ Implement auth endpoints (signup, signin)
- ✅ Implement license verification
- ✅ Implement OAuth token vault (encryption)
- ✅ Add device management

### Week 3: Paymob Integration

- ✅ Implement subscription creation
- ✅ Set up webhook handler
- ✅ Test subscription lifecycle (create, pay, cancel)

### Week 4: DigitalOcean Deployment

- ✅ Create `.do/app.yaml` config
- ✅ Deploy to DigitalOcean App Platform
- ✅ Set up managed PostgreSQL
- ✅ Run migrations in production

### Weeks 5-8: Extension Integration (next document)

- Premium feature gates
- SDK adapter with OAuth proxy
- UI for upgrade flow
- Beta testing

---

**Document Status**: Ready for implementation
**Estimated Setup Time**: 1 week (for experienced NestJS developer)
**Infrastructure Cost**: $20/month (scales to $75/month at 100K users)
