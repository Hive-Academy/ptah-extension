# Implementation Plan - TASK_2025_123

## Reliable Paddle Subscription Management System

**Status**: Architecture Complete
**Estimated Effort**: 16-20 hours

---

## 1. Codebase Investigation Summary

### Libraries Discovered

- **PaddleModule** (`apps/ptah-license-server/src/paddle/`)

  - Existing service: `PaddleService` - webhook handling, license provisioning
  - Existing controller: `PaddleController` - webhook endpoint at POST /webhooks/paddle
  - Existing provider: `PaddleClientProvider` - Paddle SDK client injection (PADDLE_CLIENT token)
  - Documentation: Uses `@paddle/paddle-node-sdk` with customers.get(), webhooks.unmarshal()

- **EventsModule** (`apps/ptah-license-server/src/events/`)

  - Existing service: `EventsService` - SSE broadcasting to frontend
  - Methods: emitLicenseUpdated(), emitSubscriptionStatus(), getEventStream()
  - Event types: LicenseUpdatedEvent, SubscriptionStatusEvent

- **AuthModule** (`apps/ptah-license-server/src/app/auth/`)

  - Guard: `JwtAuthGuard` - validates ptah_auth cookie, attaches req.user
  - Pattern: @UseGuards(JwtAuthGuard) on protected routes

- **PrismaModule** (`apps/ptah-license-server/src/prisma/`)
  - Service: `PrismaService` - database access
  - Models: User, License, Subscription (schema.prisma)

### Patterns Identified

1. **Controller Pattern** (Evidence: auth.controller.ts, license.controller.ts)

   - Route prefix via @Controller('path')
   - Guards via @UseGuards(JwtAuthGuard)
   - Request user: `req.user as { id: string; email: string }`
   - Error handling: throw NestJS exceptions (BadRequestException, UnauthorizedException)

2. **Service Pattern** (Evidence: paddle.service.ts:40-968)

   - Injectable services with Logger
   - PrismaService for database
   - ConfigService for environment variables
   - @Inject(PADDLE_CLIENT) for Paddle SDK

3. **DTO Pattern** (Evidence: paddle-webhook.dto.ts)

   - class-validator decorators (@IsString, @IsOptional, etc.)
   - Type transformation with class-transformer

4. **SSE Event Pattern** (Evidence: events.service.ts, events.types.ts)

   - Type-safe event interfaces
   - emitX methods for each event type
   - Per-user filtering via email

5. **Frontend Service Pattern** (Evidence: paddle-checkout.service.ts)
   - Signal-based state management
   - HttpClient for API calls
   - Error handling with retry logic

### Integration Points

1. **Paddle SDK Client** (paddle.provider.ts:60-96)

   - Injection: `@Inject(PADDLE_CLIENT) private readonly paddle: PaddleClient`
   - Available methods: `paddle.customers.get()`, `paddle.webhooks.unmarshal()`
   - Need to add: `paddle.subscriptions.list()`, `paddle.subscriptions.get()`, `paddle.customerPortalSessions.create()`

2. **Database Access** (prisma.service.ts)

   - Injection: `private readonly prisma: PrismaService`
   - Models: User, License, Subscription
   - Transaction: `prisma.$transaction(async (tx) => {})`

3. **SSE Broadcasting** (events.service.ts)
   - Injection: `private readonly eventsService: EventsService`
   - Methods: emitLicenseUpdated(), emitSubscriptionStatus()

---

