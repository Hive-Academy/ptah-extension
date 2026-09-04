# Third-Party Service Integration Pattern

## Overview

This pattern provides a consistent way to integrate any external service (payments, auth, email, storage, etc.) into NestJS.

## The Pattern

### 1. Define the Interface

```typescript
// libs/shared/[service]/src/lib/[service].interface.ts

// Generic interface that all implementations must follow
export interface IPaymentClient {
  createCustomer(data: CreateCustomerInput): Promise<Customer>;
  createPaymentIntent(data: PaymentIntentInput): Promise<PaymentIntent>;
  createSubscription(data: SubscriptionInput): Promise<Subscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  constructWebhookEvent(payload: Buffer, signature: string): WebhookEvent;
}

// DTOs
export interface CreateCustomerInput {
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}

export interface Customer {
  id: string;
  email: string;
  name?: string;
}

// ... other DTOs
```

### 2. Create Provider Factory

```typescript
// libs/shared/[service]/src/lib/[service]-client.provider.ts
import { ConfigService } from '@nestjs/config';
import { IPaymentClient } from './[service].interface';

export const PAYMENT_CLIENT = 'PAYMENT_CLIENT';

export const PaymentClientProvider = {
  provide: PAYMENT_CLIENT,
  useFactory: async (configService: ConfigService): Promise<IPaymentClient> => {
    const provider = configService.get<string>('PAYMENT_PROVIDER', 'stripe');
    const apiKey = configService.getOrThrow<string>('PAYMENT_API_KEY');

    switch (provider) {
      case 'stripe':
        // Dynamic import to avoid loading unused SDKs
        const { StripeAdapter } = await import('./adapters/stripe.adapter');
        return new StripeAdapter(apiKey);

      case 'paddle':
        const { PaddleAdapter } = await import('./adapters/paddle.adapter');
        return new PaddleAdapter(apiKey);

      case 'lemonsqueezy':
        const { LemonSqueezyAdapter } = await import('./adapters/lemonsqueezy.adapter');
        return new LemonSqueezyAdapter(apiKey);

      default:
        throw new Error(`Unsupported payment provider: ${provider}`);
    }
  },
  inject: [ConfigService],
};
```

### 3. Implement Adapters

```typescript
// libs/shared/[service]/src/lib/adapters/stripe.adapter.ts
import Stripe from 'stripe';
import { IPaymentClient, CreateCustomerInput, Customer } from '../[service].interface';

export class StripeAdapter implements IPaymentClient {
  private stripe: Stripe;

  constructor(apiKey: string) {
    this.stripe = new Stripe(apiKey, { apiVersion: '2024-01-01' });
  }

  async createCustomer(data: CreateCustomerInput): Promise<Customer> {
    const customer = await this.stripe.customers.create({
      email: data.email,
      name: data.name,
      metadata: data.metadata,
    });

    return {
      id: customer.id,
      email: customer.email!,
      name: customer.name || undefined,
    };
  }

  async createPaymentIntent(data: PaymentIntentInput): Promise<PaymentIntent> {
    const intent = await this.stripe.paymentIntents.create({
      amount: data.amount,
      currency: data.currency,
      customer: data.customerId,
    });

    return {
      id: intent.id,
      clientSecret: intent.client_secret!,
      status: intent.status,
    };
  }

  // ... other methods
}
```

### 4. Create the Service

```typescript
// libs/shared/[service]/src/lib/[service].service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PAYMENT_CLIENT, IPaymentClient } from './[service].interface';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PAYMENT_CLIENT)
    private readonly client: IPaymentClient
  ) {}

  async createCustomer(dto: CreateCustomerDto): Promise<Customer> {
    return this.client.createCustomer(dto);
  }

  async createSubscription(customerId: string, priceId: string): Promise<Subscription> {
    return this.client.createSubscription({
      customerId,
      priceId,
    });
  }

  // Business logic can be added here
  async handleSubscriptionCreated(subscription: Subscription): Promise<void> {
    // Update database, send emails, etc.
  }
}
```

