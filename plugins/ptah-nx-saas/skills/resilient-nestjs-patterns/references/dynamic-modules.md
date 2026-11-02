# Dynamic Module Patterns

## Overview

NestJS dynamic modules enable configurable, testable module design. The `forRoot`/`forTesting` pattern provides different providers for different environments, while DI tokens decouple consumers from concrete implementations.

## Pattern 1: forRoot / forTesting

```typescript
// libs/shared/payments/src/lib/payment.module.ts
import { Module, DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { PAYMENT_CLIENT } from './payment.tokens';
import { PaymentClientProvider } from './payment-client.provider';
import { IPaymentClient } from './payment.interface';

@Module({})
export class PaymentModule {
  static forRoot(): DynamicModule {
    return {
      module: PaymentModule,
      imports: [ConfigModule],
      providers: [PaymentClientProvider, PaymentService],
      exports: [PaymentService, PAYMENT_CLIENT],
    };
  }

  static forTesting(mockClient?: Partial<IPaymentClient>): DynamicModule {
    const defaultMock: IPaymentClient = {
      createCustomer: async () => ({ id: 'cust_test', email: 'test@example.com' }),
      createSubscription: async () => ({ id: 'sub_test', status: 'active', plan: 'test' }),
      cancelSubscription: async () => {},
      getSubscription: async () => ({ id: 'sub_test', status: 'active', plan: 'test', currentPeriodEnd: new Date().toISOString() }),
    };
    return {
      module: PaymentModule,
      providers: [{ provide: PAYMENT_CLIENT, useValue: { ...defaultMock, ...mockClient } }, PaymentService],
      exports: [PaymentService, PAYMENT_CLIENT],
    };
  }
}
```

### Usage

```typescript
// Production
@Module({ imports: [PaymentModule.forRoot()] })
export class AppModule {}

// Integration test
const module = await Test.createTestingModule({
  imports: [PaymentModule.forTesting({ createSubscription: async () => ({ id: 'custom', status: 'active', plan: 'pro' }) })],
  providers: [SubscriptionService],
}).compile();
```

## Pattern 2: Environment-Driven Provider Selection

A factory that reads configuration to select the implementation at runtime.

```typescript
// libs/shared/payments/src/lib/payment-client.provider.ts
export const PaymentClientProvider = {
  provide: PAYMENT_CLIENT,
  useFactory: async (config: ConfigService): Promise<IPaymentClient> => {
    const env = config.get<string>('PAYMENT_ENVIRONMENT', 'sandbox');
    const apiKey = config.getOrThrow<string>('PAYMENT_API_KEY');

    switch (env) {
      case 'production': {
        const { PaddleProductionClient } = await import('./clients/paddle-production.client');
        return new PaddleProductionClient(apiKey);
      }
      case 'sandbox': {
        const { PaddleSandboxClient } = await import('./clients/paddle-sandbox.client');
        return new PaddleSandboxClient(apiKey);
      }
      default:
        throw new Error(`Unknown payment environment: ${env}`);
    }
  },
  inject: [ConfigService],
};
```

This pattern applies to any external service:

```typescript
// Email: SendGrid (prod) vs console (dev)
const EmailClientProvider = {
  provide: EMAIL_CLIENT,
  useFactory: async (config: ConfigService) => {
    if (config.get('NODE_ENV') === 'production') {
      const { SendGridClient } = await import('./clients/sendgrid.client');
      return new SendGridClient(config.getOrThrow('SENDGRID_API_KEY'));
    }
    const { ConsoleEmailClient } = await import('./clients/console-email.client');
    return new ConsoleEmailClient();
  },
  inject: [ConfigService],
};
```

## Pattern 3: DI Tokens

### String Tokens (Default)

```typescript
// libs/shared/payments/src/lib/payment.tokens.ts
export const PAYMENT_CLIENT = 'PAYMENT_CLIENT';
export const EMAIL_CLIENT = 'EMAIL_CLIENT';

// Injection
@Injectable()
export class PaymentService {
  constructor(@Inject(PAYMENT_CLIENT) private readonly client: IPaymentClient) {}
}
```

### Symbol Tokens (Collision-Proof)

```typescript
export const PAYMENT_CLIENT = Symbol('PAYMENT_CLIENT');
// Usage identical: @Inject(PAYMENT_CLIENT)
```

| Token Type | Use When                                                        |
| ---------- | --------------------------------------------------------------- |
| String     | Default choice -- simple, readable                              |
| Symbol     | Multiple modules with similar names, need guaranteed uniqueness |
| Class ref  | Concrete class (NestJS default, no `@Inject` needed)            |

## Pattern 4: Global vs Scoped Modules

```typescript
// Global: infrastructure used everywhere
@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [PrismaService],
      exports: [PrismaService],
    };
  }
}
```

**Use `global: true` for:** Database, config, logging, cache.
**Do NOT use for:** Domain services, feature modules, anything not universally needed.

## Pattern 5: forRootAsync

For modules needing async configuration:

```typescript
@Module({})
export class SearchModule {
  static forRootAsync(options: { imports?: any[]; useFactory: (...args: any[]) => Promise<SearchOptions> | SearchOptions; inject?: any[] }): DynamicModule {
    return {
      module: SearchModule,
      imports: options.imports ?? [],
      providers: [{ provide: 'SEARCH_OPTIONS', useFactory: options.useFactory, inject: options.inject ?? [] }, SearchService],
      exports: [SearchService],
    };
  }
}

// Usage
SearchModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    endpoint: config.getOrThrow('SEARCH_ENDPOINT'),
    apiKey: config.getOrThrow('SEARCH_API_KEY'),
  }),
  inject: [ConfigService],
});
```

## Testing Dynamic Modules

```typescript
describe('BillingModule (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule.forRoot(), PaymentModule.forTesting(), EventEmitterModule.forRoot(), BillingModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('should create subscription end-to-end', async () => {
    await request(app.getHttpServer()).post('/subscriptions').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' }).expect(201);
  });
});
```

Override specific providers when needed:

```typescript
const module = await Test.createTestingModule({ imports: [PaymentModule.forTesting()] })
  .overrideProvider(PAYMENT_CLIENT)
  .useValue({ createSubscription: jest.fn().mockResolvedValue({ id: 'custom' }) })
  .compile();
```

## When to Use

| Scenario                       | Static Module | Dynamic Module     |
| ------------------------------ | ------------- | ------------------ |
| Fixed providers, no config     | Yes           | No                 |
| Environment-specific providers | No            | Yes (forRoot)      |
| Module-level test mocking      | No            | Yes (forTesting)   |
| Async initialization           | No            | Yes (forRootAsync) |

**Start with a static module.** Convert to dynamic only when you need environment-specific providers or module-level test mocking.

## File Organization

```
libs/shared/payments/src/lib/
├── payment.module.ts          # forRoot(), forTesting()
├── payment.tokens.ts          # DI token constants
├── payment.interface.ts       # IPaymentClient interface
├── payment.service.ts         # Business logic
├── payment-client.provider.ts # Factory provider
├── clients/
│   ├── paddle-production.client.ts
│   └── paddle-sandbox.client.ts
└── index.ts
```