## 2. Architecture Design

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ptah-license-server                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────┐    │
│  │   SubscriptionController    │    │       PaddleController          │    │
│  │   (NEW - User APIs)         │    │   (EXISTING - Webhooks)         │    │
│  │                              │    │                                  │    │
│  │ GET  /subscriptions/status   │    │ POST /webhooks/paddle           │    │
│  │ POST /subscriptions/validate │    │   - subscription.created        │    │
│  │ POST /subscriptions/reconcile│    │   - subscription.updated        │    │
│  │ POST /subscriptions/portal   │    │   - subscription.canceled       │    │
│  └──────────────┬───────────────┘    │   - transaction.completed (NEW) │    │
│                 │                     └──────────────┬─────────────────┘    │
│                 │                                    │                       │
│                 ▼                                    ▼                       │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │                   SubscriptionService (NEW)                       │      │
│  │                                                                   │      │
│  │  - getStatus(userId): Paddle API + fallback                      │      │
│  │  - validateCheckout(userId, priceId): duplicate prevention       │      │
│  │  - reconcile(userId): sync local with Paddle                     │      │
│  │  - createPortalSession(customerId): generate portal URL          │      │
│  └────────────────────────────────┬─────────────────────────────────┘      │
│                                   │                                         │
│         ┌─────────────────────────┼─────────────────────────┐              │
│         │                         │                         │              │
│         ▼                         ▼                         ▼              │
│  ┌────────────┐           ┌────────────┐           ┌────────────┐         │
│  │ PaddleClient│           │ PrismaService│         │ EventsService│        │
│  │ (SDK)       │           │ (Database)   │         │ (SSE)        │        │
│  └────────────┘           └────────────┘           └────────────┘         │
│                                   │                                         │
│                                   ▼                                         │
│                           ┌────────────┐                                   │
│                           │ PostgreSQL │                                   │
│                           │ + FailedWebhook (NEW)│                         │
│                           └────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         ptah-landing-page                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────┐    │
│  │   PaddleCheckoutService     │    │   ProfilePageComponent           │    │
│  │   (MODIFY)                  │    │   (MODIFY)                       │    │
│  │                              │    │                                  │    │
│  │ + validateCheckout()        │    │ + syncWithPaddle()               │    │
│  │ + openCheckout() - adds     │    │ + manageSubscription()           │    │
│  │   pre-validation            │    │                                  │    │
│  └─────────────────────────────┘    └─────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                 ProfileDetailsComponent (MODIFY)                     │   │
│  │                                                                      │   │
│  │  + "Sync with Paddle" button                                        │   │
│  │  + "Manage Subscription" link (opens portal)                        │   │
│  │  + Loading states for sync/portal operations                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Design Philosophy

**Chosen Approach**: New SubscriptionController + SubscriptionService

**Rationale**:

1. Separation of concerns: Webhooks (PaddleController) vs User APIs (SubscriptionController)
2. Single responsibility: SubscriptionService handles all subscription verification logic
3. Existing patterns: Follows controller/service pattern from auth.controller.ts, license.controller.ts
4. No backward compatibility: Direct implementation, no legacy support needed

**Evidence**:

- Controller separation pattern: license.controller.ts (user APIs) vs admin.controller.ts (admin APIs)
- Service injection pattern: paddle.service.ts:44-51
- Guard pattern: license.controller.ts:97-99

---

## 3. Component Specifications

### Component 1: FailedWebhook Prisma Model

**Purpose**: Store failed webhook payloads for manual recovery and investigation

**Pattern**: Prisma model with appropriate indexes
**Evidence**: schema.prisma:34-74 (existing models)

**Schema Addition**:

```prisma
// apps/ptah-license-server/prisma/schema.prisma

model FailedWebhook {
  id           String   @id @default(uuid()) @db.Uuid
  eventId      String   @map("event_id")
  eventType    String   @map("event_type")
  rawPayload   Json     @map("raw_payload")
  errorMessage String   @map("error_message")
  stackTrace   String?  @map("stack_trace")
  attemptedAt  DateTime @map("attempted_at") @default(now())
  retryCount   Int      @default(0) @map("retry_count")
  resolved     Boolean  @default(false)
  resolvedAt   DateTime? @map("resolved_at")

  @@index([eventId])
  @@index([eventType])
  @@index([resolved])
  @@map("failed_webhooks")
}
```

**Files Affected**:

- `apps/ptah-license-server/prisma/schema.prisma` (MODIFY - add model)

---

### Component 2: Paddle Client Interface Extension

**Purpose**: Extend PaddleClient interface to include subscription and portal session methods

**Pattern**: TypeScript interface extension
**Evidence**: paddle.provider.ts:18-31 (existing PaddleClient interface)

**Interface Extension**:

```typescript
// apps/ptah-license-server/src/paddle/providers/paddle.provider.ts

export interface PaddleSubscription {
  id: string;
  status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused';
  customerId: string;
  items: Array<{
    price: {
      id: string;
      description?: string;
    };
  }>;
  currentBillingPeriod: {
    startsAt: string;
    endsAt: string;
  };
  scheduledChange?: {
    action: string;
    effectiveAt: string;
  };
  canceledAt?: string;
  startedAt?: string;
}

export interface PaddleSubscriptionList {
  data: PaddleSubscription[];
  hasMore: boolean;
}

export interface PaddlePortalSession {
  id: string;
  urls: {
    general: {
      overview: string;
    };
  };
}

export interface PaddleClient {
  webhooks: {
    unmarshal(rawBody: string, secretKey: string, signature: string): Promise<EventEntity>;
  };
  customers: {
    get(customerId: string): Promise<PaddleCustomer>;
  };
  subscriptions: {
    list(params: { customerId: string; status?: string[] }): Promise<PaddleSubscriptionList>;
    get(subscriptionId: string): Promise<PaddleSubscription>;
  };
  customerPortalSessions: {
    create(params: { customerId: string }): Promise<PaddlePortalSession>;
  };
}
```

**Files Affected**:

- `apps/ptah-license-server/src/paddle/providers/paddle.provider.ts` (MODIFY)

---

