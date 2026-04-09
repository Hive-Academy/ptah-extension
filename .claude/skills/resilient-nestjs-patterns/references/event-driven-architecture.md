# Event-Driven Architecture Pattern

## Overview

Side-effects like sending emails, invalidating caches, updating analytics, and broadcasting real-time updates should not block the main business operation. This pattern decouples core actions from their consequences using NestJS EventEmitter and Server-Sent Events (SSE).

## Setup

```bash
npm install @nestjs/event-emitter
```

```typescript
// apps/api/src/app/app.module.ts
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true, // Enable subscription.* listeners
      delimiter: '.',
      maxListeners: 20,
    }),
  ],
})
export class AppModule {}
```

## Defining Typed Events

```typescript
// libs/shared/events/src/lib/subscription.events.ts
export class SubscriptionCreatedEvent {
  static readonly eventName = 'subscription.created' as const;
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string,
    public readonly plan: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}

export class SubscriptionCanceledEvent {
  static readonly eventName = 'subscription.canceled' as const;
  constructor(
    public readonly userId: string,
    public readonly subscriptionId: string,
    public readonly reason: string | null,
    public readonly timestamp: Date = new Date(),
  ) {}
}
```

### Event Name Registry

A central registry prevents typos and makes events discoverable:

```typescript
export const EventNames = {
  subscription: { created: 'subscription.created', canceled: 'subscription.canceled', renewed: 'subscription.renewed' },
  user: { registered: 'user.registered', deleted: 'user.deleted' },
  payment: { succeeded: 'payment.succeeded', failed: 'payment.failed' },
} as const;
```

## Emitting Events

Emit after the core operation succeeds. Never emit inside a transaction -- if it rolls back, the event has already fired.

```typescript
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly dbService: SubscriptionDbService,
    private readonly paymentService: PaymentService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createSubscription(userId: string, plan: string): Promise<Subscription> {
    const payment = await this.paymentService.createSubscription({ userId, plan });
    const subscription = await this.dbService.createWithUserUpdate({
      userId,
      plan,
      externalId: payment.externalId,
      status: 'ACTIVE',
    });

    // Emit AFTER successful persistence
    this.eventEmitter.emit(SubscriptionCreatedEvent.eventName, new SubscriptionCreatedEvent(userId, subscription.id, plan));

    return subscription;
  }
}
```

## Event Listeners

Each listener handles one side-effect. Listeners must catch their own errors.

### Email Notification

```typescript
@Injectable()
export class SubscriptionEmailListener {
  private readonly logger = new Logger(SubscriptionEmailListener.name);
  constructor(private readonly emailService: EmailService) {}

  @OnEvent('subscription.created')
  async handleCreated(event: SubscriptionCreatedEvent): Promise<void> {
    try {
      await this.emailService.send({
        to: event.userId,
        template: 'subscription-welcome',
        data: { plan: event.plan, subscriptionId: event.subscriptionId },
      });
    } catch (error) {
      // Log but do NOT rethrow -- side-effect failure must not break the emitter
      this.logger.error(`Failed to send welcome email for ${event.subscriptionId}`, error);
    }
  }
}
```

### Audit Log (Wildcard)

```typescript
@Injectable()
export class SubscriptionAuditListener {
  private readonly logger = new Logger(SubscriptionAuditListener.name);
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('subscription.*')
  async handleAny(event: SubscriptionEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entityType: 'SUBSCRIPTION',
          entityId: event.subscriptionId,
          action: event.constructor.name,
          userId: event.userId,
          metadata: JSON.parse(JSON.stringify(event)),
          timestamp: event.timestamp,
        },
      });
    } catch (error) {
      this.logger.error('Failed to write audit log', error);
    }
  }
}
```

### Cache Invalidation

```typescript
@Injectable()
export class SubscriptionCacheListener {
  constructor(private readonly cacheService: CacheService) {}

  @OnEvent('subscription.*')
  async invalidate(event: SubscriptionEvent): Promise<void> {
    try {
      await this.cacheService.delete(`user:${event.userId}:subscription`);
    } catch {
      /* Non-critical */
    }
  }
}
```

## Server-Sent Events (SSE)

SSE pushes real-time updates to connected clients over HTTP.

### EventsService: Connection Management

```typescript
// libs/shared/events/src/lib/events.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable, filter, map } from 'rxjs';

export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly stream = new Subject<{ userId: string; event: SseEvent }>();

  getStreamForUser(userId: string): Observable<MessageEvent> {
    return this.stream.pipe(
      filter((e) => e.userId === userId),
      map((e) => ({ type: e.event.type, data: JSON.stringify(e.event.data) }) as MessageEvent),
    );
  }

  broadcast(userId: string, event: SseEvent): void {
    this.stream.next({ userId, event });
    this.logger.debug(`Broadcast ${event.type} to user ${userId}`);
  }
}
```