### 5. Create the Module

```typescript
// libs/shared/[service]/src/lib/[service].module.ts
import { Module, DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentClientProvider, PAYMENT_CLIENT } from './[service]-client.provider';
import { PaymentService } from './[service].service';

@Module({})
export class PaymentModule {
  static forRoot(): DynamicModule {
    return {
      module: PaymentModule,
      imports: [ConfigModule],
      providers: [PaymentClientProvider, PaymentService],
      exports: [PaymentService, PAYMENT_CLIENT],
      global: true, // Optional: make available everywhere
    };
  }

  // For testing with mock client
  static forTesting(mockClient: IPaymentClient): DynamicModule {
    return {
      module: PaymentModule,
      providers: [{ provide: PAYMENT_CLIENT, useValue: mockClient }, PaymentService],
      exports: [PaymentService, PAYMENT_CLIENT],
    };
  }
}
```

### 6. Handle Webhooks

```typescript
// libs/shared/[service]/src/lib/[service].controller.ts
import { Controller, Post, Req, Headers, RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './[service].service';

@Controller('webhooks')
export class PaymentWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('payments')
  async handlePaymentWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string // Or appropriate header
  ) {
    const event = this.paymentService.constructWebhookEvent(req.rawBody!, signature);

    switch (event.type) {
      case 'customer.subscription.created':
        await this.paymentService.handleSubscriptionCreated(event.data);
        break;
      case 'customer.subscription.deleted':
        await this.paymentService.handleSubscriptionCanceled(event.data);
        break;
      // ... other events
    }

    return { received: true };
  }
}
```

## Usage in Application

```typescript
// apps/api/src/app/app.module.ts
import { Module } from '@nestjs/common';
import { PaymentModule } from '@my-org/shared/payments';

@Module({
  imports: [
    ConfigModule.forRoot(),
    PaymentModule.forRoot(),
    // ... other modules
  ],
})
export class AppModule {}
```

```typescript
// In any service or controller
@Injectable()
export class SubscriptionService {
  constructor(private readonly paymentService: PaymentService) {}

  async createUserSubscription(userId: string, planId: string) {
    // Get or create customer
    const customer = await this.paymentService.createCustomer({
      email: user.email,
      metadata: { userId },
    });

    // Create subscription
    return this.paymentService.createSubscription(customer.id, planId);
  }
}
```

## Environment Configuration

```bash
# .env
PAYMENT_PROVIDER=stripe        # or 'paddle', 'lemonsqueezy'
PAYMENT_API_KEY=sk_test_xxx
PAYMENT_WEBHOOK_SECRET=whsec_xxx
```

## Applying to Other Services

### Email Service

```typescript
export interface IEmailClient {
  send(data: SendEmailInput): Promise<EmailResult>;
  sendTemplate(data: SendTemplateInput): Promise<EmailResult>;
}

// Adapters: SendGrid, Resend, AWS SES, Mailgun
```

### File Storage Service

```typescript
export interface IStorageClient {
  upload(file: Buffer, key: string): Promise<UploadResult>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  delete(key: string): Promise<void>;
}

// Adapters: S3, Cloudflare R2, Google Cloud Storage
```

### Auth Provider Service

```typescript
export interface IAuthProviderClient {
  verifyToken(token: string): Promise<TokenPayload>;
  getUser(userId: string): Promise<ExternalUser>;
  createUser(data: CreateUserInput): Promise<ExternalUser>;
}

// Adapters: Clerk, Auth0, WorkOS, Firebase Auth
```

## Benefits

1. **Swappable implementations**: Change providers without touching business logic
2. **Testable**: Easy to mock the client interface
3. **Type-safe**: Interface ensures all adapters implement required methods
4. **Lazy loading**: Only load the SDK you're using
5. **Configuration-driven**: Change provider via environment variable
