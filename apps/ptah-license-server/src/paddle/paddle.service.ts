import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type {
  SubscriptionNotification,
  SubscriptionCreatedNotification,
  TransactionNotification,
  SubscriptionStatus,
} from '@paddle/paddle-node-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';
import { EventsService } from '../events/events.service';
import { PADDLE_CLIENT, PaddleClient } from './providers/paddle.provider';

/**
 * PaddleService - Paddle business logic and license provisioning
 *
 * Responsibilities:
 * - Handle subscription lifecycle events with SDK-typed data
 * - Provision licenses for new subscriptions
 * - Update licenses on plan changes or cancellations
 * - Send license key emails to customers
 * - Fetch customer details from Paddle API
 *
 * All handlers accept SDK notification types directly from PaddleWebhookService.
 * Customer email is resolved by PaddleWebhookService before calling handlers.
 *
 * Configuration (environment variables):
 * - PADDLE_API_KEY: Paddle API key (required)
 * - PADDLE_PRICE_ID_BASIC_MONTHLY: Price ID for basic monthly plan
 * - PADDLE_PRICE_ID_BASIC_YEARLY: Price ID for basic yearly plan
 * - PADDLE_PRICE_ID_PRO_MONTHLY: Price ID for pro monthly plan
 * - PADDLE_PRICE_ID_PRO_YEARLY: Price ID for pro yearly plan
 */
@Injectable()
export class PaddleService {
  private readonly logger = new Logger(PaddleService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly eventsService: EventsService,
    @Inject(PADDLE_CLIENT)
    private readonly paddle: PaddleClient
  ) {
    this.logger.log('Paddle service initialized');
  }

