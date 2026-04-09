---
name: nestjs-backend-patterns
description: NestJS backend architecture patterns for multi-tenant SaaS applications. Use when integrating third-party services/APIs into NestJS, setting up Prisma or ZenStack, implementing multitenancy patterns, building authentication/authorization, creating provider patterns for external services, applying access control with RBAC or policies, or handling database connection and repository patterns.
---

# NestJS Backend Architecture Patterns

Patterns for building scalable, maintainable NestJS backends in an Nx monorepo.

## Core Principle: Provider Pattern for External Services

All third-party integrations follow the same provider pattern:

```typescript
// 1. Create a provider factory
export const ThirdPartyClientProvider = {
  provide: 'THIRD_PARTY_CLIENT',
  useFactory: (configService: ConfigService) => {
    return new ThirdPartySDK(configService.get('THIRD_PARTY_API_KEY'));
  },
  inject: [ConfigService],
};

// 2. Create a service that wraps the client
@Injectable()
export class ThirdPartyService {
  constructor(@Inject('THIRD_PARTY_CLIENT') private client: ThirdPartySDK) {}

  async doSomething() {
    return this.client.operation();
  }
}

// 3. Create a module that exports the service
@Module({
  imports: [ConfigModule],
  providers: [ThirdPartyClientProvider, ThirdPartyService],
  exports: [ThirdPartyService],
})
export class ThirdPartyModule {}
```

## Quick Reference

| Pattern            | Use Case                            | Reference                                                           |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| Provider Pattern   | Third-party API integration         | [third-party-integration.md](references/third-party-integration.md) |
| Multitenancy       | Shared schema with tenant isolation | [multitenancy.md](references/multitenancy.md)                       |
| Prisma + ZenStack  | ORM with declarative access control | [prisma-zenstack.md](references/prisma-zenstack.md)                 |
| RBAC               | Role-based authorization            | [authorization.md](references/authorization.md)                     |
| JWT Authentication | Stateless auth with Passport        | [authentication.md](references/authentication.md)                   |

## Third-Party Integration Pattern

### Step 1: Provider Factory

```typescript
// libs/shared/payments/src/lib/payment-client.provider.ts
import { ConfigService } from '@nestjs/config';

export const PaymentClientProvider = {
  provide: 'PAYMENT_CLIENT',
  useFactory: (config: ConfigService) => {
    const provider = config.get('PAYMENT_PROVIDER'); // 'stripe', 'paddle', etc.
    const apiKey = config.get('PAYMENT_API_KEY');

    // Factory returns appropriate client based on config
    switch (provider) {
      case 'stripe':
        return new StripeClient(apiKey);
      case 'paddle':
        return new PaddleClient(apiKey);
      default:
        throw new Error(`Unknown payment provider: ${provider}`);
    }
  },
  inject: [ConfigService],
};
```

### Step 2: Abstract Service Interface

```typescript
// libs/shared/payments/src/lib/payment.interface.ts
export interface PaymentClient {
  createCustomer(data: CreateCustomerDto): Promise<Customer>;
  createSubscription(data: CreateSubscriptionDto): Promise<Subscription>;
  cancelSubscription(id: string): Promise<void>;
  handleWebhook(payload: Buffer, signature: string): Promise<WebhookEvent>;
}
```

### Step 3: Service Implementation

```typescript
// libs/shared/payments/src/lib/payment.service.ts
@Injectable()
export class PaymentService {
  constructor(@Inject('PAYMENT_CLIENT') private client: PaymentClient) {}

  async createCustomer(dto: CreateCustomerDto): Promise<Customer> {
    return this.client.createCustomer(dto);
  }

  async createSubscription(dto: CreateSubscriptionDto): Promise<Subscription> {
    return this.client.createSubscription(dto);
  }
}
```

## Multitenancy Pattern (Shared Schema)

```typescript
// Context-aware Prisma service using CLS (Continuation Local Storage)
@Injectable()
export class TenantAwarePrismaService {
  constructor(
    private prisma: PrismaService,
    private cls: ClsService,
  ) {}

  get client() {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new UnauthorizedException('No tenant context');
    }

    // Return enhanced client with tenant filter
    return enhance(this.prisma, { user: { tenantId } });
  }
}
```

## Module Organization

```
libs/
├── shared/
│   ├── prisma-client/        # Prisma + ZenStack setup
│   │   ├── prisma.service.ts
│   │   ├── enhanced-prisma.service.ts
│   │   └── prisma-client.module.ts
│   ├── auth/                 # Authentication infrastructure
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   └── auth.module.ts
│   └── [service-name]/       # Third-party integrations
│       ├── [name]-client.provider.ts
│       ├── [name].service.ts
│       └── [name].module.ts
└── [domain]/
    └── feature-api/
        ├── controllers/
        ├── dto/
        └── [domain].module.ts
```

## Decision Matrix

| Need                  | Pattern                     | Reference                                                           |
| --------------------- | --------------------------- | ------------------------------------------------------------------- |
| Payment processing    | Provider pattern            | [third-party-integration.md](references/third-party-integration.md) |
| External auth (OAuth) | Provider pattern + Passport | [authentication.md](references/authentication.md)                   |
| Email service         | Provider pattern            | [third-party-integration.md](references/third-party-integration.md) |
| File storage          | Provider pattern            | [third-party-integration.md](references/third-party-integration.md) |
| Tenant isolation      | ZenStack policies           | [multitenancy.md](references/multitenancy.md)                       |
| Role-based access     | Guards + decorators         | [authorization.md](references/authorization.md)                     |

## References

Load these for detailed implementation guidance:

- [third-party-integration.md](references/third-party-integration.md) - Generic pattern for any external service
- [multitenancy.md](references/multitenancy.md) - Multi-tenant architecture patterns
- [prisma-zenstack.md](references/prisma-zenstack.md) - ORM setup with access policies
- [authorization.md](references/authorization.md) - RBAC and permission patterns
- [authentication.md](references/authentication.md) - JWT and OAuth patterns
