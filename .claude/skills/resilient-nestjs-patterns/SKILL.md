---
name: resilient-nestjs-patterns
description: 'Production-ready NestJS architectural patterns for service orchestration, domain layering, resilient external communication, event-driven architecture, and dynamic module design. Use when decomposing complex services into single-responsibility units, implementing orchestrator patterns, building Controller-Service-DbService layering, adding retry with exponential backoff, implementing fallback strategies, setting up NestJS EventEmitter with SSE (Server-Sent Events), creating event listeners for async side-effects, designing dynamic modules with forRoot/forTesting patterns, or configuring environment-driven provider selection.'
---

# Resilient NestJS Patterns

Five interconnected architectural patterns that take a NestJS backend from prototype to production. These patterns address the structural and reliability concerns that emerge once basic CRUD, auth, and third-party integration are in place.

## Activation scope

This skill activates **per-module during Stage B** of the SaaS bootstrap — typically when implementing a Resilience & Events roadmap item or hardening a specific domain module. It is NOT bundled into the Stage A foundation scaffold; `saas-workspace-initializer` deliberately leaves orchestration, retries, SSE, and dynamic-module wiring out of the foundation so each pattern lands with real domain context.

## When You Need These Patterns

- A service file has grown past 500 lines and handles unrelated concerns
- Controllers contain business logic mixed with HTTP plumbing
- External API calls fail silently or crash the request pipeline
- Side-effects (emails, cache invalidation, audit logs) are tangled into core business methods
- Module configuration is duplicated across environments and test suites

## Pattern Quick Reference

| Pattern                   | Use Case                                                     | Reference                                                               |
| ------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Service Orchestration     | Complex domain with multiple cooperating services            | [service-orchestration.md](references/service-orchestration.md)         |
| Domain Service Layering   | Clean separation of HTTP, business, and data concerns        | [domain-service-layering.md](references/domain-service-layering.md)     |
| Retry and Fallback        | Resilient external service communication                     | [retry-and-fallback.md](references/retry-and-fallback.md)               |
| Event-Driven Architecture | Async side-effects and real-time updates via SSE             | [event-driven-architecture.md](references/event-driven-architecture.md) |
| Dynamic Modules           | Configurable, testable module design with forRoot/forTesting | [dynamic-modules.md](references/dynamic-modules.md)                     |

## Pattern Selection Guide

Use this decision tree to determine which pattern applies to your current problem.

### Is the problem about code organization?

**Yes, a single service does too much:**

- Methods group into 3+ unrelated clusters -> **Service Orchestration**
- The service is hard to test because mocking requires 8+ dependencies -> **Service Orchestration**

**Yes, controllers contain business logic:**

- Controllers call Prisma directly -> **Domain Service Layering**
- Business rules live alongside HTTP response mapping -> **Domain Service Layering**
- Transaction management is scattered across controllers -> **Domain Service Layering**

### Is the problem about reliability?

**External API calls fail unpredictably:**

- Transient errors (timeouts, 503s) should be retried -> **Retry and Fallback** (retry with backoff)
- A local data source can serve as backup -> **Retry and Fallback** (fallback strategy)
- High call volume with potential provider downtime -> **Retry and Fallback** (circuit breaker)

### Is the problem about coupling?

**Side-effects are tangled into business methods:**

- Sending emails after subscription creation -> **Event-Driven Architecture**
- Invalidating caches after data updates -> **Event-Driven Architecture**
- Broadcasting real-time updates to connected clients -> **Event-Driven Architecture** (SSE)

### Is the problem about configuration?

**Module setup varies across environments:**

- Production uses real SDK, tests need mocks -> **Dynamic Modules** (forRoot/forTesting)
- Provider selection depends on environment variables -> **Dynamic Modules** (environment-driven)
- A module is imported everywhere with the same config -> **Dynamic Modules** (global modules)

## How Patterns Compose

These patterns are not isolated. In a real module, they layer together:

```
Controller (thin HTTP layer)                    [Domain Service Layering]
  |
  v
BusinessService (orchestrator)                  [Service Orchestration]
  |-- DbService (data access, transactions)     [Domain Service Layering]
  |-- ExternalApiService (retry + fallback)     [Retry and Fallback]
  |-- EventEmitter (async side-effects)         [Event-Driven Architecture]
        |
        v
      EventListener -> SSE broadcast            [Event-Driven Architecture]
```

### Composed Example: Subscription Domain

