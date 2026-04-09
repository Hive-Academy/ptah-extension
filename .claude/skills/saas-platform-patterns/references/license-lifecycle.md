# License Lifecycle

## Overview

Licenses are the bridge between your payment system and your application. A license key proves a user has paid for a specific plan. This reference covers key generation, the Prisma data model, the license status machine, the public verification endpoint, caching, and provisioning flows triggered by subscription events.

## License Key Generation

### Format and Entropy

Generate cryptographically secure keys with 256-bit entropy. Use a prefix to make keys human-identifiable and greppable in logs.

```typescript
import { randomBytes } from 'crypto';

/** Generate a license key: prefix + 64 hex characters (256-bit) */
function generateLicenseKey(prefix = 'lic'): string {
  return `${prefix}_${randomBytes(32).toString('hex')}`;
}

// Example output: lic_a3f8b2c1d4e5f6071829a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b
```

**Design decisions:**

| Decision             | Rationale                                                            |
| -------------------- | -------------------------------------------------------------------- |
| `crypto.randomBytes` | Cryptographically secure, not predictable like `Math.random` or UUID |
| 256-bit (32 bytes)   | Brute-force infeasible -- 2^256 possible keys                        |
| Hex encoding         | URL-safe, easy to copy/paste, no special characters                  |
| Prefix (`lic_`)      | Distinguishes license keys from API keys, tokens, etc. in logs       |
| No checksum/Luhn     | Validation happens server-side, not client-side                      |

### Key Format Variations

Adapt the prefix to your product:

```typescript
// Per-product prefix
const key = generateLicenseKey('ptah'); // ptah_a3f8b2c1...
const key = generateLicenseKey('myapp'); // myapp_a3f8b2c1...

// Per-tier prefix (useful for quick log identification)
const key = generateLicenseKey('pro'); // pro_a3f8b2c1...
const key = generateLicenseKey('ent'); // ent_a3f8b2c1...
```

## Prisma Schema

```prisma
model License {
  id         String    @id @default(uuid())
  userId     String
  licenseKey String    @unique
  plan       String    // community | pro | enterprise | trial_pro | trial_enterprise
  status     String    @default("active") // active | expired | revoked | paused
  expiresAt  DateTime?
  createdBy  String    // admin | system | webhook_{eventId} | trial_start | trial_expired
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
}
```

**Field notes:**

- `plan`: Stores the plan slug. Trial plans use `trial_` prefix (`trial_pro`).
- `status`: One of four values, managed by the status machine below.
- `expiresAt`: Null for non-expiring licenses (e.g., lifetime deals). Set for subscription-based and trial licenses.
- `createdBy`: Audit trail -- tracks who/what created the license. Format: `admin`, `system`, `webhook_{eventId}`, `trial_start`.

## License Status Machine

```
                     +-----------+
       create        |           |
    +--------------->|  active   |
    |                |           |
    |                +-----+-----+
    |                      |
    |           +----------+----------+----------+
    |           |          |          |          |
    |           v          v          v          v
    |     +---------+ +---------+ +---------+
    |     | expired | | revoked | | paused  |
    |     +---------+ +---------+ +---------+
    |           |                      |
    |           |                      |
    |           v                      v
    |     +---------+            +---------+
    |     | active  | (renew)    | active  | (resume)
    |     +---------+            +---------+
    |
    |  (new license replaces old)
    +--- Old license: active --> revoked
```

### Transition Rules

| From    | To      | Trigger                                 | Notes                                        |
| ------- | ------- | --------------------------------------- | -------------------------------------------- |
| (none)  | active  | New subscription, admin grant           | Initial creation                             |
| active  | expired | Subscription period ends, trial expires | Time-based, checked by cron or webhook       |
| active  | revoked | New license issued, admin action        | Old license replaced by new one              |
| active  | paused  | Subscription paused                     | Payment provider pause event                 |
| paused  | active  | Subscription resumed                    | Payment provider resume event                |
| expired | active  | Renewal, resubscription                 | New license created, or existing reactivated |

### Implementation

