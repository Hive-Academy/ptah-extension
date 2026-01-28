import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SubscriptionStatusResponseDto,
  ValidateCheckoutResponseDto,
  ReconcileResponseDto,
  PortalSessionResponseDto,
  PortalSessionErrorDto,
  SubscriptionDetails,
} from './dto';
import { SubscriptionDbService } from './subscription-db.service';
import {
  PaddleSyncService,
  PaddleSubscriptionData,
} from './paddle-sync.service';
import {
  SUBSCRIPTION_EVENTS,
  LicenseUpdatedEvent,
  SubscriptionStatusChangedEvent,
  ReconciliationCompletedEvent,
} from './events';

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
 * - PaddleSyncService (Paddle API operations)
 * - SubscriptionDbService (database operations)
 * - EventEmitter2 (async event publishing for SSE)
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly dbService: SubscriptionDbService,
    private readonly paddleSync: PaddleSyncService,
    private readonly eventEmitter: EventEmitter2
  ) {
    this.logger.log('SubscriptionService initialized');
  }

  /**
   * Get subscription status for a user
   *
   * Strategy (Paddle is source of truth):
   * 1. If we have a stored paddleCustomerId, query by customer ID (1 API call)
   * 2. Otherwise, query by email (2 API calls: customer lookup + subscription)
   * 3. On timeout/error, fall back to local database
   * 4. Compare Paddle vs local, set requiresSync if different
   */
  async getStatus(userId: string): Promise<SubscriptionStatusResponseDto> {
    this.logger.debug(`Getting subscription status for user: ${userId}`);

    // Step 1: Find user with subscription
    const userData = await this.dbService.findUserWithSubscription(userId);

    if (!userData) {
      this.logger.warn(`User not found: ${userId}`);
      return { hasSubscription: false, source: 'local' };
    }

    const localSubscription = userData.subscription;

    // Step 2: Query Paddle - use stored customerId if available (saves 1 API call)
    // Otherwise fall back to email lookup
    const paddleResult = localSubscription?.paddleCustomerId
      ? await this.paddleSync.findSubscriptionByCustomerId(
          localSubscription.paddleCustomerId
        )
      : await this.paddleSync.findSubscriptionByEmail(userData.email);

    // Step 3: Handle Paddle result
    if (paddleResult.status === 'found') {
      return this.buildStatusFromPaddle(
        paddleResult.data,
        localSubscription,
        userId
      );
    }

    if (paddleResult.status === 'error') {
      this.logger.warn(
        `Paddle API error for user ${userId}: ${paddleResult.reason}`
      );
      // Fall through to local data
    }

    // Step 4: Paddle unavailable or no subscription - fall back to local
    return this.buildStatusFromLocal(localSubscription);
  }

  /**
   * Validate if user can checkout (prevent duplicate subscriptions)
   */
  async validateCheckout(
    userId: string,
    priceId: string
  ): Promise<ValidateCheckoutResponseDto> {
    this.logger.debug(
      `Validating checkout for user: ${userId}, priceId: ${priceId}`
    );

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

    // Active or trialing - cannot checkout
    if (
      subscription.status === 'active' ||
      subscription.status === 'trialing'
    ) {
      return {
        canCheckout: false,
        reason: 'existing_subscription',
        existingPlan: subscription.plan,
        currentPeriodEnd: subscription.currentPeriodEnd,
        customerPortalUrl: status.customerPortalUrl,
        message: `You already have an ${subscription.status} ${subscription.plan} subscription. Please manage it through the customer portal.`,
      };
    }

    // Past due - cannot checkout
    if (subscription.status === 'past_due') {
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

    // Canceled but period not ended
    if (subscription.status === 'canceled' && currentPeriodEnd > now) {
      return {
        canCheckout: false,
        reason: 'subscription_ending_soon',
        existingPlan: subscription.plan,
        currentPeriodEnd: subscription.currentPeriodEnd,
        customerPortalUrl: status.customerPortalUrl,
        message: `Your ${
          subscription.plan
        } subscription is canceled but still active until ${currentPeriodEnd.toLocaleDateString()}. You can reactivate it in the customer portal.`,
      };
    }

    // Paused - direct to portal
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

    // All other cases - can checkout
    return {
      canCheckout: true,
      reason: 'none',
      message: 'You can proceed with checkout.',
    };
  }

  /**
   * Reconcile local database with Paddle state
   */
  async reconcile(
    userId: string,
    email: string
  ): Promise<ReconcileResponseDto> {
    this.logger.log(`Starting reconciliation for user: ${userId}`);

    // Step 1: Get user and local data
    const userData = await this.dbService.findUserWithSubscriptionAndLicense(
      userId
    );

    if (!userData) {
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

    const localSubscription = userData.subscription;
    const localLicense = userData.license;
    const statusBefore = localSubscription?.status || 'none';
    const planBefore = localLicense?.plan;

    // Step 2: Query Paddle - use stored customerId if available (saves 1 API call)
    // Otherwise fall back to email lookup
    const paddleResult = localSubscription?.paddleCustomerId
      ? await this.paddleSync.findSubscriptionByCustomerId(
          localSubscription.paddleCustomerId
        )
      : await this.paddleSync.findSubscriptionByEmail(email);

    if (paddleResult.status === 'error') {
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
        errors: [`Paddle API error: ${paddleResult.reason}`],
      };
    }

    if (paddleResult.status === 'not_found') {
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
      return {
        success: true,
        changes: {
          subscriptionUpdated: false,
          licenseUpdated: false,
          statusBefore,
          statusAfter: statusBefore,
          planBefore,
          planAfter: planBefore,
        },
        errors: ['No subscription found in Paddle for this email'],
      };
    }

    // Step 3: Paddle has subscription - sync it
    const paddleData = paddleResult.data;
    const newPlan = this.mapPriceIdToPlan(paddleData.priceId);
    const newStatus = paddleData.status;
    const isInTrial = newStatus === 'trialing';
    const licensePlan = isInTrial ? `trial_${newPlan}` : newPlan;
    const newPeriodEnd = paddleData.currentPeriodEnd
      ? new Date(paddleData.currentPeriodEnd)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const trialEnd = paddleData.trialEnd ? new Date(paddleData.trialEnd) : null;

    let subscriptionUpdated = false;
    let licenseUpdated = false;

    // Step 4: Create or update local records
    if (!localSubscription) {
      // CREATE: Paddle has subscription but local doesn't
      this.logger.log(
        `Creating local records from Paddle subscription ${paddleData.id}`
      );

      await this.dbService.createSubscriptionAndLicense(
        {
          userId: userData.id,
          paddleSubscriptionId: paddleData.id,
          paddleCustomerId: paddleData.customerId,
          status: newStatus,
          priceId: paddleData.priceId || '',
          currentPeriodEnd: newPeriodEnd,
          trialEnd,
        },
        {
          userId: userData.id,
          plan: licensePlan,
          expiresAt: newPeriodEnd,
          createdBy: `paddle_reconcile_${paddleData.id}`,
        }
      );

      subscriptionUpdated = true;
      licenseUpdated = true;
    } else {
      // UPDATE: Both exist - sync local to match Paddle
      const needsSubUpdate =
        localSubscription.status !== newStatus ||
        localSubscription.priceId !== paddleData.priceId ||
        localSubscription.currentPeriodEnd.getTime() !== newPeriodEnd.getTime();

      if (needsSubUpdate) {
        await this.dbService.updateSubscription(localSubscription.id, {
          status: newStatus,
          priceId: paddleData.priceId || localSubscription.priceId,
          currentPeriodEnd: newPeriodEnd,
          canceledAt: paddleData.canceledAt
            ? new Date(paddleData.canceledAt)
            : null,
          trialEnd,
        });
        subscriptionUpdated = true;
      }

      if (localLicense) {
        const licenseStatus =
          this.mapSubscriptionStatusToLicenseStatus(newStatus);
        const needsLicenseUpdate =
          localLicense.status !== licenseStatus ||
          localLicense.plan !== licensePlan ||
          (localLicense.expiresAt?.getTime() || 0) !== newPeriodEnd.getTime();

        if (needsLicenseUpdate) {
          await this.dbService.updateLicense(localLicense.id, {
            status: licenseStatus,
            plan: licensePlan,
            expiresAt: newPeriodEnd,
          });
          licenseUpdated = true;
        }
      }
    }

    // Step 5: Emit events asynchronously (don't block response)
    if (subscriptionUpdated || licenseUpdated) {
      this.emitReconciliationEvents(
        userData.email.toLowerCase(),
        userId,
        paddleData.id,
        licensePlan,
        newStatus,
        newPeriodEnd,
        {
          subscriptionUpdated,
          licenseUpdated,
          statusBefore,
          statusAfter: newStatus,
        }
      );
    }

    return {
      success: true,
      changes: {
        subscriptionUpdated,
        licenseUpdated,
        statusBefore,
        statusAfter: newStatus,
        planBefore,
        planAfter: licensePlan,
      },
      paddleSubscription: {
        id: paddleData.id,
        status: paddleData.status,
        plan: licensePlan,
        currentPeriodEnd: newPeriodEnd.toISOString(),
      },
    };
  }

  /**
   * Create customer portal session
   */
  async createPortalSession(
    userId: string
  ): Promise<PortalSessionResponseDto | PortalSessionErrorDto> {
    this.logger.debug(`Creating portal session for user: ${userId}`);

    const subscription = await this.dbService.findSubscriptionForPortal(userId);

    if (!subscription) {
      return {
        error: 'no_customer_record',
        message: 'No Paddle customer record found for this user.',
      };
    }

    const result = await this.paddleSync.createPortalSession(
      subscription.paddleCustomerId,
      [subscription.paddleSubscriptionId]
    );

    if (!result) {
      return {
        error: 'paddle_api_error',
        message: 'Unable to create portal session. Please try again later.',
      };
    }

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 60);

    return {
      url: result.url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Get checkout info for a user
   *
   * Returns the user's Paddle customer ID if they have one.
   * This allows the checkout to reuse the same customer,
   * preventing duplicate customers when re-subscribing.
   */
  async getCheckoutInfo(
    userId: string
  ): Promise<{ email: string; paddleCustomerId?: string }> {
    this.logger.debug(`Getting checkout info for user: ${userId}`);

    const user = await this.dbService.findUserById(userId);

    if (!user) {
      this.logger.warn(`User not found: ${userId}`);
      throw new Error('User not found');
    }

    return {
      email: user.email,
      paddleCustomerId: user.paddleCustomerId || undefined,
    };
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Build status response from Paddle data
   */
  private async buildStatusFromPaddle(
    paddleData: PaddleSubscriptionData,
    localSubscription: {
      status: string;
      priceId: string;
      currentPeriodEnd: Date;
    } | null,
    userId: string
  ): Promise<SubscriptionStatusResponseDto> {
    const plan = this.mapPriceIdToPlan(paddleData.priceId);
    const billingCycle = this.getBillingCycle(paddleData.priceId);
    const isActive = this.paddleSync.isActiveStatus(paddleData.status);

    const subscription: SubscriptionDetails = {
      id: paddleData.id,
      status: paddleData.status as SubscriptionDetails['status'],
      plan,
      billingCycle,
      currentPeriodEnd:
        paddleData.currentPeriodEnd ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      canceledAt: paddleData.canceledAt || undefined,
      trialEnd: paddleData.trialEnd || undefined,
    };

    const requiresSync = localSubscription
      ? this.checkRequiresSync(localSubscription, paddleData)
      : true;

    let customerPortalUrl: string | undefined;
    if (isActive && localSubscription) {
      const portalResult = await this.createPortalSession(userId);
      if ('url' in portalResult) {
        customerPortalUrl = portalResult.url;
      }
    }

    return {
      hasSubscription: isActive,
      subscription: isActive ? subscription : undefined,
      source: 'paddle',
      requiresSync,
      customerPortalUrl,
    };
  }

  /**
   * Build status response from local data
   */
  private buildStatusFromLocal(
    localSubscription: {
      paddleSubscriptionId: string;
      status: string;
      priceId: string;
      currentPeriodEnd: Date;
      canceledAt: Date | null;
      trialEnd: Date | null;
    } | null
  ): SubscriptionStatusResponseDto {
    if (!localSubscription) {
      return { hasSubscription: false, source: 'local' };
    }

    const isValidStatus = ['active', 'trialing', 'past_due'].includes(
      localSubscription.status
    );
    const isNotExpired = localSubscription.currentPeriodEnd > new Date();

    if (!isValidStatus || !isNotExpired) {
      return { hasSubscription: false, source: 'local', requiresSync: true };
    }

    const plan = this.mapPriceIdToPlan(localSubscription.priceId);
    const billingCycle = this.getBillingCycle(localSubscription.priceId);

    return {
      hasSubscription: true,
      subscription: {
        id: localSubscription.paddleSubscriptionId,
        status: localSubscription.status as SubscriptionDetails['status'],
        plan,
        billingCycle,
        currentPeriodEnd: localSubscription.currentPeriodEnd.toISOString(),
        canceledAt: localSubscription.canceledAt?.toISOString(),
        trialEnd: localSubscription.trialEnd?.toISOString(),
      },
      source: 'local',
      requiresSync: true,
    };
  }

  /**
   * Emit events after reconciliation (async, doesn't block)
   */
  private emitReconciliationEvents(
    email: string,
    userId: string,
    subscriptionId: string,
    plan: string,
    status: string,
    expiresAt: Date,
    changes: {
      subscriptionUpdated: boolean;
      licenseUpdated: boolean;
      statusBefore: string;
      statusAfter: string;
    }
  ): void {
    // License updated event
    this.eventEmitter.emit(
      SUBSCRIPTION_EVENTS.LICENSE_UPDATED,
      new LicenseUpdatedEvent(
        email,
        plan,
        this.mapSubscriptionStatusToLicenseStatus(status) as
          | 'active'
          | 'expired'
          | 'revoked'
          | 'trialing',
        expiresAt.toISOString()
      )
    );

    // Status changed event
    this.eventEmitter.emit(
      SUBSCRIPTION_EVENTS.STATUS_CHANGED,
      new SubscriptionStatusChangedEvent(
        email,
        status as 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled',
        plan
      )
    );

    // Reconciliation completed event (for audit)
    this.eventEmitter.emit(
      SUBSCRIPTION_EVENTS.RECONCILIATION_COMPLETED,
      new ReconciliationCompletedEvent(email, userId, subscriptionId, changes)
    );
  }

  /**
   * Map Paddle price ID to plan name
   */
  private mapPriceIdToPlan(priceId: string | undefined): string {
    if (!priceId) return 'expired';

    const basicMonthlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_BASIC_MONTHLY'
    );
    const basicYearlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_BASIC_YEARLY'
    );
    const proMonthlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_PRO_MONTHLY'
    );
    const proYearlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_PRO_YEARLY'
    );

    if (priceId === basicMonthlyPriceId || priceId === basicYearlyPriceId) {
      // TASK_2025_128: Basic plan no longer exists in freemium model.
      // Legacy Basic price IDs are treated as expired (match paddle.service.ts behavior).
      this.logger.warn(
        `Legacy Basic price ID detected: ${priceId}. Basic plan discontinued in freemium model. Returning 'expired'.`
      );
      return 'expired';
    }
    if (priceId === proMonthlyPriceId || priceId === proYearlyPriceId)
      return 'pro';

    this.logger.warn(`Unknown price ID: ${priceId}`);
    return 'expired';
  }

  /**
   * Determine billing cycle from price ID
   */
  private getBillingCycle(priceId: string | undefined): 'monthly' | 'yearly' {
    if (!priceId) return 'monthly';

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
    local: { status: string; priceId: string; currentPeriodEnd: Date },
    paddle: PaddleSubscriptionData
  ): boolean {
    if (local.status !== paddle.status) return true;
    if (local.priceId !== paddle.priceId) return true;

    if (paddle.currentPeriodEnd) {
      const paddleEnd = new Date(paddle.currentPeriodEnd);
      if (
        Math.abs(local.currentPeriodEnd.getTime() - paddleEnd.getTime()) > 60000
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Map Paddle subscription status to license status
   */
  private mapSubscriptionStatusToLicenseStatus(status: string): string {
    switch (status) {
      case 'active':
      case 'trialing':
      case 'past_due':
      case 'canceled':
        return 'active';
      case 'paused':
        return 'paused';
      default:
        return 'expired';
    }
  }
}