### Component 3: Subscription DTOs

**Purpose**: Define request/response types for subscription endpoints

**Pattern**: Class-validator DTOs
**Evidence**: paddle-webhook.dto.ts (existing DTO patterns)

**DTO Definitions**:

```typescript
// apps/ptah-license-server/src/subscription/dto/subscription.dto.ts

// --- Request DTOs ---

export class ValidateCheckoutDto {
  @IsString()
  priceId!: string;
}

// --- Response DTOs ---

export class SubscriptionStatusResponseDto {
  hasSubscription!: boolean;
  subscription?: {
    id: string;
    status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused';
    plan: 'basic' | 'pro';
    billingCycle: 'monthly' | 'yearly';
    currentPeriodEnd: string;
    canceledAt?: string;
    trialEnd?: string;
  };
  source!: 'paddle' | 'local';
  requiresSync?: boolean;
  customerPortalUrl?: string;
}

export class ValidateCheckoutResponseDto {
  canCheckout!: boolean;
  reason?: 'existing_subscription' | 'subscription_ending_soon' | 'none';
  existingPlan?: string;
  currentPeriodEnd?: string;
  customerPortalUrl?: string;
  message?: string;
}

export class ReconcileResponseDto {
  success!: boolean;
  changes!: {
    subscriptionUpdated: boolean;
    licenseUpdated: boolean;
    statusBefore: string;
    statusAfter: string;
    planBefore?: string;
    planAfter?: string;
  };
  errors?: string[];
  paddleSubscription?: {
    id: string;
    status: string;
    plan: string;
    currentPeriodEnd: string;
  };
}

export class PortalSessionResponseDto {
  url!: string;
  expiresAt!: string;
}

export class PortalSessionErrorDto {
  error!: 'no_customer_record' | 'paddle_api_error';
  message!: string;
}
```

**Files Affected**:

- `apps/ptah-license-server/src/subscription/dto/subscription.dto.ts` (CREATE)
- `apps/ptah-license-server/src/subscription/dto/index.ts` (CREATE)

---

### Component 4: SubscriptionService

**Purpose**: Core business logic for subscription verification, validation, and reconciliation

**Pattern**: Injectable NestJS service with Paddle SDK integration
**Evidence**: paddle.service.ts:40-968 (existing service patterns)

**Responsibilities**:

1. Get subscription status from Paddle API with local fallback
2. Validate checkout to prevent duplicates
3. Reconcile local database with Paddle state
4. Generate customer portal sessions

**Key Methods**:

```typescript
// apps/ptah-license-server/src/subscription/subscription.service.ts

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly PADDLE_API_TIMEOUT = 3000; // 3 second timeout

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    @Inject(PADDLE_CLIENT)
    private readonly paddle: PaddleClient
  ) {}

  /**
   * Get subscription status for a user
   *
   * Strategy:
   * 1. Find user's Paddle customer ID from local DB
   * 2. Query Paddle API for subscription with 3s timeout
   * 3. On timeout/error, fall back to local data with source='local'
   * 4. Compare Paddle vs local, set requiresSync if different
   */
  async getStatus(userId: string): Promise<SubscriptionStatusResponseDto>;

  /**
   * Validate if user can checkout (prevent duplicate subscriptions)
   *
   * Strategy:
   * 1. Get subscription status from Paddle
   * 2. If active/trialing/past_due exists, return canCheckout=false
   * 3. If canceled but period not ended, return canCheckout=false with message
   * 4. Otherwise return canCheckout=true
   */
  async validateCheckout(userId: string, priceId: string): Promise<ValidateCheckoutResponseDto>;

  /**
   * Reconcile local database with Paddle state
   *
   * Strategy:
   * 1. Fetch current Paddle subscription
   * 2. Compare with local subscription record
   * 3. Update local to match Paddle (create/update/mark orphaned)
   * 4. Update license status accordingly
   * 5. Emit SSE event for real-time update
   * 6. Return summary of changes
   */
  async reconcile(userId: string, email: string): Promise<ReconcileResponseDto>;

  /**
   * Create customer portal session
   *
   * Strategy:
   * 1. Find user's Paddle customer ID
   * 2. Call Paddle API to create portal session
   * 3. Return portal URL (60-minute validity)
   */
  async createPortalSession(userId: string): Promise<PortalSessionResponseDto | PortalSessionErrorDto>;

  /**
   * Map Paddle price ID to plan name
   * Reuses existing logic from PaddleService
   */
  private mapPriceIdToPlan(priceId: string | undefined): string;

  /**
   * Determine billing cycle from price ID
   */
  private getBillingCycle(priceId: string): 'monthly' | 'yearly';

  /**
   * Helper: Query Paddle API with timeout
   * Returns null on timeout/error for fallback handling
   */
  private async queryPaddleWithTimeout<T>(operation: () => Promise<T>, operationName: string): Promise<T | null>;
}
```