  /**
   * Fetch customer email from Paddle API using customer ID
   *
   * Paddle webhooks include customerId but not email directly.
   * This method fetches the customer details to get the email address.
   *
   * @param customerId - Paddle customer ID (ctm_xxx format)
   * @returns Customer email address or null if fetch fails
   */
  async getCustomerEmail(customerId: string): Promise<string | null> {
    if (!customerId) {
      this.logger.warn('No customer ID provided for email lookup');
      return null;
    }

    try {
      const customer = await this.paddle.customers.get(customerId);
      this.logger.log(`Fetched customer ${customerId}: ${customer.email}`);
      return customer.email;
    } catch (error) {
      this.logger.error(
        `Failed to fetch customer ${customerId}`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Handle subscription.created event (SDK-typed)
   *
   * Process:
   * 1. Check for duplicate processing via eventId (idempotency)
   * 2. Detect trial status from subscription status
   * 3. Create or find user by email
   * 4. Create subscription record with trial end date
   * 5. Generate and create license
   * 6. Send license key email
   *
   * @param data - SubscriptionCreatedNotification from SDK
   * @param email - Resolved customer email
   * @param eventId - Unique event ID for idempotency
   * @returns Processing result
   */
  async handleSubscriptionCreatedEvent(
    data: SubscriptionCreatedNotification,
    email: string,
    eventId: string
  ): Promise<{ success: boolean; duplicate?: boolean; licenseId?: string }> {
    this.logger.log(
      `Processing subscription.created event: ${eventId} for customer: ${email}, status: ${data.status}`
    );

    // Step 1: Idempotency check - prevent duplicate processing
    const existingLicense = await this.prisma.license.findFirst({
      where: { createdBy: `paddle_${eventId}` },
    });

    if (existingLicense) {
      this.logger.log(`Duplicate event detected: ${eventId} - skipping`);
      return { success: true, duplicate: true };
    }

    const normalizedEmail = email.toLowerCase();
    const priceId = data.items[0]?.price?.id;
    const basePlan = this.mapPriceIdToPlan(priceId);
    const customerId = data.customerId;
    const subscriptionId = data.id;
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days if missing
    const licenseKey = this.generateLicenseKey();

    // Step 2: Detect trial status from SDK type
    const isInTrial = data.status === 'trialing';
    const licensePlan = isInTrial ? `trial_${basePlan}` : basePlan;

    // Extract trial end from item's trialDates
    const trialDates = data.items[0]?.trialDates;
    const trialEnd = trialDates?.endsAt ? new Date(trialDates.endsAt) : null;

    if (isInTrial) {
      this.logger.log(
        `Subscription ${subscriptionId} is in trial period until ${
          trialEnd?.toISOString() || 'unknown'
        }`
      );
    }

    // Wrap all database operations in a transaction for atomicity
    const license = await this.prisma.$transaction(async (tx) => {
      // Step 3: Find or create user
      let user = await tx.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) {
        user = await tx.user.create({
          data: { email: normalizedEmail },
        });
        this.logger.log(`Created new user for email: ${normalizedEmail}`);
      }

      // Step 4: Revoke any existing active licenses (one active license per user)
      const revokedCount = await tx.license.updateMany({
        where: {
          userId: user.id,
          status: 'active',
        },
        data: {
          status: 'revoked',
        },
      });
      if (revokedCount.count > 0) {
        this.logger.log(
          `Revoked ${revokedCount.count} existing license(s) for user: ${normalizedEmail}`
        );
      }

      // Step 5: Create new license
      const newLicense = await tx.license.create({
        data: {
          userId: user.id,
          licenseKey,
          plan: licensePlan,
          status: 'active',
          expiresAt: periodEnd,
          createdBy: `paddle_${eventId}`,
        },
      });
      this.logger.log(
        `Created license: ${newLicense.id} for plan: ${licensePlan}${
          isInTrial ? ' (trial)' : ''
        }`
      );

      // Step 6: Create subscription record
      await tx.subscription.create({
        data: {
          userId: user.id,
          paddleSubscriptionId: subscriptionId,
          paddleCustomerId: customerId,
          status: data.status,
          priceId: priceId || '',
          currentPeriodEnd: periodEnd,
          trialEnd,
        },
      });
      this.logger.log(
        `Created subscription record: ${subscriptionId}, status: ${data.status}`
      );

      return newLicense;
    });

    // Step 7: Send license key email (outside transaction - non-critical)
    try {
      await this.emailService.sendLicenseKey({
        email: normalizedEmail,
        licenseKey,
        plan: licensePlan,
        expiresAt: periodEnd,
      });
      this.logger.log(`License key email sent to: ${normalizedEmail}`);
    } catch (error) {
      this.logger.error(
        `Failed to send license email to ${normalizedEmail}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    // Step 8: Emit SSE event for real-time frontend updates
    this.eventsService.emitLicenseUpdated({
      email: normalizedEmail,
      plan: licensePlan,
      status: isInTrial ? 'trialing' : 'active',
      expiresAt: periodEnd.toISOString(),
    });

    return { success: true, licenseId: license.id };
  }

  /**
   * Handle subscription.activated event (SDK-typed)
   *
   * Fires when subscription becomes fully active (payment confirmed).
   * For trials, this fires when trial ends and first payment succeeds.
   *
   * @param data - SubscriptionNotification from SDK
   * @param email - Resolved customer email
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionActivatedEvent(
    data: SubscriptionNotification,
    email: string,
    eventId: string
  ): Promise<{ success: boolean; duplicate?: boolean; licenseId?: string }> {
    this.logger.log(
      `Processing subscription.activated event: ${eventId} for customer: ${email}`
    );

    const normalizedEmail = email.toLowerCase();
    const subscriptionId = data.id;
    const priceId = data.items[0]?.price?.id;
    const basePlan = this.mapPriceIdToPlan(priceId);
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Check if we have an existing subscription (created during trial)
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { paddleSubscriptionId: subscriptionId },
      include: { user: true },
    });

    if (existingSubscription) {
      // Subscription exists - this is a trial-to-active transition
      this.logger.log(
        `Trial-to-active transition for subscription ${subscriptionId}`
      );

      // Update subscription status to active and clear trial end
      await this.prisma.subscription.update({
        where: { paddleSubscriptionId: subscriptionId },
        data: {
          status: 'active',
          currentPeriodEnd: periodEnd,
          trialEnd: null,
        },
      });

      // Update license plan from trial_X to X
      const updateResult = await this.prisma.license.updateMany({
        where: {
          userId: existingSubscription.userId,
          status: 'active',
          plan: { startsWith: 'trial_' },
        },
        data: {
          plan: basePlan,
          expiresAt: periodEnd,
        },
      });

      this.logger.log(
        `Updated ${updateResult.count} license(s) from trial to ${basePlan}`
      );

      // Emit SSE events for trial-to-active transition
      this.eventsService.emitLicenseUpdated({
        email: normalizedEmail,
        plan: basePlan,
        status: 'active',
        expiresAt: periodEnd.toISOString(),
      });

      this.eventsService.emitSubscriptionStatus({
        email: normalizedEmail,
        status: 'active',
        plan: basePlan,
      });

      return { success: true };
    }

    // No existing subscription - create new (delegate to created handler logic)
    // This handles cases where activated fires without prior created event
    return this.handleSubscriptionCreatedEvent(
      data as unknown as SubscriptionCreatedNotification,
      email,
      eventId
    );
  }

  /**
   * Handle subscription.updated event (SDK-typed)
   *
   * Updates license plan and expiration based on subscription changes.
   *
   * @param data - SubscriptionNotification from SDK
   * @param email - Resolved customer email
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionUpdatedEvent(
    data: SubscriptionNotification,
    email: string,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.log(
      `Processing subscription.updated event: ${eventId} for customer: ${email}`
    );

    const normalizedEmail = email.toLowerCase();
    const priceId = data.items[0]?.price?.id;
    const newPlan = this.mapPriceIdToPlan(priceId);
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const subscriptionId = data.id;

    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user) {
      this.logger.warn(`User not found for email: ${normalizedEmail}`);
      return { success: false, error: 'User not found' };
    }

    // Update subscription record
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: {
        status: data.status,
        priceId: priceId || '',
        currentPeriodEnd: periodEnd,
        canceledAt: data.canceledAt ? new Date(data.canceledAt) : null,
      },
    });
    this.logger.log(`Updated subscription: ${subscriptionId}`);

    // Update active licenses for this user
    const updateResult = await this.prisma.license.updateMany({
      where: {
        userId: user.id,
        status: 'active',
      },
      data: {
        plan: newPlan,
        expiresAt: periodEnd,
      },
    });

    this.logger.log(
      `Updated ${
        updateResult.count
      } license(s) to plan: ${newPlan}, expires: ${periodEnd.toISOString()}`
    );

    // Emit SSE event for real-time frontend updates
    this.eventsService.emitLicenseUpdated({
      email: normalizedEmail,
      plan: newPlan,
      status: 'active',
      expiresAt: periodEnd.toISOString(),
    });

    return { success: true };
  }

  /**
   * Handle subscription.canceled event (SDK-typed)
   *
   * Sets license expiration to end of current billing period.
   *
   * @param data - SubscriptionNotification from SDK
   * @param email - Resolved customer email
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionCanceledEvent(
    data: SubscriptionNotification,
    email: string,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.log(
      `Processing subscription.canceled event: ${eventId} for customer: ${email}`
    );

    const normalizedEmail = email.toLowerCase();
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date();
    const subscriptionId = data.id;
    const canceledAt = data.canceledAt ? new Date(data.canceledAt) : new Date();

    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user) {
      this.logger.warn(`User not found for email: ${normalizedEmail}`);
      return { success: false, error: 'User not found' };
    }

    // Update subscription record
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: {
        status: 'canceled',
        canceledAt,
        currentPeriodEnd: periodEnd,
      },
    });
    this.logger.log(`Marked subscription as canceled: ${subscriptionId}`);

    // Update license expiration - user keeps access until period ends
    const updateResult = await this.prisma.license.updateMany({
      where: {
        userId: user.id,
        status: 'active',
      },
      data: {
        expiresAt: periodEnd,
      },
    });

    this.logger.log(
      `Updated ${
        updateResult.count
      } license(s) with cancellation expiry: ${periodEnd.toISOString()}`
    );

    // Get current plan for the notification
    const currentLicense = await this.prisma.license.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    // Emit SSE event for canceled status
    this.eventsService.emitSubscriptionStatus({
      email: normalizedEmail,
      status: 'canceled',
      plan: currentLicense?.plan || 'unknown',
    });

    return { success: true };
  }

  /**
   * Handle subscription.past_due event (SDK-typed)
   *
   * Payment failed but subscription not yet canceled (dunning period).
   *
   * @param data - SubscriptionNotification from SDK
   * @param email - Resolved customer email
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionPastDueEvent(
    data: SubscriptionNotification,
    email: string,
    eventId: string
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.past_due event: ${eventId} for customer: ${email}`
    );

    const normalizedEmail = email.toLowerCase();
    const subscriptionId = data.id;

    // Update subscription status to past_due
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'past_due' },
    });

    this.logger.warn(
      `Subscription ${subscriptionId} is past due for ${normalizedEmail} - payment retry in progress`
    );

    // Get current license plan for the notification
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    const currentLicense = user
      ? await this.prisma.license.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    // Emit SSE event for past_due status
    this.eventsService.emitSubscriptionStatus({
      email: normalizedEmail,
      status: 'past_due',
      plan: currentLicense?.plan || 'unknown',
    });

    return { success: true };
  }

