# Webhook Resilience and Recovery

Webhooks are fire-and-forget HTTP calls from external services. Network failures, server errors, and duplicate deliveries are expected. This guide covers idempotent handling, failure storage, the always-200 response strategy, and optional retry queues.

## Idempotent Processing

Providers may deliver the same event multiple times. Your handler must produce the same result whether it processes an event once or ten times.

### Strategy 1: Processed Event Tracking Table

Track every processed event ID in a database table. Check before processing, record after success.

```prisma
model ProcessedWebhookEvent {
  id          String   @id @default(cuid())
  eventId     String   @unique
  eventType   String
  processedAt DateTime @default(now())

  @@index([eventType])
  @@map("processed_webhook_events")
}
```

```typescript
async processWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const event = this.verifyAndParse(rawBody, signature);

  // Check BEFORE processing
  const existing = await this.prisma.processedWebhookEvent.findUnique({
    where: { eventId: event.id },
  });
  if (existing) {
    this.logger.log(`Skipping duplicate event: ${event.id}`);
    return;
  }

  await this.routeEvent(event);

  // Record AFTER successful processing
  await this.prisma.processedWebhookEvent.create({
    data: { eventId: event.id, eventType: event.type },
  });
}
```

### Strategy 2: Business-Level Upsert

Use `upsert` with the external event ID as a unique key. Handles duplicates at the database level without a separate tracking table.

```typescript
async handleSubscriptionCreated(data: SubscriptionData): Promise<void> {
  await this.prisma.subscription.upsert({
    where: { externalId: data.id },
    create: {
      externalId: data.id,
      userId: data.customerId,
      planId: data.planId,
      status: 'active',
      createdBy: `webhook_${data.id}`,  // Audit trail
    },
    update: { status: 'active', planId: data.planId },
  });
}
```

### Strategy 3: Redis Deduplication (High Throughput)

For thousands of webhooks per minute, Redis provides faster lookups. Use a key with TTL to auto-expire old entries.

```typescript
async isDuplicate(eventId: string): Promise<boolean> {
  const key = `webhook:processed:${eventId}`;
  // SETNX returns null if key already existed (duplicate)
  const result = await this.redis.set(key, '1', 'EX', 86400, 'NX');
  return result === null;
}
```

### Choosing a Strategy

| Strategy                 | Throughput          | Durability | Complexity |
| ------------------------ | ------------------- | ---------- | ---------- |
| Database table           | Low-medium (~100/s) | High       | Low        |
| Upsert in business logic | Medium (~500/s)     | High       | Lowest     |
| Redis set with TTL       | High (~10,000/s)    | Medium     | Medium     |

For most SaaS applications, the database table approach is sufficient.

## Failed Webhook Storage

Store failure details for investigation and retry when a handler throws an error. Never let handler errors reach the HTTP response.

### Prisma Model

```prisma
model FailedWebhook {
  id           String    @id @default(cuid())
  eventId      String?
  eventType    String
  rawPayload   String    @db.Text
  errorMessage String
  stackTrace   String    @db.Text
  attemptedAt  DateTime
  retryCount   Int       @default(0)
  resolved     Boolean   @default(false)
  resolvedAt   DateTime?
  resolvedBy   String?

  @@index([resolved, attemptedAt])
  @@index([eventType])
  @@map("failed_webhooks")
}
```

### Storage Implementation

```typescript
private async storeFailedWebhook(
  rawPayload: string,
  eventType: string,
  error: Error,
): Promise<void> {
  try {
    await this.prisma.failedWebhook.create({
      data: {
        eventType,
        rawPayload,
        errorMessage: error.message,
        stackTrace: error.stack ?? '',
        attemptedAt: new Date(),
        retryCount: 0,
        resolved: false,
      },
    });
  } catch (storageError) {
    // Last resort: log to stderr if failure storage itself fails
    this.logger.error(
      `CRITICAL: Could not store failed webhook: ${storageError.message}`,
    );
  }
}
```

### Admin Endpoints for Review and Retry