**Files Affected**:

- `apps/ptah-license-server/src/subscription/subscription.service.ts` (CREATE)

---

### Component 5: SubscriptionController

**Purpose**: HTTP endpoints for subscription management

**Pattern**: NestJS Controller with JwtAuthGuard
**Evidence**: license.controller.ts:24-206, auth.controller.ts:85-877

**Endpoints**:

```typescript
// apps/ptah-license-server/src/subscription/subscription.controller.ts

@Controller('v1/subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /**
   * GET /api/v1/subscriptions/status
   *
   * Get current user's subscription status
   * Queries Paddle API with local fallback
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Req() req: Request): Promise<SubscriptionStatusResponseDto>;

  /**
   * POST /api/v1/subscriptions/validate-checkout
   *
   * Validate if user can checkout (prevent duplicates)
   * Must be called before opening Paddle overlay
   */
  @Post('validate-checkout')
  @UseGuards(JwtAuthGuard)
  async validateCheckout(
    @Req() req: Request,
    @Body() dto: ValidateCheckoutDto
  ): Promise<ValidateCheckoutResponseDto>;

  /**
   * POST /api/v1/subscriptions/reconcile
   *
   * User-initiated sync with Paddle
   * Updates local records to match Paddle state
   */
  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  async reconcile(@Req() req: Request): Promise<ReconcileResponseDto>;

  /**
   * POST /api/v1/subscriptions/portal-session
   *
   * Generate Paddle customer portal URL
   * Returns 60-minute valid URL
   */
  @Post('portal-session')
  @UseGuards(JwtAuthGuard)
  async createPortalSession(@Req() req: Request): Promise<PortalSessionResponseDto | PortalSessionErrorDto>;
}
```

**Files Affected**:

- `apps/ptah-license-server/src/subscription/subscription.controller.ts` (CREATE)

---

### Component 6: SubscriptionModule

**Purpose**: NestJS module to wire up subscription components

**Pattern**: NestJS Module with imports/providers/exports
**Evidence**: paddle.module.ts:47-53

**Module Definition**:

```typescript
// apps/ptah-license-server/src/subscription/subscription.module.ts

@Module({
  imports: [PrismaModule, EventsModule, ConfigModule, PaddleModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
```

**Files Affected**:

- `apps/ptah-license-server/src/subscription/subscription.module.ts` (CREATE)
- `apps/ptah-license-server/src/subscription/index.ts` (CREATE)
- `apps/ptah-license-server/src/app/app.module.ts` (MODIFY - add import)

---

### Component 7: Webhook Enhancement (transaction.completed handler)

**Purpose**: Handle subscription renewals via transaction.completed webhook

**Pattern**: Extend existing PaddleController and PaddleService
**Evidence**: paddle.controller.ts:170-236, paddle.service.ts

**Changes to PaddleController**:

```typescript
// Add case for transaction.completed in handleWebhook switch
case 'transaction.completed': {
  const result = await this.paddleService.handleTransactionCompleted(data, eventId);
  return { received: true, ...result };
}
```

**Changes to PaddleService**:

```typescript
/**
 * Handle transaction.completed event
 *
 * This event fires when a payment is successful.
 * For subscription renewals, extends the license expiration.
 *
 * Process:
 * 1. Verify this is a subscription transaction (not one-time)
 * 2. Find existing subscription by subscriptionId
 * 3. Update license expiration to new period end
 * 4. Emit SSE event for real-time update
 */
async handleTransactionCompleted(data: TransactionData, eventId: string): Promise<{ success: boolean }>;
```

**DTO Addition**:

```typescript
// Add to paddle-webhook.dto.ts

export class PaddleTransactionDataDto {
  @IsString()
  id!: string;

  @IsString()
  @IsOptional()
  subscription_id?: string; // Present for subscription transactions

  @IsString()
  status!: string; // 'completed' for successful payments

  @IsObject()
  @ValidateNested()
  @Type(() => PaddleBillingPeriodDto)
  @IsOptional()
  billing_period?: PaddleBillingPeriodDto; // New period for renewals
}

// Update SUBSCRIPTION_EVENTS to include transaction.completed
const HANDLED_EVENTS = [...SUBSCRIPTION_EVENTS, 'transaction.completed'] as const;
```

**Files Affected**:

- `apps/ptah-license-server/src/paddle/paddle.service.ts` (MODIFY - add handler)
- `apps/ptah-license-server/src/paddle/paddle.controller.ts` (MODIFY - add case)
- `apps/ptah-license-server/src/paddle/dto/paddle-webhook.dto.ts` (MODIFY - add DTO)

---

### Component 8: Failed Webhook Storage

