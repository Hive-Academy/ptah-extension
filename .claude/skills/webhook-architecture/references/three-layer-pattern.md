# Three-Layer Webhook Pattern - Implementation Guide

## Prerequisites: NestJS Main Configuration

Configure raw body parsing and exclude webhook routes from the global API prefix.

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { RequestMethod, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Preserve raw bytes for signature verification
    rawBodyParser: true,
  });

  // Exclude webhook routes from /api prefix - providers register exact URLs
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'webhooks/(.*)', method: RequestMethod.ALL },
      { path: 'health', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

## Layer 1: Controller (HTTP Concerns Only)

Extract raw body and headers, delegate to the webhook service, always return 200.

```typescript
// src/webhooks/provider-webhook.controller.ts
import { Controller, Post, RawBody, Headers, HttpCode, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProviderWebhookService } from './provider-webhook.service';

@Controller('webhooks')
export class ProviderWebhookController {
  private readonly logger = new Logger(ProviderWebhookController.name);

  constructor(private readonly webhookService: ProviderWebhookService) {}

  @Post('provider-name')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async handleWebhook(@RawBody() rawBody: Buffer, @Headers('x-provider-signature') signature: string, @Headers('x-provider-timestamp') timestamp: string): Promise<{ received: boolean }> {
    if (!rawBody || !signature) {
      this.logger.warn('Webhook missing required headers');
      return { received: false };
    }
    await this.webhookService.processWebhook(rawBody, signature, timestamp);
    return { received: true };
  }
}
```

**Controller rules**: No business logic. No database calls. No try/catch (the service handles errors). No conditional HTTP status codes.

### Signature Header Names by Provider

| Provider | Signature Header        | Timestamp Header            |
| -------- | ----------------------- | --------------------------- |
| Stripe   | `stripe-signature`      | (embedded in signature)     |
| Paddle   | `paddle-signature`      | (embedded in signature)     |
| GitHub   | `x-hub-signature-256`   | `x-github-delivery`         |
| Twilio   | `x-twilio-signature`    | N/A                         |
| Slack    | `x-slack-signature`     | `x-slack-request-timestamp` |
| Shopify  | `x-shopify-hmac-sha256` | N/A                         |

## Layer 2: Webhook Service (Verification and Routing)

Verify signature, check idempotency, route to handlers, catch all errors.

```typescript
// src/webhooks/provider-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../services/subscription.service';
import { PaymentService } from '../services/payment.service';

interface ProviderEvent {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

@Injectable()
export class ProviderWebhookService {
  private readonly logger = new Logger(ProviderWebhookService.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly paymentService: PaymentService,
  ) {
    this.webhookSecret = this.configService.getOrThrow<string>('PROVIDER_WEBHOOK_SECRET');
  }

  async processWebhook(rawBody: Buffer, signature: string, timestamp: string): Promise<void> {
    let event: ProviderEvent;

    try {
      event = this.verifyAndParse(rawBody, signature, timestamp);
    } catch (error) {
      this.logger.error(`Signature verification failed: ${error.message}`);
      await this.storeFailedWebhook(rawBody.toString('utf-8'), 'unknown', error as Error);
      return; // Never rethrow
    }

    try {
      const isDuplicate = await this.isDuplicateEvent(event.id);
      if (isDuplicate) {
        this.logger.log(`Duplicate event ${event.id}, skipping`);
        return;
      }
      await this.routeEvent(event);
      await this.recordProcessedEvent(event);
    } catch (error) {
      this.logger.error(`Handler error for ${event.type}: ${error.message}`, error.stack);
      await this.storeFailedWebhook(rawBody.toString('utf-8'), event.type, error as Error);
      // Never rethrow - controller must return 200
    }
  }

  private verifyAndParse(rawBody: Buffer, signature: string, timestamp: string): ProviderEvent {
    // Use SDK verification (see signature-verification.md) or manual HMAC
    // Example: providerSdk.webhooks.unmarshal(rawBody.toString(), signature, this.webhookSecret)
    const parsed = JSON.parse(rawBody.toString('utf-8'));
    return {
      id: parsed.event_id ?? parsed.id,
      type: parsed.event_type ?? parsed.type,
      occurredAt: parsed.occurred_at ?? parsed.created,
      data: parsed.data ?? parsed,
    };
  }

  private async routeEvent(event: ProviderEvent): Promise<void> {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.activated':
        await this.subscriptionService.handleSubscriptionCreated(event.data);
        break;
      case 'subscription.updated':
        await this.subscriptionService.handleSubscriptionUpdated(event.data);
        break;
      case 'subscription.canceled':
      case 'subscription.expired':
        await this.subscriptionService.handleSubscriptionCanceled(event.data);
        break;
      case 'payment.completed':
        await this.paymentService.handlePaymentCompleted(event.data);
        break;
      case 'payment.failed':
        await this.paymentService.handlePaymentFailed(event.data);
        break;
      default:
        this.logger.warn(`Unhandled event type: ${event.type}`);
    }
  }

  private async isDuplicateEvent(eventId: string): Promise<boolean> {
    const existing = await this.prisma.processedWebhookEvent.findUnique({
      where: { eventId },
    });
    return existing !== null;
  }

  private async recordProcessedEvent(event: ProviderEvent): Promise<void> {
    await this.prisma.processedWebhookEvent.create({
      data: { eventId: event.id, eventType: event.type, processedAt: new Date() },
    });
  }

  private async storeFailedWebhook(rawPayload: string, eventType: string, error: Error): Promise<void> {
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
      this.logger.error(`CRITICAL: Could not store failed webhook: ${storageError.message}`);
    }
  }
}
```

## Layer 3: Business Service (Domain Logic)

One handler method per event type. Use transactions for multi-step operations. Emit domain events after core logic succeeds.

```typescript
// src/services/subscription.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleSubscriptionCreated(data: Record<string, unknown>): Promise<void> {
    const externalId = data['id'] as string;
    const customerId = data['customer_id'] as string;

    const subscription = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { externalCustomerId: customerId } });
      if (!user) throw new Error(`No user found for customer ${customerId}`);

      return tx.subscription.upsert({
        where: { externalId },
        create: {
          externalId,
          userId: user.id,
          planId: data['plan_id'] as string,
          status: 'active',
          currentPeriodEnd: new Date(data['current_period_end'] as string),
        },
        update: {
          status: 'active',
          planId: data['plan_id'] as string,
          currentPeriodEnd: new Date(data['current_period_end'] as string),
        },
      });
    });

    this.eventEmitter.emit('subscription.activated', { subscriptionId: subscription.id });
    this.logger.log(`Subscription created: ${subscription.id}`);
  }

  async handleSubscriptionUpdated(data: Record<string, unknown>): Promise<void> {
    const externalId = data['id'] as string;
    await this.prisma.subscription.update({
      where: { externalId },
      data: {
        planId: data['plan_id'] as string,
        status: data['status'] as string,
        currentPeriodEnd: new Date(data['current_period_end'] as string),
      },
    });
    this.logger.log(`Subscription updated: ${externalId}`);
  }

  async handleSubscriptionCanceled(data: Record<string, unknown>): Promise<void> {
    const externalId = data['id'] as string;
    await this.prisma.subscription.update({
      where: { externalId },
      data: { status: 'canceled', canceledAt: new Date() },
    });
    this.logger.log(`Subscription canceled: ${externalId}`);
  }
}
```

## Module Setup

```typescript
// src/webhooks/webhook.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../prisma/prisma.module';
import { ProviderWebhookController } from './provider-webhook.controller';
import { ProviderWebhookService } from './provider-webhook.service';
import { SubscriptionService } from '../services/subscription.service';
import { PaymentService } from '../services/payment.service';

@Module({
  imports: [ConfigModule, PrismaModule, EventEmitterModule.forRoot(), ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
  controllers: [ProviderWebhookController],
  providers: [ProviderWebhookService, SubscriptionService, PaymentService],
})
export class WebhookModule {}
```

## Prisma Schema Models

```prisma
model ProcessedWebhookEvent {
  id          String   @id @default(cuid())
  eventId     String   @unique
  eventType   String
  processedAt DateTime

  @@index([eventType])
  @@map("processed_webhook_events")
}

model FailedWebhook {
  id           String    @id @default(cuid())
  eventType    String
  rawPayload   String    @db.Text
  errorMessage String
  stackTrace   String    @db.Text
  attemptedAt  DateTime
  retryCount   Int       @default(0)
  resolved     Boolean   @default(false)
  resolvedAt   DateTime?

  @@index([resolved, attemptedAt])
  @@index([eventType])
  @@map("failed_webhooks")
}
```

## File Structure

```
src/
├── main.ts                              # rawBody: true, exclude webhooks from prefix
├── app/
│   └── app.module.ts                    # Import WebhookModule
├── webhooks/
│   ├── webhook.module.ts                # Wire controller + services
│   ├── provider-webhook.controller.ts   # Layer 1: HTTP concerns
│   └── provider-webhook.service.ts      # Layer 2: Verify, parse, route
├── services/
│   ├── subscription.service.ts          # Layer 3: Subscription domain logic
│   └── payment.service.ts              # Layer 3: Payment domain logic
└── prisma/
    ├── prisma.module.ts
    ├── prisma.service.ts
    └── schema.prisma                    # FailedWebhook + ProcessedWebhookEvent models
```

## Testing Strategy

### Unit Test: Webhook Service

```typescript
describe('ProviderWebhookService', () => {
  let service: ProviderWebhookService;
  let prisma: jest.Mocked<PrismaService>;
  let subscriptionService: jest.Mocked<SubscriptionService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProviderWebhookService,
        { provide: ConfigService, useValue: { getOrThrow: () => 'secret' } },
        {
          provide: PrismaService,
          useValue: {
            processedWebhookEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
            failedWebhook: { create: jest.fn() },
          },
        },
        {
          provide: SubscriptionService,
          useValue: { handleSubscriptionCreated: jest.fn() },
        },
        { provide: PaymentService, useValue: { handlePaymentCompleted: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProviderWebhookService);
    prisma = module.get(PrismaService);
    subscriptionService = module.get(SubscriptionService);
  });

  it('should skip duplicate events', async () => {
    prisma.processedWebhookEvent.findUnique.mockResolvedValue({ id: '1', eventId: 'evt_123', eventType: 'test', processedAt: new Date() });
    await service.processWebhook(Buffer.from(JSON.stringify({ id: 'evt_123', type: 'subscription.created', data: {} })), 'sig', 'ts');
    expect(subscriptionService.handleSubscriptionCreated).not.toHaveBeenCalled();
  });

  it('should store failure on handler error', async () => {
    subscriptionService.handleSubscriptionCreated.mockRejectedValue(new Error('DB error'));
    await service.processWebhook(Buffer.from(JSON.stringify({ id: 'evt_456', type: 'subscription.created', data: {} })), 'sig', 'ts');
    expect(prisma.failedWebhook.create).toHaveBeenCalled();
  });
});
```

### Integration Test: Controller

```typescript
describe('Webhook Controller (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(() => app.close());

  it('should return 200 even with invalid signature', async () => {
    const res = await request(app.getHttpServer()).post('/webhooks/provider-name').set('x-provider-signature', 'invalid').send({ id: 'test', type: 'test', data: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('should return received:false without signature', async () => {
    const res = await request(app.getHttpServer()).post('/webhooks/provider-name').send({ id: 'test', type: 'test', data: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: false });
  });
});
```