  /**
   * Handle subscription.paused event (SDK-typed)
   *
   * User has paused subscription - lose access to premium features.
   *
   * @param data - SubscriptionNotification from SDK
   * @param email - Resolved customer email
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionPausedEvent(
    data: SubscriptionNotification,
    email: string,
    eventId: string
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.paused event: ${eventId} for customer: ${email}`
    );

    const subscriptionId = data.id;
    const normalizedEmail = email.toLowerCase();

    // Update subscription status to paused
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'paused' },
    });

    // Find user and update license status
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (user) {
      // Get license before update for plan info
      const license = await this.prisma.license.findFirst({
        where: { userId: user.id, status: 'active' },
      });

      await this.prisma.license.updateMany({
        where: { userId: user.id, status: 'active' },
        data: { status: 'paused' },
      });
      this.logger.log(
        `License(s) paused for user ${normalizedEmail} - subscription ${subscriptionId}`
      );

      // Emit SSE event for paused status
      this.eventsService.emitSubscriptionStatus({
        email: normalizedEmail,
        status: 'paused',
        plan: license?.plan || 'unknown',
      });
    } else {
      this.logger.warn(
        `User not found for email: ${normalizedEmail} during pause event`
      );
    }

    this.logger.log(`Subscription ${subscriptionId} paused for ${normalizedEmail}`);
    return { success: true };
  }

  /**
   * Handle subscription.resumed event (SDK-typed)
   *
   * User has resumed paused subscription - regain access.
   *
   * @param data - SubscriptionNotification from SDK
   * @param email - Resolved customer email
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionResumedEvent(
    data: SubscriptionNotification,
    email: string,
    eventId: string
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.resumed event: ${eventId} for customer: ${email}`
    );

    const subscriptionId = data.id;
    const normalizedEmail = email.toLowerCase();
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Update subscription status to active
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'active', currentPeriodEnd: periodEnd },
    });

    // Find user and reactivate license
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (user) {
      // Get license before update for plan info
      const license = await this.prisma.license.findFirst({
        where: { userId: user.id, status: 'paused' },
      });

      await this.prisma.license.updateMany({
        where: { userId: user.id, status: 'paused' },
        data: { status: 'active', expiresAt: periodEnd },
      });
      this.logger.log(
        `License(s) reactivated for user ${normalizedEmail} - expires ${periodEnd.toISOString()}`
      );

      // Emit SSE events for resumed status
      this.eventsService.emitLicenseUpdated({
        email: normalizedEmail,
        plan: license?.plan || 'unknown',
        status: 'active',
        expiresAt: periodEnd.toISOString(),
      });

      this.eventsService.emitSubscriptionStatus({
        email: normalizedEmail,
        status: 'active',
        plan: license?.plan || 'unknown',
      });
    } else {
      this.logger.warn(
        `User not found for email: ${normalizedEmail} during resume event`
      );
    }

    this.logger.log(`Subscription ${subscriptionId} resumed for ${normalizedEmail}`);
    return { success: true };
  }

  /**
   * Handle transaction.completed event (SDK-typed)
   *
   * Fires on successful payment - extends license for subscription renewals.
   *
   * @param data - TransactionNotification from SDK
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleTransactionCompletedEvent(
    data: TransactionNotification,
    eventId: string
  ): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
    this.logger.log(
      `Processing transaction.completed event: ${eventId}, transaction: ${data.id}`
    );

    // Step 1: Check if this is a subscription transaction
    if (!data.subscriptionId) {
      this.logger.log(
        `Transaction ${data.id} is not a subscription transaction (one-time purchase) - skipping`
      );
      return { success: true, skipped: true };
    }

    const subscriptionId = data.subscriptionId;
    this.logger.log(
      `Transaction ${data.id} is for subscription ${subscriptionId}`
    );

    // Step 2: Verify billing period exists (required for renewals)
    if (!data.billingPeriod) {
      this.logger.warn(
        `Transaction ${data.id} has subscriptionId but no billingPeriod - cannot extend license`
      );
      return {
        success: false,
        error: 'No billing_period in transaction data',
      };
    }

    const newPeriodEnd = new Date(data.billingPeriod.endsAt);

    // Step 3: Find existing subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { paddleSubscriptionId: subscriptionId },
      include: { user: true },
    });

    if (!subscription) {
      this.logger.warn(
        `No local subscription found for Paddle subscription ${subscriptionId} - ` +
          `this may be a new subscription not yet processed by subscription.created`
      );
      return {
        success: false,
        error: `Subscription ${subscriptionId} not found in database`,
      };
    }

    const email = subscription.user.email;

    // Step 4: Update subscription currentPeriodEnd
    await this.prisma.subscription.update({
      where: { paddleSubscriptionId: subscriptionId },
      data: {
        currentPeriodEnd: newPeriodEnd,
        status: 'active',
      },
    });
    this.logger.log(
      `Updated subscription ${subscriptionId} period end to ${newPeriodEnd.toISOString()}`
    );

    // Step 5: Update license expiresAt
    const updateResult = await this.prisma.license.updateMany({
      where: {
        userId: subscription.userId,
        status: 'active',
      },
      data: {
        expiresAt: newPeriodEnd,
      },
    });

    this.logger.log(
      `Extended ${updateResult.count} license(s) for user ${email} to ${newPeriodEnd.toISOString()}`
    );

    // Step 6: Get current license plan for SSE event
    const currentLicense = await this.prisma.license.findFirst({
      where: { userId: subscription.userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });

    // Step 7: Emit SSE event for real-time frontend updates
    this.eventsService.emitLicenseUpdated({
      email,
      plan: currentLicense?.plan || 'unknown',
      status: 'active',
      expiresAt: newPeriodEnd.toISOString(),
    });

    this.logger.log(
      `Renewal processed successfully for subscription ${subscriptionId}, user ${email}`
    );

    return { success: true };
  }

  /**
   * Map Paddle price ID to internal plan name
   *
   * Supports 4 price IDs for Basic and Pro plans (monthly/yearly each).
   *
   * @param priceId - Paddle price ID from SDK notification
   * @returns Internal plan name ('basic' | 'pro' | 'expired')
   */
  private mapPriceIdToPlan(priceId: string | undefined): string {
    if (!priceId) {
      this.logger.warn('No price ID provided - returning expired tier');
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

    this.logger.warn(
      `Unknown price ID: ${priceId} - returning 'expired'. ` +
        `Expected one of: ${
          [
            basicMonthlyPriceId,
            basicYearlyPriceId,
            proMonthlyPriceId,
            proYearlyPriceId,
          ]
            .filter(Boolean)
            .join(', ') || 'no price IDs configured'
        }`
    );
    return 'expired';
  }

  /**
   * Generate a cryptographically secure license key
   *
   * Format: ptah_lic_{64 lowercase hex chars}
   * Entropy: 256 bits (32 bytes = 64 hex chars)
   *
   * @returns A unique license key in ptah_lic_ format (73 chars total)
   */
  private generateLicenseKey(): string {
    const bytes = randomBytes(32);
    return `ptah_lic_${bytes.toString('hex')}`;
  }
}