**Purpose**: Store failed webhooks for recovery

**Pattern**: Try/catch wrapper in controller with Prisma storage
**Evidence**: paddle.controller.ts:74-237

**Implementation in PaddleController**:

```typescript
// Wrap existing webhook processing in try/catch
// On failure, store to FailedWebhook table

private async storeFailedWebhook(
  eventId: string,
  eventType: string,
  rawPayload: unknown,
  error: Error
): Promise<void> {
  try {
    await this.prisma.failedWebhook.create({
      data: {
        eventId,
        eventType,
        rawPayload: rawPayload as Prisma.JsonValue,
        errorMessage: error.message,
        stackTrace: error.stack,
      },
    });
    this.logger.log(`Stored failed webhook: ${eventId} (${eventType})`);
  } catch (storeError) {
    this.logger.error(`Failed to store failed webhook: ${eventId}`, storeError);
  }
}
```

**Files Affected**:

- `apps/ptah-license-server/src/paddle/paddle.controller.ts` (MODIFY)

---

### Component 9: Frontend - PaddleCheckoutService Enhancement

**Purpose**: Add pre-checkout validation to prevent duplicate subscriptions

**Pattern**: Angular signal-based service with HttpClient
**Evidence**: paddle-checkout.service.ts:36-435

**Changes**:

```typescript
// apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts

// Add new signal for validation state
private readonly _isValidating = signal(false);
public readonly isValidating = this._isValidating.asReadonly();

// Add validation error state
private readonly _validationError = signal<string | null>(null);
public readonly validationError = this._validationError.asReadonly();

/**
 * Validate checkout before opening Paddle overlay
 *
 * Calls POST /api/v1/subscriptions/validate-checkout
 * If canCheckout=false, shows modal with error and portal link
 */
private async validateCheckoutBeforeOpen(priceId: string): Promise<boolean>;

/**
 * Modified openCheckout to include validation
 */
public async openCheckout(options: CheckoutOptions): Promise<void> {
  // Step 1: Validate first
  this._isValidating.set(true);
  const canProceed = await this.validateCheckoutBeforeOpen(options.priceId);
  this._isValidating.set(false);

  if (!canProceed) {
    // Show validation error modal (handled by component)
    return;
  }

  // Step 2: Proceed with existing checkout logic
  // ... existing openCheckout implementation
}
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts` (MODIFY)

---

### Component 10: Frontend - ProfileDetailsComponent Enhancement

**Purpose**: Add "Sync with Paddle" button and "Manage Subscription" link

**Pattern**: Angular signal-based component with input/output
**Evidence**: profile-details.component.ts:1-200

**Changes**:

```typescript
// apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts

// Add new outputs for actions
public readonly syncRequested = output<void>();
public readonly manageSubscriptionRequested = output<void>();

// Add new inputs for state
public readonly isSyncing = input<boolean>(false);
public readonly syncError = input<string | null>(null);
public readonly syncSuccess = input<boolean>(false);

// Add template sections for:
// 1. "Sync with Paddle" button (shown when requiresSync or has subscription)
// 2. "Manage Subscription" link (shown when has subscription)
// 3. Loading/success/error states for sync operation
```

**Template Additions**:

```html
<!-- Sync with Paddle Button -->
@if (license()?.subscription || license()?.requiresSync) {
<div class="px-6 py-4 flex justify-between items-center">
  <span class="text-neutral-content flex items-center gap-2">
    <lucide-angular [img]="RefreshCwIcon" class="w-4 h-4" aria-hidden="true" />
    Subscription Sync
  </span>
  <button class="btn btn-sm btn-ghost" [disabled]="isSyncing()" (click)="syncRequested.emit()">
    @if (isSyncing()) {
    <span class="loading loading-spinner loading-xs"></span>
    Syncing... } @else { Sync with Paddle }
  </button>
</div>
}

<!-- Manage Subscription Link -->
@if (license()?.subscription) {
<div class="px-6 py-4 flex justify-between items-center">
  <span class="text-neutral-content flex items-center gap-2">
    <lucide-angular [img]="ExternalLinkIcon" class="w-4 h-4" aria-hidden="true" />
    Subscription Management
  </span>
  <button class="btn btn-sm btn-secondary" (click)="manageSubscriptionRequested.emit()">Manage Subscription</button>
</div>
}
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts` (MODIFY)

---

### Component 11: Frontend - ProfilePageComponent Enhancement

**Purpose**: Handle sync and manage subscription actions from ProfileDetailsComponent

**Pattern**: Angular orchestrating component
**Evidence**: profile-page.component.ts:51-275

**Changes**:

```typescript
// apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts

// Add new state signals
public readonly isSyncing = signal(false);
public readonly syncError = signal<string | null>(null);
public readonly syncSuccess = signal(false);

/**
 * Handle sync with Paddle request
 * Calls POST /api/v1/subscriptions/reconcile
 */
public async handleSyncWithPaddle(): Promise<void>;

/**
 * Handle manage subscription request
 * Calls POST /api/v1/subscriptions/portal-session
 * Opens portal URL in new tab
 */
public async handleManageSubscription(): Promise<void>;

// Update template to pass new inputs/outputs to profile-details
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts` (MODIFY)

---

### Component 12: SSE Event Enhancement

**Purpose**: Add new event type for reconciliation completed

**Pattern**: SSE event types
**Evidence**: events.types.ts:1-77

**Changes**:

```typescript
// apps/ptah-license-server/src/events/events.types.ts

export interface ReconciliationCompletedEvent extends BaseEvent {
  type: 'reconciliation.completed';
  data: {
    email: string;
    success: boolean;
    changes: {
      subscriptionUpdated: boolean;
      licenseUpdated: boolean;
    };
  };
}

// Update SSEEvent union type
export type SSEEvent =
  | LicenseUpdatedEvent
  | SubscriptionStatusEvent
  | ConnectionEvent
  | HeartbeatEvent
  | ReconciliationCompletedEvent;

// Add emit method to EventsService
emitReconciliationCompleted(data: ReconciliationCompletedEvent['data']): void;
```

**Files Affected**:

- `apps/ptah-license-server/src/events/events.types.ts` (MODIFY)
- `apps/ptah-license-server/src/events/events.service.ts` (MODIFY)
- `apps/ptah-landing-page/src/app/services/sse-events.service.ts` (MODIFY - add type)

---

## 4. Integration Architecture

### API Contracts

#### GET /api/v1/subscriptions/status

```typescript
// Request
Headers: Cookie: ptah_auth = <
  jwt // Response 200 OK
>{
  hasSubscription: boolean,
  subscription: {
    id: string, // "sub_xxx"
    status: string, // "active" | "trialing" | "canceled" | "past_due" | "paused"
    plan: string, // "basic" | "pro"
    billingCycle: string, // "monthly" | "yearly"
    currentPeriodEnd: string, // ISO 8601
    canceledAt: string, // ISO 8601
    trialEnd: string, // ISO 8601
  },
  source: 'paddle' | 'local',
  requiresSync: boolean,
  customerPortalUrl: string,
};
```

#### POST /api/v1/subscriptions/validate-checkout

```typescript
// Request
Headers: Cookie: ptah_auth=<jwt>
Body: { priceId: string }

// Response 200 OK
{
  canCheckout: boolean,
  reason?: 'existing_subscription' | 'subscription_ending_soon' | 'none',
  existingPlan?: string,
  currentPeriodEnd?: string,
  customerPortalUrl?: string,
  message?: string,
}
```

#### POST /api/v1/subscriptions/reconcile

```typescript
// Request
Headers: Cookie: ptah_auth=<jwt>

// Response 200 OK
{
  success: boolean,
  changes: {
    subscriptionUpdated: boolean,
    licenseUpdated: boolean,
    statusBefore: string,
    statusAfter: string,
    planBefore?: string,
    planAfter?: string,
  },
  errors?: string[],
  paddleSubscription?: {
    id: string,
    status: string,
    plan: string,
    currentPeriodEnd: string,
  },
}
```

#### POST /api/v1/subscriptions/portal-session

```typescript
// Request
Headers: Cookie: ptah_auth=<jwt>

// Response 200 OK (success)
{
  url: string,     // Customer portal URL
  expiresAt: string, // ISO 8601 (60 min from now)
}

// Response 400 Bad Request (error)
{
  error: 'no_customer_record' | 'paddle_api_error',
  message: string,
}
```

### Data Flow

1. **Subscription Status Flow**:

   ```
   Frontend → GET /subscriptions/status
            → SubscriptionController.getStatus()
            → SubscriptionService.getStatus()
            → Paddle API (with 3s timeout)
            → On success: Return Paddle data, compare with local
            → On timeout: Return local data with source='local'
            → Frontend displays status with sync indicator
   ```

2. **Pre-Checkout Validation Flow**:

   ```
   Frontend → User clicks "Subscribe"
           → PaddleCheckoutService.openCheckout()
           → POST /subscriptions/validate-checkout
           → SubscriptionService.validateCheckout()
           → Query Paddle for existing subscription
           → Return canCheckout + reason
           → If canCheckout=true: Open Paddle overlay
           → If canCheckout=false: Show error modal with portal link
   ```

3. **Reconciliation Flow**:

   ```
   Frontend → User clicks "Sync with Paddle"
           → POST /subscriptions/reconcile
           → SubscriptionService.reconcile()
           → Fetch Paddle subscription
           → Compare with local DB
           → Update local records (in transaction)
           → Emit SSE event (license.updated)
           → Return change summary
           → Frontend refreshes profile data
   ```