```typescript
// src/services/license.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';
import { getPlanDefinition } from '../config/plans.config';

@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new active license, revoking any previous active licenses.
   * Returns the new license key.
   */
  async createLicense(userId: string, plan: string, createdBy: string, expiresAt?: Date): Promise<string> {
    // Revoke all existing active licenses for this user
    const revoked = await this.prisma.license.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'revoked' },
    });

    if (revoked.count > 0) {
      this.logger.log(`Revoked ${revoked.count} existing license(s) for user ${userId}`);
    }

    const licenseKey = `lic_${randomBytes(32).toString('hex')}`;

    await this.prisma.license.create({
      data: {
        userId,
        licenseKey,
        plan,
        status: 'active',
        expiresAt: expiresAt ?? null,
        createdBy,
      },
    });

    this.logger.log(`License created: user=${userId} plan=${plan} createdBy=${createdBy}`);
    return licenseKey;
  }

  /** Transition license status with validation */
  async transitionStatus(licenseId: string, newStatus: string): Promise<void> {
    const license = await this.prisma.license.findUnique({ where: { id: licenseId } });

    if (!license) {
      throw new NotFoundException(`License ${licenseId} not found`);
    }

    const validTransitions: Record<string, string[]> = {
      active: ['expired', 'revoked', 'paused'],
      paused: ['active'],
      expired: ['active'],
    };

    const allowed = validTransitions[license.status] ?? [];

    if (!allowed.includes(newStatus)) {
      this.logger.warn(`Invalid license transition: ${license.status} -> ${newStatus} for license ${licenseId}`);
      return;
    }

    await this.prisma.license.update({
      where: { id: licenseId },
      data: { status: newStatus },
    });

    this.logger.log(`License ${licenseId} transitioned: ${license.status} -> ${newStatus}`);
  }

  /** Pause all active licenses for a user (subscription paused) */
  async pauseUserLicenses(userId: string): Promise<void> {
    await this.prisma.license.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'paused' },
    });
  }

  /** Resume all paused licenses for a user (subscription resumed) */
  async resumeUserLicenses(userId: string): Promise<void> {
    await this.prisma.license.updateMany({
      where: { userId, status: 'paused' },
      data: { status: 'active' },
    });
  }

  /** Set expiration on active licenses (subscription canceled with grace period) */
  async setExpiration(userId: string, expiresAt: Date): Promise<void> {
    await this.prisma.license.updateMany({
      where: { userId, status: 'active' },
      data: { expiresAt },
    });
  }
}
```

## Verification Endpoint

Public endpoint for license key verification. Called by client applications (desktop apps, CLI tools, VS Code extensions) to check license validity.

### Controller

```typescript
// src/controllers/license.controller.ts
import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LicenseVerificationService } from '../services/license-verification.service';

interface VerifyLicenseDto {
  licenseKey: string;
}

interface VerifyLicenseResponse {
  valid: boolean;
  plan: string;
  features: string[];
  expiresAt: string | null;
}

@Controller('licenses')
export class LicenseController {
  private readonly logger = new Logger(LicenseController.name);

  constructor(private readonly verificationService: LicenseVerificationService) {}

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // 10 requests per minute per IP
  async verify(@Body() dto: VerifyLicenseDto): Promise<VerifyLicenseResponse> {
    return this.verificationService.verify(dto.licenseKey);
  }
}
```

**Design decisions:**

| Decision                 | Rationale                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| POST (not GET)           | License key in body, not URL -- avoids logging keys in access logs                                              |
| No authentication        | Client apps call this without user tokens; the key itself is the credential                                     |
| Rate-limited (10/min/IP) | Prevents brute-force key guessing; 256-bit keys are infeasible to guess but rate limiting adds defense in depth |
| HttpCode(200) always     | Standardizes response; `valid: false` is not an error                                                           |

### Verification Service with Caching

