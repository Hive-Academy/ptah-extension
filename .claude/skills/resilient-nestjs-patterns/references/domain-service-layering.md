# Domain Service Layering Pattern

## Overview

The 3-tier layering pattern separates a domain into Controller (HTTP concerns), Service (business logic), and DbService (data access). Each tier has a single responsibility and depends only on the tier below it.

## The Problem

Controllers that call Prisma directly and mix HTTP response formatting with business rules:

```typescript
// Anti-pattern: controller with mixed concerns
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@Body() dto: CreateSubscriptionDto, @Req() req: Request) {
    const userId = req.user.sub; // HTTP concern
    const count = await this.prisma.subscription.count({
      // Data access
      where: { userId },
    });
    if (count >= 3) throw new BadRequestException('Max 3'); // Business rule
    const result = await this.prisma.$transaction(async (tx) => {
      // Transaction
      // ... mixed data + business logic
    });
    return { id: result.id, createdAt: result.createdAt.toISOString() }; // Response mapping
  }
}
```

## The 3-Tier Pattern

```
Request -> Controller -> Service -> DbService -> Database
```

| Tier       | Responsibility                                    | Does NOT Contain                   |
| ---------- | ------------------------------------------------- | ---------------------------------- |
| Controller | HTTP parsing, guards, response status codes       | Business rules, Prisma calls       |
| Service    | Business rules, validation, orchestration, events | HTTP objects, direct Prisma access |
| DbService  | Prisma queries, transactions, data mapping        | Business rules, HTTP concerns      |

## Implementation

### DbService: Data Access Layer

```typescript
// libs/billing/src/lib/services/subscription-db.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@my-org/shared/prisma-client';
import { Subscription, SubscriptionStatus } from '@prisma/client';

@Injectable()
export class SubscriptionDbService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countActiveByUserId(userId: string): Promise<number> {
    return this.prisma.subscription.count({ where: { userId, status: 'ACTIVE' } });
  }

  async createWithUserUpdate(data: { userId: string; plan: string; externalId: string; status: SubscriptionStatus }): Promise<Subscription> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({ data });
      await tx.user.update({
        where: { id: data.userId },
        data: { activeSubscriptionId: subscription.id },
      });
      return subscription;
    });
  }

  async cancelWithUserUpdate(id: string, userId: string): Promise<Subscription> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.update({
        where: { id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
      await tx.user.update({
        where: { id: userId },
        data: { activeSubscriptionId: null },
      });
      return subscription;
    });
  }
}
```

### Service: Business Logic Layer

```typescript
// libs/billing/src/lib/services/subscription.service.ts
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionDbService } from './subscription-db.service';

const MAX_ACTIVE_SUBSCRIPTIONS = 3;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly dbService: SubscriptionDbService,
    private readonly paymentService: PaymentService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createSubscription(userId: string, plan: string): Promise<SubscriptionResponse> {
    // Business rule: enforce subscription limit
    const activeCount = await this.dbService.countActiveByUserId(userId);
    if (activeCount >= MAX_ACTIVE_SUBSCRIPTIONS) {
      throw new BadRequestException(`Maximum ${MAX_ACTIVE_SUBSCRIPTIONS} active subscriptions allowed`);
    }

    const payment = await this.paymentService.createSubscription({ userId, plan });
    const subscription = await this.dbService.createWithUserUpdate({
      userId,
      plan,
      externalId: payment.externalId,
      status: 'ACTIVE',
    });

    this.eventEmitter.emit('subscription.created', { userId, subscriptionId: subscription.id, plan });
    return this.toResponse(subscription);
  }

  async cancelSubscription(userId: string, subscriptionId: string): Promise<SubscriptionResponse> {
    const subscription = await this.dbService.findById(subscriptionId);
    if (!subscription) throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    if (subscription.userId !== userId) throw new BadRequestException("Cannot cancel another user's subscription");
    if (subscription.status === 'CANCELED') throw new BadRequestException('Already canceled');

    await this.paymentService.cancelSubscription(subscription.externalId);
    const updated = await this.dbService.cancelWithUserUpdate(subscriptionId, userId);

    this.eventEmitter.emit('subscription.canceled', { userId, subscriptionId });
    return this.toResponse(updated);
  }

  async getUserSubscriptions(userId: string): Promise<SubscriptionResponse[]> {
    const subscriptions = await this.dbService.findByUserId(userId);
    return subscriptions.map((s) => this.toResponse(s));
  }

  private toResponse(sub: Subscription): SubscriptionResponse {
    return {
      id: sub.id,
      plan: sub.plan,
      status: sub.status,
      createdAt: sub.createdAt.toISOString(),
      canceledAt: sub.canceledAt?.toISOString() ?? null,
    };
  }
}
```