4. **Webhook Flow (transaction.completed)**:
   ```
   Paddle → POST /webhooks/paddle
        → PaddleController.handleWebhook()
        → Verify signature
        → Route to PaddleService.handleTransactionCompleted()
        → Find subscription by ID
        → Update license expiration
        → Emit SSE event
        → Return 200 OK
   ```

---

## 5. Files Affected Summary

### CREATE (9 files)

| File                                                                                       | Purpose               |
| ------------------------------------------------------------------------------------------ | --------------------- |
| `apps/ptah-license-server/src/subscription/subscription.module.ts`                         | NestJS module         |
| `apps/ptah-license-server/src/subscription/subscription.controller.ts`                     | HTTP endpoints        |
| `apps/ptah-license-server/src/subscription/subscription.service.ts`                        | Business logic        |
| `apps/ptah-license-server/src/subscription/dto/subscription.dto.ts`                        | Request/response DTOs |
| `apps/ptah-license-server/src/subscription/dto/index.ts`                                   | DTO barrel export     |
| `apps/ptah-license-server/src/subscription/index.ts`                                       | Module barrel export  |
| `apps/ptah-license-server/prisma/migrations/[timestamp]_add_failed_webhooks/migration.sql` | Database migration    |

### MODIFY (12 files)

| File                                                                                   | Changes                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/ptah-license-server/prisma/schema.prisma`                                        | Add FailedWebhook model                                |
| `apps/ptah-license-server/src/paddle/providers/paddle.provider.ts`                     | Extend PaddleClient interface                          |
| `apps/ptah-license-server/src/paddle/paddle.service.ts`                                | Add handleTransactionCompleted()                       |
| `apps/ptah-license-server/src/paddle/paddle.controller.ts`                             | Add transaction.completed case, failed webhook storage |
| `apps/ptah-license-server/src/paddle/dto/paddle-webhook.dto.ts`                        | Add transaction DTO                                    |
| `apps/ptah-license-server/src/events/events.types.ts`                                  | Add ReconciliationCompletedEvent                       |
| `apps/ptah-license-server/src/events/events.service.ts`                                | Add emitReconciliationCompleted()                      |
| `apps/ptah-license-server/src/app/app.module.ts`                                       | Import SubscriptionModule                              |
| `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts`                   | Add pre-checkout validation                            |
| `apps/ptah-landing-page/src/app/services/sse-events.service.ts`                        | Add ReconciliationCompletedEvent type                  |
| `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts`               | Add sync/manage handlers                               |
| `apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts` | Add sync/manage UI                                     |

---

## 6. Implementation Order (Dependency-Aware)

### Phase 1: Database Foundation (1-2 hours)

**Prerequisite**: None

1. **Add FailedWebhook model to schema.prisma**
   - Add model definition
   - Run `npx prisma migrate dev --name add_failed_webhooks`
   - Verify generated client

### Phase 2: Backend Service Layer (4-6 hours)

**Prerequisite**: Phase 1 complete

2. **Extend PaddleClient interface** (paddle.provider.ts)

   - Add subscription and portal session types
   - Verify types match Paddle SDK

3. **Create Subscription DTOs** (dto/subscription.dto.ts)

   - Request DTOs with validators
   - Response DTOs with type definitions

4. **Create SubscriptionService** (subscription.service.ts)

   - Implement getStatus() with Paddle API + fallback
   - Implement validateCheckout()
   - Implement reconcile()
   - Implement createPortalSession()
   - Add helper methods for price ID mapping

5. **Create SubscriptionController** (subscription.controller.ts)

   - Wire up all four endpoints
   - Apply JwtAuthGuard
   - Extract user from request

6. **Create SubscriptionModule** (subscription.module.ts)

   - Import dependencies
   - Register controller and service

7. **Register in AppModule** (app.module.ts)
   - Add SubscriptionModule to imports

### Phase 3: Webhook Enhancement (2-3 hours)

**Prerequisite**: Phase 1 complete

8. **Add transaction DTO** (paddle-webhook.dto.ts)

   - PaddleTransactionDataDto
   - Update event type constants

9. **Add handleTransactionCompleted** (paddle.service.ts)

   - Handle renewal logic
   - Update license expiration
   - Emit SSE event

10. **Update PaddleController** (paddle.controller.ts)
    - Add transaction.completed case
    - Add failed webhook storage wrapper

### Phase 4: SSE Enhancement (1 hour)

**Prerequisite**: None (can parallel with Phase 2)

11. **Add ReconciliationCompletedEvent** (events.types.ts)

    - Define event interface
    - Update union type

12. **Add emitReconciliationCompleted** (events.service.ts)
    - Implement emit method

### Phase 5: Frontend Integration (4-6 hours)

**Prerequisite**: Phases 2, 3, 4 complete

13. **Enhance PaddleCheckoutService** (paddle-checkout.service.ts)

    - Add validation signals
    - Add validateCheckoutBeforeOpen()
    - Modify openCheckout() to validate first

14. **Enhance ProfileDetailsComponent** (profile-details.component.ts)

    - Add sync button
    - Add manage subscription link
    - Add loading/error states

15. **Enhance ProfilePageComponent** (profile-page.component.ts)

    - Add sync state signals
    - Implement handleSyncWithPaddle()
    - Implement handleManageSubscription()
    - Wire up child component events

16. **Update SSEEventsService** (sse-events.service.ts)
    - Add ReconciliationCompletedEvent type
    - Add reconciliationCompleted$ observable

### Phase 6: Testing & Validation (2-4 hours)

**Prerequisite**: All phases complete

17. **Unit Tests**

    - SubscriptionService methods
    - SubscriptionController endpoints
    - Frontend service methods

18. **Integration Tests**
    - Paddle sandbox webhook tests
    - End-to-end checkout validation
    - Reconciliation flow

---

## 7. Testing Strategy

### Unit Tests

#### SubscriptionService

```typescript
describe('SubscriptionService', () => {
  describe('getStatus', () => {
    it('should return Paddle subscription when API available');
    it('should return local data when Paddle API times out');
    it('should set requiresSync when local differs from Paddle');
    it('should return hasSubscription=false when no subscription');
  });

  describe('validateCheckout', () => {
    it('should return canCheckout=true when no existing subscription');
    it('should return canCheckout=false for active subscription');
    it('should return canCheckout=false for trialing subscription');
    it('should return canCheckout=false for canceled but not expired');
    it('should return canCheckout=true for fully expired subscription');
  });

  describe('reconcile', () => {
    it('should create local subscription when exists in Paddle only');
    it('should update local subscription when status differs');
    it('should mark as orphaned when local only');
    it('should update license status accordingly');
    it('should emit SSE event on changes');
  });

  describe('createPortalSession', () => {
    it('should return portal URL for valid customer');
    it('should return error for unknown customer');
    it('should handle Paddle API errors');
  });
});
```

#### SubscriptionController

```typescript
describe('SubscriptionController', () => {
  it('should reject unauthenticated requests with 401');
  it('should extract user from JWT correctly');
  it('should validate request body for validate-checkout');
  it('should return proper error responses');
});
```

#### Frontend Services

```typescript
describe('PaddleCheckoutService', () => {
  describe('openCheckout', () => {
    it('should validate before opening overlay');
    it('should not open overlay when canCheckout=false');
    it('should set validation error when rejected');
    it('should proceed normally when canCheckout=true');
  });
});
```

### Integration Tests

1. **Paddle Sandbox Tests**

   - Create test subscription in Paddle sandbox
   - Trigger webhooks manually
   - Verify local database updates

2. **E2E Checkout Flow**

   - Login as test user
   - Attempt checkout with existing subscription
   - Verify validation rejection
   - Attempt checkout without subscription
   - Verify Paddle overlay opens

3. **Reconciliation Tests**
   - Create mismatch between local and Paddle
   - Trigger reconciliation
   - Verify sync completed correctly
   - Verify SSE event received

---

## 8. Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (primary), frontend-developer (secondary)

**Rationale**:

- 70% backend work (NestJS services, Paddle SDK integration, database)
- 30% frontend work (Angular components, service modifications)
- Backend work is more complex and should be done first
- Frontend work depends on backend APIs being ready

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 16-20 hours

**Breakdown**:

- Phase 1 (Database): 1-2 hours
- Phase 2 (Backend Service): 4-6 hours
- Phase 3 (Webhooks): 2-3 hours
- Phase 4 (SSE): 1 hour
- Phase 5 (Frontend): 4-6 hours
- Phase 6 (Testing): 2-4 hours

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **Paddle SDK API availability**:

   - Verify `paddle.subscriptions.list()` exists in @paddle/paddle-node-sdk
   - Verify `paddle.customerPortalSessions.create()` exists
   - Test in sandbox environment first

2. **Database migration**:

   - Run `npx prisma migrate dev` in development
   - Verify FailedWebhook table created
   - Test Prisma client generation

3. **Existing patterns followed**:

   - JwtAuthGuard usage matches license.controller.ts
   - Error handling matches existing controllers
   - SSE event emission matches events.service.ts

4. **No hallucinated APIs**:
   - All NestJS decorators verified (@Controller, @Get, @Post, @UseGuards, @Body, @Req)
   - All Prisma operations verified (findUnique, create, update, updateMany)
   - All Angular patterns verified (signal, input, output, computed)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