```typescript
// src/services/license-verification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getPlanDefinition } from '../config/plans.config';

interface VerificationResult {
  valid: boolean;
  plan: string;
  features: string[];
  expiresAt: string | null;
}

@Injectable()
export class LicenseVerificationService {
  private readonly logger = new Logger(LicenseVerificationService.name);

  // In-memory cache: licenseKey -> { result, expiry }
  private readonly cache = new Map<string, { result: VerificationResult; expiry: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly prisma: PrismaService) {}

  async verify(licenseKey: string): Promise<VerificationResult> {
    // Check cache first
    const cached = this.cache.get(licenseKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.result;
    }

    // Query database
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
    });

    if (!license || license.status !== 'active') {
      const result = this.communityResult();
      this.cacheResult(licenseKey, result);
      return result;
    }

    // Check expiration
    if (license.expiresAt && license.expiresAt < new Date()) {
      // Expire the license
      await this.prisma.license.update({
        where: { id: license.id },
        data: { status: 'expired' },
      });

      const result = this.communityResult();
      this.cacheResult(licenseKey, result);
      return result;
    }

    // Resolve plan features
    const planSlug = license.plan.replace(/^trial_/, '');
    const plan = getPlanDefinition(planSlug);

    const result: VerificationResult = {
      valid: true,
      plan: license.plan,
      features: [...plan.features],
      expiresAt: license.expiresAt?.toISOString() ?? null,
    };

    this.cacheResult(licenseKey, result);
    return result;
  }

  /** Invalidate cache for a specific key (call after license changes) */
  invalidate(licenseKey: string): void {
    this.cache.delete(licenseKey);
  }

  /** Invalidate all cached entries for a user (call after plan changes) */
  async invalidateUser(userId: string): Promise<void> {
    const licenses = await this.prisma.license.findMany({
      where: { userId },
      select: { licenseKey: true },
    });

    for (const license of licenses) {
      this.cache.delete(license.licenseKey);
    }
  }

  private communityResult(): VerificationResult {
    const plan = getPlanDefinition('community');
    return {
      valid: false,
      plan: 'community',
      features: [...plan.features],
      expiresAt: null,
    };
  }

  private cacheResult(key: string, result: VerificationResult): void {
    this.cache.set(key, { result, expiry: Date.now() + this.CACHE_TTL_MS });
  }
}
```

**Scaling note:** For high-volume verification (thousands of requests per second), replace the in-memory `Map` with Redis. The pattern remains identical -- only the cache backend changes.

```typescript
// Redis-based cache (drop-in replacement)
async verify(licenseKey: string): Promise<VerificationResult> {
  const cached = await this.redis.get(`license:${licenseKey}`);
  if (cached) return JSON.parse(cached);

  // ... database lookup ...

  await this.redis.set(`license:${licenseKey}`, JSON.stringify(result), 'EX', 300);
  return result;
}
```

## License Provisioning Flows

### On Subscription Created

```typescript
async provisionLicense(data: {
  userId: string;
  priceId: string;
  eventId: string;
  currentPeriodEnd: Date;
}): Promise<void> {
  const plan = this.mapPriceIdToPlan(data.priceId);

  // Create new license (automatically revokes old ones)
  const licenseKey = await this.licenseService.createLicense(
    data.userId,
    plan,
    `webhook_${data.eventId}`,
    data.currentPeriodEnd,
  );

  // Invalidate verification cache
  await this.verificationService.invalidateUser(data.userId);

  // Send welcome email with license key
  await this.emailService.sendLicenseKey(data.userId, licenseKey, plan);
}
```

### On Subscription Canceled

```typescript
async handleCancellation(data: {
  userId: string;
  currentPeriodEnd: Date;
}): Promise<void> {
  // Set expiration to end of current period (grace period)
  await this.licenseService.setExpiration(data.userId, data.currentPeriodEnd);

  // Invalidate cache
  await this.verificationService.invalidateUser(data.userId);
}
```

### On Subscription Renewed

```typescript
async handleRenewal(data: {
  userId: string;
  priceId: string;
  eventId: string;
  newPeriodEnd: Date;
}): Promise<void> {
  const plan = this.mapPriceIdToPlan(data.priceId);

  // Extend existing license or create new one
  const activeLicense = await this.prisma.license.findFirst({
    where: { userId: data.userId, status: 'active' },
  });

  if (activeLicense) {
    await this.prisma.license.update({
      where: { id: activeLicense.id },
      data: { expiresAt: data.newPeriodEnd, plan },
    });
  } else {
    await this.licenseService.createLicense(
      data.userId,
      plan,
      `webhook_${data.eventId}`,
      data.newPeriodEnd,
    );
  }

  await this.verificationService.invalidateUser(data.userId);
}
```

### On Subscription Paused / Resumed

```typescript
async handlePause(userId: string): Promise<void> {
  await this.licenseService.pauseUserLicenses(userId);
  await this.verificationService.invalidateUser(userId);
}

async handleResume(userId: string): Promise<void> {
  await this.licenseService.resumeUserLicenses(userId);
  await this.verificationService.invalidateUser(userId);
}
```
