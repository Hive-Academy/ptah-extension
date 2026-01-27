import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  PADDLE_CLIENT,
  PaddleClient,
  PaddleSubscriptionStatus,
} from '../paddle/providers/paddle.provider';

/**
 * Result types for Paddle API operations
 * Using discriminated unions to distinguish between "not found" and "error"
 */
export type PaddleSubscriptionResult =
  | { status: 'found'; data: PaddleSubscriptionData }
  | { status: 'not_found' }
  | { status: 'error'; reason: string };

export type PaddleCustomerResult =
  | { status: 'found'; customerId: string }
  | { status: 'not_found' }
  | { status: 'error'; reason: string };

/**
 * Normalized Paddle subscription data
 */
export interface PaddleSubscriptionData {
  id: string;
  customerId: string;
  status: PaddleSubscriptionStatus;
  priceId: string | undefined;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  trialEnd: string | null;
}

/**
 * PaddleSyncService - Centralized Paddle API adapter
 *
 * Responsibilities:
 * - All Paddle API calls with proper timeout handling
 * - Discriminated result types (found/not_found/error)
 * - Consistent error handling and logging
 *
 * Benefits:
 * - Single place for retry/circuit-breaker logic
 * - Clear distinction between "not found" and "API error"
 * - Easier to test (mock single service)
 */
@Injectable()
export class PaddleSyncService {
  private readonly logger = new Logger(PaddleSyncService.name);
  private readonly PADDLE_API_TIMEOUT = 3000; // 3 second timeout

  constructor(
    @Inject(PADDLE_CLIENT)
    private readonly paddle: PaddleClient
  ) {
    this.logger.log('PaddleSyncService initialized');
  }

  /**
   * Find Paddle subscription by customer email
   *
   * Flow:
   * 1. Query Paddle customers by email (normalized to lowercase)
   * 2. If customer found, query their subscriptions
   * 3. Return the most recent subscription (any status)
   *
   * @param email - User's email address (will be normalized to lowercase)
   * @returns Discriminated result: found/not_found/error
   */
  async findSubscriptionByEmail(
    email: string
  ): Promise<PaddleSubscriptionResult> {
    // Normalize email to lowercase for consistent lookups
    const normalizedEmail = email.toLowerCase();
    this.logger.debug(
      `Finding Paddle subscription for email: ${normalizedEmail}`
    );

    // Step 1: Find customer by email
    const customerResult = await this.findCustomerByEmail(normalizedEmail);

    if (customerResult.status === 'error') {
      return { status: 'error', reason: customerResult.reason };
    }

    if (customerResult.status === 'not_found') {
      this.logger.debug(`No Paddle customer found for email: ${email}`);
      return { status: 'not_found' };
    }

    // Step 2: Get subscriptions for this customer
    return this.findSubscriptionByCustomerId(customerResult.customerId);
  }

  /**
   * Find Paddle subscription by customer ID
   *
   * @param customerId - Paddle customer ID
   * @returns Discriminated result: found/not_found/error
   */
  async findSubscriptionByCustomerId(
    customerId: string
  ): Promise<PaddleSubscriptionResult> {
    this.logger.debug(`Finding subscription for customer: ${customerId}`);

    try {
      const collection = this.paddle.subscriptions.list({
        customerId: [customerId],
      });

      // Use timeout wrapper for async iteration
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), this.PADDLE_API_TIMEOUT)
      );

      const fetchPromise =
        (async (): Promise<PaddleSubscriptionData | null> => {
          for await (const sub of collection) {
            // Return first subscription found
            return {
              id: sub.id,
              customerId: sub.customerId,
              status: sub.status as PaddleSubscriptionStatus,
              priceId: sub.items[0]?.price?.id,
              currentPeriodEnd: sub.currentBillingPeriod?.endsAt || null,
              canceledAt: sub.canceledAt || null,
              trialEnd: sub.items[0]?.trialDates?.endsAt || null,
            };
          }
          return null;
        })();

      const result = await Promise.race([fetchPromise, timeoutPromise]);

      if (result === 'timeout') {
        this.logger.warn(`Paddle API timeout for customer: ${customerId}`);
        return { status: 'error', reason: 'timeout' };
      }

      if (!result) {
        this.logger.debug(`No subscription found for customer: ${customerId}`);
        return { status: 'not_found' };
      }

      this.logger.debug(
        `Found subscription ${result.id} (${result.status}) for customer: ${customerId}`
      );
      return { status: 'found', data: result };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to query Paddle subscriptions for customer ${customerId}: ${errorMessage}`
      );
      return { status: 'error', reason: errorMessage };
    }
  }

  /**
   * Find Paddle customer by email
   *
   * @param email - User's email address
   * @returns Discriminated result: found/not_found/error
   */
  async findCustomerByEmail(email: string): Promise<PaddleCustomerResult> {
    try {
      const customerCollection = this.paddle.customers.list({
        email: [email],
      });

      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), this.PADDLE_API_TIMEOUT)
      );

      const customerPromise = (async (): Promise<string | null> => {
        for await (const customer of customerCollection) {
          return customer.id;
        }
        return null;
      })();

      const result = await Promise.race([customerPromise, timeoutPromise]);

      if (result === 'timeout') {
        this.logger.warn(`Paddle API timeout finding customer for: ${email}`);
        return { status: 'error', reason: 'timeout' };
      }

      if (!result) {
        return { status: 'not_found' };
      }

      this.logger.debug(`Found Paddle customer ${result} for email: ${email}`);
      return { status: 'found', customerId: result };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to find Paddle customer for ${email}: ${errorMessage}`
      );
      return { status: 'error', reason: errorMessage };
    }
  }

  /**
   * Create customer portal session
   *
   * @param customerId - Paddle customer ID
   * @param subscriptionIds - Array of subscription IDs to include
   * @returns Portal URL or null on failure
   */
  async createPortalSession(
    customerId: string,
    subscriptionIds: string[]
  ): Promise<{ url: string } | null> {
    try {
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => {
          this.logger.warn('Paddle API timeout creating portal session');
          resolve(null);
        }, this.PADDLE_API_TIMEOUT)
      );

      const createPromise = this.paddle.customerPortalSessions.create(
        customerId,
        subscriptionIds
      );

      const result = await Promise.race([createPromise, timeoutPromise]);

      if (!result) {
        return null;
      }

      return { url: result.urls.general.overview };
    } catch (error) {
      this.logger.error(
        'Failed to create portal session',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Check if a subscription status is considered "active"
   * (user should have access to premium features)
   */
  isActiveStatus(status: PaddleSubscriptionStatus | string): boolean {
    return ['active', 'trialing', 'past_due'].includes(status);
  }
}
