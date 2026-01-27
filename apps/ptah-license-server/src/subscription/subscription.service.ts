import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import {
  PADDLE_CLIENT,
  PaddleClient,
  PaddleSubscriptionStatus,
} from '../paddle/providers/paddle.provider';
import {
  SubscriptionStatusResponseDto,
  ValidateCheckoutResponseDto,
  ReconcileResponseDto,
  PortalSessionResponseDto,
  PortalSessionErrorDto,
  SubscriptionDetails,
} from './dto';

/**
 * SubscriptionService - Core business logic for subscription management
 *
 * TASK_2025_123: Reliable Paddle Subscription Management System
 *
 * Responsibilities:
 * 1. Get subscription status from Paddle API with local fallback
 * 2. Validate checkout to prevent duplicate subscriptions
 * 3. Reconcile local database with Paddle state
 * 4. Generate customer portal sessions
 *
 * Integration Points:
 * - Paddle SDK (subscriptions.list, subscriptions.get, customerPortalSessions.create)
 * - PrismaService (User, License, Subscription tables)
 * - EventsService (SSE broadcasting for real-time updates)
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly PADDLE_API_TIMEOUT = 3000; // 3 second timeout

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    @Inject(PADDLE_CLIENT)
    private readonly paddle: PaddleClient
  ) {
    this.logger.log('SubscriptionService initialized');
  }

  /**
   * Get subscription status for a user
   *
   * Strategy:
   * 1. Find user's Paddle customer ID from local DB
   * 2. Query Paddle API for subscription with 3s timeout
   * 3. On timeout/error, fall back to local data with source='local'
   * 4. Compare Paddle vs local, set requiresSync if different
   *
   * @param userId - User's internal UUID
   * @returns Subscription status response
   */
  async getStatus(userId: string): Promise<SubscriptionStatusResponseDto> {
    this.logger.debug(`Getting subscription status for user: ${userId}`);

    // Step 1: Find user and their subscription record
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        licenses: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      this.logger.warn(`User not found: ${userId}`);
      return {
        hasSubscription: false,
        source: 'local',
      };
    }

    const localSubscription = user.subscriptions[0];
    const localLicense = user.licenses[0];

    // No subscription record at all
    if (!localSubscription) {
      return {
        hasSubscription: false,
        source: 'local',
      };
    }

    // Step 2: Try to fetch from Paddle with timeout
    const paddleCustomerId = localSubscription.paddleCustomerId;
    const paddleData = await this.queryPaddleSubscription(paddleCustomerId);

    // Step 3: If Paddle data available, use it
    if (paddleData) {
      const priceId = paddleData.items[0]?.price?.id;
      const plan = this.mapPriceIdToPlan(priceId);
      const billingCycle = this.getBillingCycle(priceId);

      const subscription: SubscriptionDetails = {
        id: paddleData.id,
        status: paddleData.status,
        plan,
        billingCycle,
        currentPeriodEnd:
          paddleData.currentBillingPeriod?.endsAt ||
          localSubscription.currentPeriodEnd.toISOString(),
        canceledAt: paddleData.canceledAt || undefined,
        trialEnd:
          paddleData.items[0]?.trialDates?.endsAt ||
          localSubscription.trialEnd?.toISOString(),
      };

      // Check if local differs from Paddle (requires sync)
      const requiresSync = this.checkRequiresSync(localSubscription, paddleData);

      // Generate portal URL for active subscriptions
      let customerPortalUrl: string | undefined;
      if (this.isActiveSubscription(paddleData.status)) {
        const portalResult = await this.createPortalSession(userId);
        if ('url' in portalResult) {
          customerPortalUrl = portalResult.url;
        }
      }

      return {
        hasSubscription: true,
        subscription,
        source: 'paddle',
        requiresSync,
        customerPortalUrl,
      };
    }

    // Step 4: Fall back to local data
    this.logger.warn(
      `Paddle API unavailable, using local data for user: ${userId}`
    );

    // Check if local subscription is still valid
    const isValidStatus = ['active', 'trialing', 'past_due'].includes(
      localSubscription.status
    );
    const isNotExpired =
      localSubscription.currentPeriodEnd > new Date();

    if (!isValidStatus || !isNotExpired) {
      return {
        hasSubscription: false,
        source: 'local',
        requiresSync: true,
      };
    }

    const plan = this.mapPriceIdToPlan(localSubscription.priceId);
    const billingCycle = this.getBillingCycle(localSubscription.priceId);

    const subscription: SubscriptionDetails = {
      id: localSubscription.paddleSubscriptionId,
      status: localSubscription.status as SubscriptionDetails['status'],
      plan,
      billingCycle,
      currentPeriodEnd: localSubscription.currentPeriodEnd.toISOString(),
      canceledAt: localSubscription.canceledAt?.toISOString(),
      trialEnd: localSubscription.trialEnd?.toISOString(),
    };

    return {
      hasSubscription: true,
      subscription,
      source: 'local',
      requiresSync: true, // Always recommend sync when using local data
    };
  }

  /**
   * Validate if user can checkout (prevent duplicate subscriptions)
   *
   * Strategy:
   * 1. Get subscription status from Paddle
   * 2. If active/trialing/past_due exists, return canCheckout=false
   * 3. If canceled but period not ended, return canCheckout=false with message
   * 4. Otherwise return canCheckout=true
   *
   * @param userId - User's internal UUID
   * @param priceId - Paddle price ID for the requested checkout
   * @returns Validation result
   */
  async validateCheckout(
    userId: string,
    priceId: string
  ): Promise<ValidateCheckoutResponseDto> {
    this.logger.debug(
      `Validating checkout for user: ${userId}, priceId: ${priceId}`
    );

    // Get current status
    const status = await this.getStatus(userId);

    // No existing subscription - can checkout
    if (!status.hasSubscription || !status.subscription) {
      return {
        canCheckout: true,
        reason: 'none',
        message: 'No existing subscription. You can proceed with checkout.',
      };
    }

    const subscription = status.subscription;
    const currentPeriodEnd = new Date(subscription.currentPeriodEnd);
    const now = new Date();

    // Active or trialing subscription - cannot checkout
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      this.logger.log(
        `Blocking checkout for user ${userId}: existing ${subscription.status} subscription`
      );

      return {
        canCheckout: false,
        reason: 'existing_subscription',
        existingPlan: subscription.plan,
        currentPeriodEnd: subscription.currentPeriodEnd,
        customerPortalUrl: status.customerPortalUrl,
        message: `You already have an ${subscription.status} ${subscription.plan} subscription. Please manage it through the customer portal.`,
      };
    }

    // Past due subscription - cannot checkout (payment retry in progress)
    if (subscription.status === 'past_due') {
      this.logger.log(
        `Blocking checkout for user ${userId}: subscription is past_due`
      );

      return {
        canCheckout: false,
        reason: 'existing_subscription',
        existingPlan: subscription.plan,
        currentPeriodEnd: subscription.currentPeriodEnd,
        customerPortalUrl: status.customerPortalUrl,
        message:
          'Your subscription has a payment issue. Please update your payment method in the customer portal.',
      };
    }

    // Canceled but period not ended - cannot checkout
    if (subscription.status === 'canceled' && currentPeriodEnd > now) {
      this.logger.log(
        `Blocking checkout for user ${userId}: canceled subscription still active until ${currentPeriodEnd.toISOString()}`
      );

      return {
        canCheckout: false,
        reason: 'subscription_ending_soon',
        existingPlan: subscription.plan,
        currentPeriodEnd: subscription.currentPeriodEnd,
        customerPortalUrl: status.customerPortalUrl,
        message: `Your ${subscription.plan} subscription is canceled but still active until ${currentPeriodEnd.toLocaleDateString()}. You can reactivate it in the customer portal.`,
      };
    }

    // Paused subscription - direct to portal
    if (subscription.status === 'paused') {
      return {
        canCheckout: false,
        reason: 'existing_subscription',
        existingPlan: subscription.plan,
        customerPortalUrl: status.customerPortalUrl,
        message:
          'Your subscription is paused. Please resume it in the customer portal.',
      };
    }

    // All other cases (e.g., canceled and expired) - can checkout
    return {
      canCheckout: true,
      reason: 'none',
      message: 'You can proceed with checkout.',
    };
  }

  /**
   * Reconcile local database with Paddle state
   *
   * Strategy:
   * 1. Fetch current Paddle subscription
   * 2. Compare with local subscription record
   * 3. Update local to match Paddle (create/update/mark orphaned)
   * 4. Update license status accordingly
   * 5. Emit SSE event for real-time update
   * 6. Return summary of changes
   *
   * @param userId - User's internal UUID
   * @param email - User's email for SSE targeting
   * @returns Reconciliation result summary
   */
  async reconcile(userId: string, email: string): Promise<ReconcileResponseDto> {
    this.logger.log(`Starting reconciliation for user: ${userId}`);
    const errors: string[] = [];

    // Step 1: Get local subscription and user data
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        licenses: {
          where: { status: { in: ['active', 'paused'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      return {
        success: false,
        changes: {
          subscriptionUpdated: false,
          licenseUpdated: false,
          statusBefore: 'unknown',
          statusAfter: 'unknown',
        },
        errors: ['User not found'],
      };
    }

    const localSubscription = user.subscriptions[0];
    const localLicense = user.licenses[0];
    const statusBefore = localSubscription?.status || 'none';
    const planBefore = localLicense?.plan;

    // No local subscription record - nothing to reconcile
    if (!localSubscription) {
      return {
        success: true,
        changes: {
          subscriptionUpdated: false,
          licenseUpdated: false,
          statusBefore: 'none',
          statusAfter: 'none',
        },
      };
    }

    // Step 2: Fetch Paddle subscription
    const paddleCustomerId = localSubscription.paddleCustomerId;
    const paddleData = await this.queryPaddleSubscription(paddleCustomerId);

    if (!paddleData) {
      errors.push('Unable to fetch Paddle subscription data');
      return {
        success: false,
        changes: {
          subscriptionUpdated: false,
          licenseUpdated: false,
          statusBefore,
          statusAfter: statusBefore,
          planBefore,
          planAfter: planBefore,
        },
        errors,
      };
    }

    // Step 3: Determine changes needed
    const priceId = paddleData.items[0]?.price?.id;
    const newPlan = this.mapPriceIdToPlan(priceId);
    const newStatus = paddleData.status;
    const newPeriodEnd = paddleData.currentBillingPeriod
      ? new Date(paddleData.currentBillingPeriod.endsAt)
      : localSubscription.currentPeriodEnd;

    let subscriptionUpdated = false;
    let licenseUpdated = false;

    // Step 4: Update local subscription to match Paddle
    if (
      localSubscription.status !== newStatus ||
      localSubscription.priceId !== priceId ||
      localSubscription.currentPeriodEnd.getTime() !== newPeriodEnd.getTime()
    ) {
      await this.prisma.subscription.update({
        where: { id: localSubscription.id },
        data: {
          status: newStatus,
          priceId: priceId || localSubscription.priceId,
          currentPeriodEnd: newPeriodEnd,
          canceledAt: paddleData.canceledAt
            ? new Date(paddleData.canceledAt)
            : null,
          trialEnd: paddleData.items[0]?.trialDates?.endsAt
            ? new Date(paddleData.items[0].trialDates.endsAt)
            : null,
        },
      });
      subscriptionUpdated = true;
      this.logger.log(
        `Updated subscription ${localSubscription.id}: ${statusBefore} -> ${newStatus}`
      );
    }

    // Step 5: Update license based on subscription status
    if (localLicense) {
      const licenseStatus = this.mapSubscriptionStatusToLicenseStatus(newStatus);
      const shouldUpdateLicense =
        localLicense.status !== licenseStatus ||
        localLicense.plan !== newPlan ||
        (localLicense.expiresAt?.getTime() || 0) !== newPeriodEnd.getTime();

      if (shouldUpdateLicense) {
        await this.prisma.license.update({
          where: { id: localLicense.id },
          data: {
            status: licenseStatus,
            plan: newPlan,
            expiresAt: newPeriodEnd,
          },
        });
        licenseUpdated = true;
        this.logger.log(
          `Updated license ${localLicense.id}: ${planBefore} -> ${newPlan}, status: ${licenseStatus}`
        );
      }
    }

    // Step 6: Emit SSE events for real-time updates
    if (subscriptionUpdated || licenseUpdated) {
      this.eventsService.emitLicenseUpdated({
        email,
        plan: newPlan,
        status: this.mapSubscriptionStatusToLicenseStatus(
          newStatus
        ) as 'active' | 'expired' | 'revoked' | 'trialing',
        expiresAt: newPeriodEnd.toISOString(),
      });

      this.eventsService.emitSubscriptionStatus({
        email,
        status: newStatus as
          | 'trialing'
          | 'active'
          | 'past_due'
          | 'paused'
          | 'canceled',
        plan: newPlan,
      });
    }

    return {
      success: true,
      changes: {
        subscriptionUpdated,
        licenseUpdated,
        statusBefore,
        statusAfter: newStatus,
        planBefore,
        planAfter: newPlan,
      },
      paddleSubscription: {
        id: paddleData.id,
        status: paddleData.status,
        plan: newPlan,
        currentPeriodEnd: newPeriodEnd.toISOString(),
      },
    };
  }

  /**
   * Create customer portal session
   *
   * Strategy:
   * 1. Find user's Paddle customer ID
   * 2. Call Paddle API to create portal session
   * 3. Return portal URL (60-minute validity)
   *
   * @param userId - User's internal UUID
   * @returns Portal session URL or error
   */
  async createPortalSession(
    userId: string
  ): Promise<PortalSessionResponseDto | PortalSessionErrorDto> {
    this.logger.debug(`Creating portal session for user: ${userId}`);

    // Find user's subscription with customer ID
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['active', 'trialing', 'past_due', 'paused', 'canceled'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return {
        error: 'no_customer_record',
        message: 'No Paddle customer record found for this user.',
      };
    }

    try {
      const portalSession = await this.queryPaddleWithTimeout(
        () =>
          this.paddle.customerPortalSessions.create(
            subscription.paddleCustomerId,
            [subscription.paddleSubscriptionId]
          ),
        'customerPortalSessions.create'
      );

      if (!portalSession) {
        return {
          error: 'paddle_api_error',
          message: 'Unable to create portal session. Please try again later.',
        };
      }

      // Portal sessions are valid for 60 minutes
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 60);

      return {
        url: portalSession.urls.general.overview,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(
        'Failed to create portal session',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return {
        error: 'paddle_api_error',
        message: 'Failed to create portal session. Please try again later.',
      };
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Query Paddle subscriptions for a customer
   * Returns the most recent active subscription or null
   */
  private async queryPaddleSubscription(
    customerId: string
  ): Promise<{
    id: string;
    status: PaddleSubscriptionStatus;
    customerId: string;
    currentBillingPeriod: { startsAt: string; endsAt: string } | null;
    canceledAt: string | null;
    items: Array<{
      price: { id: string };
      trialDates?: { startsAt: string; endsAt: string } | null;
    }>;
  } | null> {
    try {
      const collection = this.paddle.subscriptions.list({
        customerId: [customerId],
      });

      // SubscriptionCollection is iterable - get first subscription
      const subscriptions: Array<{
        id: string;
        status: PaddleSubscriptionStatus;
        customerId: string;
        currentBillingPeriod: { startsAt: string; endsAt: string } | null;
        canceledAt: string | null;
        items: Array<{
          price: { id: string };
          trialDates?: { startsAt: string; endsAt: string } | null;
        }>;
      }> = [];

      // Use timeout wrapper for the async iteration
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), this.PADDLE_API_TIMEOUT)
      );

      const fetchPromise = (async () => {
        for await (const sub of collection) {
          subscriptions.push({
            id: sub.id,
            status: sub.status as PaddleSubscriptionStatus,
            customerId: sub.customerId,
            currentBillingPeriod: sub.currentBillingPeriod
              ? {
                  startsAt: sub.currentBillingPeriod.startsAt,
                  endsAt: sub.currentBillingPeriod.endsAt,
                }
              : null,
            canceledAt: sub.canceledAt,
            items: sub.items.map((item) => ({
              price: { id: item.price.id },
              trialDates: item.trialDates
                ? {
                    startsAt: item.trialDates.startsAt,
                    endsAt: item.trialDates.endsAt,
                  }
                : null,
            })),
          });
          // Only get the first subscription (most recent)
          break;
        }
        return subscriptions[0] || null;
      })();

      const result = await Promise.race([fetchPromise, timeoutPromise]);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to query Paddle subscriptions for customer ${customerId}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Helper: Query Paddle API with timeout
   * Returns null on timeout/error for fallback handling
   */
  private async queryPaddleWithTimeout<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T | null> {
    try {
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => {
          this.logger.warn(`Paddle API timeout: ${operationName}`);
          resolve(null);
        }, this.PADDLE_API_TIMEOUT)
      );

      const result = await Promise.race([operation(), timeoutPromise]);
      return result;
    } catch (error) {
      this.logger.error(
        `Paddle API error in ${operationName}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Map Paddle price ID to plan name
   * Reuses existing logic from PaddleService
   */
  private mapPriceIdToPlan(priceId: string | undefined): string {
    if (!priceId) {
      return 'expired';
    }

    // Basic plan price IDs
    const basicMonthlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_BASIC_MONTHLY'
    );
    const basicYearlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_BASIC_YEARLY'
    );

    // Pro plan price IDs
    const proMonthlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_PRO_MONTHLY'
    );
    const proYearlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_PRO_YEARLY'
    );

    // Map to basic plan
    if (priceId === basicMonthlyPriceId || priceId === basicYearlyPriceId) {
      return 'basic';
    }

    // Map to pro plan
    if (priceId === proMonthlyPriceId || priceId === proYearlyPriceId) {
      return 'pro';
    }

    this.logger.warn(`Unknown price ID: ${priceId}`);
    return 'expired';
  }

  /**
   * Determine billing cycle from price ID
   */
  private getBillingCycle(priceId: string | undefined): 'monthly' | 'yearly' {
    if (!priceId) {
      return 'monthly';
    }

    const yearlyPriceIds = [
      this.configService.get<string>('PADDLE_PRICE_ID_BASIC_YEARLY'),
      this.configService.get<string>('PADDLE_PRICE_ID_PRO_YEARLY'),
    ].filter(Boolean);

    return yearlyPriceIds.includes(priceId) ? 'yearly' : 'monthly';
  }

  /**
   * Check if local subscription differs from Paddle data
   */
  private checkRequiresSync(
    local: {
      status: string;
      priceId: string;
      currentPeriodEnd: Date;
    },
    paddle: {
      status: string;
      items: Array<{ price: { id: string } }>;
      currentBillingPeriod: { endsAt: string } | null;
    }
  ): boolean {
    if (local.status !== paddle.status) {
      return true;
    }

    const paddlePriceId = paddle.items[0]?.price?.id;
    if (local.priceId !== paddlePriceId) {
      return true;
    }

    if (paddle.currentBillingPeriod) {
      const paddleEnd = new Date(paddle.currentBillingPeriod.endsAt);
      // Allow 1 minute tolerance for timing differences
      if (Math.abs(local.currentPeriodEnd.getTime() - paddleEnd.getTime()) > 60000) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if subscription status is considered active
   */
  private isActiveSubscription(status: string): boolean {
    return ['active', 'trialing', 'past_due'].includes(status);
  }

  /**
   * Map Paddle subscription status to license status
   */
  private mapSubscriptionStatusToLicenseStatus(
    subscriptionStatus: string
  ): string {
    switch (subscriptionStatus) {
      case 'active':
        return 'active';
      case 'trialing':
        return 'active'; // Trial users have active licenses
      case 'past_due':
        return 'active'; // Keep active during payment retry
      case 'paused':
        return 'paused';
      case 'canceled':
        return 'active'; // Keep active until period ends
      default:
        return 'expired';
    }
  }
}