### SSE Controller

```typescript
import { Controller, Sse, UseGuards, MessageEvent } from '@nestjs/common';
import { Observable, interval, mergeWith, map } from 'rxjs';
import { JwtAuthGuard, CurrentUser, JwtPayload } from '@my-org/shared/auth';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Sse('stream')
  stream(@CurrentUser() user: JwtPayload): Observable<MessageEvent> {
    const heartbeat$ = interval(30_000).pipe(map(() => ({ type: 'heartbeat', data: JSON.stringify({ ts: new Date().toISOString() }) }) as MessageEvent));
    const events$ = this.eventsService.getStreamForUser(user.sub);
    return events$.pipe(mergeWith(heartbeat$));
  }
}
```

### SSE Broadcast Listener

```typescript
@Injectable()
export class SubscriptionSseListener {
  constructor(private readonly eventsService: EventsService) {}

  @OnEvent('subscription.created')
  handleCreated(event: SubscriptionCreatedEvent): void {
    this.eventsService.broadcast(event.userId, {
      type: 'subscription.created',
      data: { subscriptionId: event.subscriptionId, plan: event.plan },
    });
  }
}
```

### Frontend Consumption

```typescript
// Angular service
@Injectable({ providedIn: 'root' })
export class SseService {
  connect(baseUrl: string): Observable<SseEvent> {
    return new Observable((subscriber) => {
      const source = new EventSource(`${baseUrl}/events/stream`);
      source.addEventListener('subscription.created', (e) => {
        subscriber.next({ type: 'subscription.created', data: JSON.parse(e.data) });
      });
      source.onerror = () => subscriber.error(new Error('SSE connection lost'));
      return () => source.close();
    });
  }
}
```

## Events vs Direct Calls

| Scenario                       | Approach | Reason                                 |
| ------------------------------ | -------- | -------------------------------------- |
| Send email after signup        | Event    | Side-effect, can fail independently    |
| Validate payment before action | Direct   | Must succeed for operation to complete |
| Invalidate cache after update  | Event    | Cross-cutting, non-critical            |
| Calculate subscription price   | Direct   | Synchronous, must return value         |
| Write audit log                | Event    | Async, must not block response         |

**Rule: If the result is needed for the operation, use a direct call. If it is a consequence, use an event.**

## Error Handling in Listeners

For critical side-effects that must eventually succeed, combine events with retry:

```typescript
@OnEvent('subscription.created')
async handleCreated(event: SubscriptionCreatedEvent): Promise<void> {
  try {
    await withRetry(
      () => this.emailService.sendWelcomeEmail(event.userId),
      { maxAttempts: 3, baseDelayMs: 2000 },
    );
  } catch (error) {
    this.logger.error(`Welcome email permanently failed for ${event.subscriptionId}`);
    await this.failedJobService.create({ type: 'welcome_email', payload: event, error: String(error) });
  }
}
```

## Module Wiring

```typescript
@Module({
  imports: [EventEmitterModule.forRoot(), SharedEventsModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionDbService, SubscriptionEmailListener, SubscriptionAuditListener, SubscriptionCacheListener, SubscriptionSseListener],
  exports: [SubscriptionService],
})
export class BillingModule {}

@Module({
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class SharedEventsModule {}
```

## Testing

### Event Emission

```typescript
describe('SubscriptionService', () => {
  it('should emit subscription.created after successful creation', async () => {
    const eventEmitter = module.get(EventEmitter2) as jest.Mocked<EventEmitter2>;
    await service.createSubscription('user-1', 'pro');
    expect(eventEmitter.emit).toHaveBeenCalledWith('subscription.created', expect.objectContaining({ userId: 'user-1', plan: 'pro' }));
  });
});
```

### Listeners

```typescript
describe('SubscriptionEmailListener', () => {
  it('should send welcome email', async () => {
    await listener.handleCreated(new SubscriptionCreatedEvent('user-1', 'sub-1', 'pro'));
    expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'user-1', template: 'subscription-welcome' }));
  });

  it('should not throw when email fails', async () => {
    emailService.send.mockRejectedValue(new Error('SMTP down'));
    await expect(listener.handleCreated(new SubscriptionCreatedEvent('u', 's', 'p'))).resolves.not.toThrow();
  });
});
```