```typescript
@Controller('api/admin/failed-webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class FailedWebhookController {
  constructor(private readonly service: FailedWebhookService) {}

  @Get()
  async list(@Query('resolved') resolved?: string, @Query('eventType') eventType?: string) {
    return this.service.listFailedWebhooks({
      resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      eventType,
    });
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    return this.service.retryFailedWebhook(id);
  }

  @Patch(':id/resolve')
  async resolve(@Param('id') id: string) {
    return this.service.markResolved(id);
  }
}
```

## Always-200 Response Pattern

### The Rule

Return HTTP 200 for every webhook request regardless of processing outcome. The only exception is signature verification failure (return 401).

### Why

Providers retry on non-2xx responses. If your handler returns 500:

1. The provider retries the same event (typically 3-10 times with exponential backoff)
2. Each retry hits the same error, creating duplicate failure records
3. Your server handles N times the load for one broken event
4. The provider may disable your webhook endpoint after too many failures

### Implementation

```typescript
// Layer 2: Webhook Service - entire method wrapped in try/catch
async processWebhook(rawBody: Buffer, signature: string): Promise<void> {
  try {
    const event = this.verifyAndParse(rawBody, signature);
    await this.routeEvent(event);
    await this.recordProcessedEvent(event);
  } catch (error) {
    this.logger.error(`Webhook failed: ${error.message}`, error.stack);
    await this.storeFailedWebhook(rawBody.toString('utf-8'), 'unknown', error);
    // Do NOT rethrow
  }
}

// Layer 1: Controller - no try/catch needed, service never throws
@Post('provider-name')
@HttpCode(200)
async handleWebhook(@RawBody() rawBody: Buffer, @Headers('x-provider-signature') sig: string) {
  if (!sig) return { received: false };
  await this.webhookService.processWebhook(rawBody, sig);
  return { received: true };
}
```

### When to Break the Rule

| Scenario                     | Status Code             | Reason                                     |
| ---------------------------- | ----------------------- | ------------------------------------------ |
| Signature verification fails | 401                     | Tells provider the secret is misconfigured |
| Missing required headers     | 200 (`received: false`) | Do not trigger retries                     |
| Rate limit exceeded          | 429                     | Providers respect rate limits              |
| All other errors             | 200                     | Store failure internally                   |

## Retry Queue (Advanced)

For automatic retry without manual intervention, use BullMQ with exponential backoff.

```bash
npm install @nestjs/bullmq bullmq
```

```typescript
// Processor
@Processor('webhook-retry')
export class WebhookRetryProcessor extends WorkerHost {
  private readonly MAX_RETRIES = 5;

  constructor(private readonly prisma: PrismaService, private readonly webhookService: ProviderWebhookService) {
    super();
  }

  async process(job: Job<{ failedWebhookId: string; rawPayload: string; attempt: number }>) {
    const { failedWebhookId, rawPayload, attempt } = job.data;
    try {
      await this.webhookService.processWebhookWithoutVerification(Buffer.from(rawPayload));
      await this.prisma.failedWebhook.update({
        where: { id: failedWebhookId },
        data: { resolved: true, resolvedAt: new Date(), retryCount: attempt },
      });
    } catch (error) {
      await this.prisma.failedWebhook.update({
        where: { id: failedWebhookId },
        data: { retryCount: attempt, errorMessage: error.message },
      });
      if (attempt < this.MAX_RETRIES) throw error; // Triggers BullMQ retry
    }
  }
}

// Queue configuration in module
BullModule.registerQueue({
  name: 'webhook-retry',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30000 }, // 30s, 60s, 120s, 240s, 480s
    removeOnComplete: true,
    removeOnFail: false,
  },
});
```

### Retry Schedule

| Attempt | Delay      | Total Elapsed |
| ------- | ---------- | ------------- |
| 1       | 30 seconds | 30s           |
| 2       | 1 minute   | 1.5 min       |
| 3       | 2 minutes  | 3.5 min       |
| 4       | 4 minutes  | 7.5 min       |
| 5       | 8 minutes  | 15.5 min      |

### When to Use a Retry Queue

| Volume                       | Recommendation                         |
| ---------------------------- | -------------------------------------- |
| Low (<100/day)               | Manual retry via admin endpoints       |
| Medium (100-10,000/day)      | BullMQ retry queue                     |
| High (>10,000/day)           | Retry queue + dedicated worker process |
| Errors usually need code fix | Manual retry only                      |