### Controller: HTTP Layer

```typescript
// libs/billing/src/lib/controllers/subscription.controller.ts
import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, CurrentUser, JwtPayload } from '@my-org/shared/auth';
import { SubscriptionService } from '../services/subscription.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: JwtPayload) {
    return this.subscriptionService.createSubscription(user.sub, dto.plan);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.subscriptionService.getUserSubscriptions(user.sub);
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.subscriptionService.cancelSubscription(user.sub, id);
  }
}
```

## When to Use

- **Complex queries**: Prisma queries with joins, aggregations, or raw SQL
- **Business rules**: Validation beyond DTO pipes (plan limits, ownership, state transitions)
- **Transactions**: Multiple database operations that must succeed atomically
- **Reuse**: Multiple controllers or services need the same data access methods

## When NOT to Use

- **Simple CRUD**: No business rules, trivial queries -- Service can call Prisma directly
- **Small domain**: Total code under 150 lines across all three files
- **No transactions**: All operations are single Prisma calls

## Transaction Patterns

Transactions live in the DbService. The Service validates, the DbService executes:

```typescript
// Service: validates business rules
async transferCredits(fromUserId: string, toUserId: string, amount: number): Promise<void> {
  if (amount <= 0) throw new BadRequestException('Amount must be positive');
  const sender = await this.dbService.findUserOrFail(fromUserId);
  if (sender.credits < amount) throw new BadRequestException('Insufficient credits');
  await this.dbService.transferCredits(fromUserId, toUserId, amount);
}

// DbService: executes the transaction
async transferCredits(fromId: string, toId: string, amount: number): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: fromId }, data: { credits: { decrement: amount } } });
    await tx.user.update({ where: { id: toId }, data: { credits: { increment: amount } } });
  });
}
```

## Testing Each Tier

### DbService (Integration Test)

```typescript
describe('SubscriptionDbService', () => {
  it('should create subscription and update user in transaction', async () => {
    const user = await prisma.user.create({ data: { email: 'test@example.com' } });
    const result = await dbService.createWithUserUpdate({
      userId: user.id,
      plan: 'pro',
      externalId: 'ext-1',
      status: 'ACTIVE',
    });
    expect(result.plan).toBe('pro');
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.activeSubscriptionId).toBe(result.id);
  });
});
```

### Service (Unit Test with Mocked DbService)

```typescript
describe('SubscriptionService', () => {
  it('should reject when subscription limit reached', async () => {
    dbService.countActiveByUserId.mockResolvedValue(3);
    await expect(service.createSubscription('user-1', 'pro')).rejects.toThrow(BadRequestException);
  });
});
```

### Controller (E2E)

```typescript
it('should return 201 on successful creation', async () => {
  const response = await request(app.getHttpServer()).post('/subscriptions').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' }).expect(201);
  expect(response.body).toHaveProperty('id');
});
```

## File Organization

```
libs/billing/src/lib/
├── controllers/
│   └── subscription.controller.ts     # Thin HTTP layer
├── services/
│   ├── subscription.service.ts        # Business logic
│   └── subscription-db.service.ts     # Data access
├── dto/
│   └── create-subscription.dto.ts
├── billing.module.ts
└── index.ts
```

## Key Rules

1. **Controllers never import PrismaService** -- data goes through the Service.
2. **Services never access `request` or `response`** -- HTTP is the controller's job.
3. **DbService never throws business exceptions** -- it returns data or null. The Service decides what null means.
4. **Transactions are a DbService concern** -- the Service calls one DbService method that internally uses `$transaction`.
5. **Response mapping happens once** -- in the Service's `toResponse()`, not scattered across controllers.