```typescript
// Controller: thin HTTP, delegates everything
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  async create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: JwtPayload) {
    return this.subscriptionService.createSubscription(user.sub, dto);
  }
}

// Service: orchestrates business logic
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly dbService: SubscriptionDbService, // Data layer
    private readonly paymentService: PaymentService, // External (retry/fallback)
    private readonly eventEmitter: EventEmitter2, // Async side-effects
  ) {}

  async createSubscription(userId: string, dto: CreateSubscriptionDto) {
    const user = await this.dbService.findUserOrFail(userId);

    // External call with retry built into PaymentService
    const payment = await this.paymentService.createSubscription({
      customerId: user.paymentCustomerId,
      priceId: dto.priceId,
    });

    // Transactional database write
    const subscription = await this.dbService.createWithTransaction(userId, payment);

    // Fire-and-forget side-effects
    this.eventEmitter.emit('subscription.created', {
      userId,
      subscriptionId: subscription.id,
      plan: dto.priceId,
    });

    return subscription;
  }
}

// DbService: pure data access
@Injectable()
export class SubscriptionDbService {
  constructor(private readonly prisma: PrismaService) {}

  async createWithTransaction(userId: string, payment: PaymentResult) {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: { userId, externalId: payment.id, status: 'ACTIVE', plan: payment.plan },
      });
      await tx.user.update({
        where: { id: userId },
        data: { subscriptionId: subscription.id },
      });
      return subscription;
    });
  }
}

// Event listener: async side-effect
@Injectable()
export class SubscriptionEventListener {
  constructor(
    private readonly emailService: EmailService,
    private readonly eventsService: EventsService,
  ) {}

  @OnEvent('subscription.created')
  async handleSubscriptionCreated(payload: SubscriptionCreatedEvent) {
    await this.emailService.sendWelcomeEmail(payload.userId);
    this.eventsService.broadcast(payload.userId, {
      type: 'subscription.created',
      data: { subscriptionId: payload.subscriptionId },
    });
  }
}
```

### Module Wiring with Dynamic Module

```typescript
@Module({})
export class SubscriptionModule {
  static forRoot(): DynamicModule {
    return {
      module: SubscriptionModule,
      imports: [PaymentModule.forRoot(), EventEmitterModule.forRoot()],
      controllers: [SubscriptionController, SubscriptionSseController],
      providers: [SubscriptionService, SubscriptionDbService, SubscriptionEventListener, EventsService],
      exports: [SubscriptionService],
    };
  }

  static forTesting(): DynamicModule {
    return {
      module: SubscriptionModule,
      imports: [PaymentModule.forTesting()],
      providers: [SubscriptionService, SubscriptionDbService, SubscriptionEventListener, { provide: EventsService, useValue: { broadcast: jest.fn() } }],
      exports: [SubscriptionService],
    };
  }
}
```

## Pattern Adoption Order

When refactoring an existing codebase, adopt patterns in this order:

1. **Domain Service Layering** first -- separate controllers from business logic and data access. This is the foundation that makes everything else possible.
2. **Service Orchestration** second -- once layering is in place, decompose large services into focused units with an orchestrator.
3. **Retry and Fallback** third -- wrap external calls with resilience. This is independent of the others and can be adopted at any time.
4. **Event-Driven Architecture** fourth -- extract side-effects into event listeners. Requires clean service boundaries to know what events to emit.
5. **Dynamic Modules** fifth -- formalize module configuration once the module structure has stabilized.

Do not adopt all five at once. Each pattern should be justified by a real problem in the current codebase.

## Anti-Patterns to Avoid

| Anti-Pattern             | Problem                                         | Correct Pattern           |
| ------------------------ | ----------------------------------------------- | ------------------------- |
| Fat controller           | Business logic in controller methods            | Domain Service Layering   |
| God service              | Single service with 20+ methods across concerns | Service Orchestration     |
| Silent failure           | External API errors swallowed with empty catch  | Retry and Fallback        |
| Synchronous side-effects | Email sending blocks HTTP response              | Event-Driven Architecture |
| Copy-paste module config | Same providers array in 5 modules               | Dynamic Modules           |
| Premature decomposition  | Splitting a 100-line service into 5 files       | Do nothing (YAGNI)        |

## References

Load these for detailed implementation guidance:

- [service-orchestration.md](references/service-orchestration.md) - Decomposing complex services into focused units with orchestrators
- [domain-service-layering.md](references/domain-service-layering.md) - Controller, Service, DbService separation pattern
- [retry-and-fallback.md](references/retry-and-fallback.md) - Exponential backoff, fallback strategies, circuit breakers
- [event-driven-architecture.md](references/event-driven-architecture.md) - NestJS EventEmitter, listeners, and SSE broadcasting
- [dynamic-modules.md](references/dynamic-modules.md) - forRoot/forTesting, environment-driven providers, DI tokens
