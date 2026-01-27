import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Paddle,
  Environment,
  type EventEntity,
  type Subscription as PaddleSDKSubscription,
  type SubscriptionCollection,
  type CustomerPortalSession as PaddleSDKCustomerPortalSession,
} from '@paddle/paddle-node-sdk';

/**
 * Paddle Customer Response Interface
 */
export interface PaddleCustomer {
  id: string;
  email: string;
  name?: string;
}

/**
 * Paddle Subscription Status
 * Matches Paddle SDK SubscriptionStatus type
 */
export type PaddleSubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'paused'
  | 'trialing';

/**
 * Paddle Subscription Item
 * Represents a single item in a subscription
 */
export interface PaddleSubscriptionItem {
  status: string;
  quantity: number;
  price: {
    id: string;
    description?: string;
  };
  product: {
    id: string;
    name: string;
  };
  trialDates?: {
    startsAt: string;
    endsAt: string;
  } | null;
}

/**
 * Paddle Subscription Time Period
 */
export interface PaddleSubscriptionTimePeriod {
  startsAt: string;
  endsAt: string;
}

/**
 * Paddle Subscription Scheduled Change
 */
export interface PaddleScheduledChange {
  action: string;
  effectiveAt: string;
  resumeAt?: string | null;
}

/**
 * Paddle Subscription Interface
 *
 * Represents a subscription from Paddle API
 * Based on Paddle SDK Subscription entity
 */
export interface PaddleSubscription {
  id: string;
  status: PaddleSubscriptionStatus;
  customerId: string;
  addressId: string;
  currencyCode: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  firstBilledAt: string | null;
  nextBilledAt: string | null;
  pausedAt: string | null;
  canceledAt: string | null;
  currentBillingPeriod: PaddleSubscriptionTimePeriod | null;
  billingCycle: {
    interval: string;
    frequency: number;
  };
  scheduledChange: PaddleScheduledChange | null;
  items: PaddleSubscriptionItem[];
}

/**
 * Paddle Portal Session Urls
 */
export interface PaddlePortalUrls {
  general: {
    overview: string;
  };
  subscriptions: Array<{
    id: string;
    cancelSubscription: string;
    updateSubscription: string;
  }>;
}

/**
 * Paddle Customer Portal Session Interface
 *
 * Represents a portal session from Paddle API
 * Based on Paddle SDK CustomerPortalSession entity
 */
export interface PaddlePortalSession {
  id: string;
  customerId: string | null;
  urls: PaddlePortalUrls;
  createdAt: string;
}

/**
 * List Subscription Query Parameters
 */
export interface ListSubscriptionParams {
  customerId?: string[];
  status?: PaddleSubscriptionStatus[];
  addressId?: string[];
  priceId?: string[];
  id?: string[];
  orderBy?: string;
  perPage?: number;
  after?: string;
}

/**
 * Paddle Client Interface
 *
 * Typed interface for the Paddle client to enable
 * proper dependency injection and testability.
 *
 * TASK_2025_123: Extended with subscription and portal session methods
 */
export type PaddleClient = Paddle;

/**
 * Injection token for Paddle client
 */
export const PADDLE_CLIENT = 'PADDLE_CLIENT';

/**
 * Paddle Client Provider
 *
 * Factory provider that initializes and configures the Paddle SDK client.
 * Handles ESM/CJS import compatibility issues.
 *
 * REQUIRED: This provider throws an error if PADDLE_API_KEY is not configured.
 * The application will fail to start without proper Paddle configuration.
 *
 * Usage in services:
 * ```typescript
 * constructor(
 *   @Inject(PADDLE_CLIENT)
 *   private readonly paddle: PaddleClient,
 * ) {}
 * ```
 *
 * Configuration (environment variables):
 * - PADDLE_API_KEY: Paddle API key (required)
 * - PADDLE_WEBHOOK_SECRET: Webhook signature secret (required for webhooks)
 * - NODE_ENV: Determines sandbox vs production environment
 */
export const PaddleClientProvider: Provider = {
  provide: PADDLE_CLIENT,
  useFactory: (configService: ConfigService): PaddleClient => {
    const logger = new Logger('PaddleProvider');
    const apiKey = configService.get<string>('PADDLE_API_KEY');

    if (!apiKey) {
      const error =
        'PADDLE_API_KEY is not configured. Please set it in your .env file.';
      logger.error(error);
      throw new Error(error);
    }

    const webhookSecret = configService.get<string>('PADDLE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      logger.warn(
        'PADDLE_WEBHOOK_SECRET not configured - webhook verification will fail'
      );
    }

    const nodeEnv = configService.get<string>('NODE_ENV');
    const environment =
      nodeEnv === 'production' ? Environment.production : Environment.sandbox;

    // Package is marked as external in webpack.config.js
    // Node.js loads it directly, so imports work as expected
    const client = new Paddle(apiKey, { environment });
    logger.log(
      `Paddle SDK initialized in ${
        environment === Environment.production ? 'production' : 'sandbox'
      } mode`
    );

    return client as PaddleClient;
  },
  inject: [ConfigService],
};
