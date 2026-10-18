# Webhook Resilience and Recovery

Webhooks are fire-and-forget HTTP calls from external services. Network failures, server errors, and duplicate deliveries are expected. This guide covers idempotent handling, failure storage, acknowledgement, and retry queues.

## Idempotent Processing

Providers may deliver the same event multiple times. Your handler must produce the same result whether it processes an event once or ten times.

### Strategy 1: Processed Event Tracking Table

Track every processed event ID in a database table. Serialize each event's check, mutation, and success record in one database transaction. Domain handlers must also be idempotent for external effects.

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

  await this.prisma.$transaction(async (tx) => {
    // PostgreSQL transaction lock serializes concurrent deliveries of this event.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${event.id}, 0))`;
    const existing = await tx.processedWebhookEvent.findUnique({
      where: { eventId: event.id },
    });
    if (existing) return;

    await this.routeEvent(event, tx); // Apply database mutations in this transaction.
    await tx.processedWebhookEvent.create({
      data: { eventId: event.id, eventType: event.type },
    });
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

Store failure details durably for investigation and retry when a handler throws an error. Return a retryable response unless an automatic retry path will redrive the stored failure.

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

## Webhook Response Pattern

### The Rule

Return HTTP 200 after success, or after durably storing a failure that an automatic retry path will redrive. Otherwise return a retryable response. Reject invalid signatures with 401.

### Why

Providers retry on non-2xx responses. If your handler returns 500:

1. The provider retries the same event (typically 3-10 times with exponential backoff)
2. Each retry hits the same error, creating duplicate failure records
3. Your server handles N times the load for one broken event
4. The provider may disable your webhook endpoint after too many failures

### Implementation

```typescript
// Layer 2: Webhook Service; automatic retry worker is configured.
async processWebhook(rawBody: Buffer, signature: string): Promise<void> {
  try {
    const event = this.verifyAndParse(rawBody, signature);
    await this.routeEvent(event);
    await this.recordProcessedEvent(event);
  } catch (error) {
    this.logger.error(`Webhook failed: ${error.message}`, error.stack);
    await this.storeFailedWebhook(rawBody.toString('utf-8'), 'unknown', error);
    await this.scheduleRetry(rawBody, signature);
    // Only swallow after durable storage and automatic retry scheduling.
  }
}

// Layer 1: Controller; storage or scheduling failures propagate as retryable errors.
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
| Handler failure with automatic redrive | 200          | Failure is stored durably and queued       |
| Handler failure without automatic redrive | 5xx       | Ask provider to retry                      |

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
