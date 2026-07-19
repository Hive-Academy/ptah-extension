import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SubscriptionCreatedNotification,
  SubscriptionNotification,
  TransactionNotification,
} from '@paddle/paddle-node-sdk';
import { randomBytes } from 'crypto';
import { CircleProvisioningService } from '../circle/circle-provisioning.service';
import {
  WAITLIST_CONVERSION_SINK,
  type WaitlistConversionSink,
} from '../circle/waitlist-conversion.sink';
import { SessionsService } from '../google-sessions/sessions.service';
import { DiscourseProvisioningService } from '../discourse/discourse-provisioning.service';
import { EmailService } from '../email/services/email.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { PADDLE_CLIENT, PaddleClient } from './providers/paddle.provider';

/**
 * PaddleService - Paddle business logic and license provisioning
 *
 * Open-source + Builders model - only the paid Builders plan uses Paddle.
 * Community tier is FREE and has no Paddle integration.
 *
 * Responsibilities:
 * - Handle subscription lifecycle events with SDK-typed data
 * - Provision licenses for new Builders subscriptions
 * - Update licenses on plan changes or cancellations
 * - Send license key emails to customers
 * - Fetch customer details from Paddle API
 *
 * All handlers accept SDK notification types directly from PaddleWebhookService.
 * Customer email is resolved by PaddleWebhookService before calling handlers.
 *
 * Configuration (environment variables):
 * - PADDLE_API_KEY: Paddle API key (required)
 * - PADDLE_PRICE_ID_BUILDERS_MONTHLY: Price ID for Builders monthly plan
 * - PADDLE_PRICE_ID_BUILDERS_YEARLY: Price ID for Builders yearly plan
 */
@Injectable()
export class PaddleService {
  private readonly logger = new Logger(PaddleService.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(EventsService) private readonly eventsService: EventsService,
    @Inject(PADDLE_CLIENT)
    private readonly paddle: PaddleClient,
    @Inject(CircleProvisioningService)
    private readonly circleProvisioning: CircleProvisioningService,
    // Optional: owned-community provisioning. Both are bound by their @Global()
    // modules (GoogleSessionsModule / DiscourseModule); @Optional keeps the
    // webhook path resilient if a module is ever unregistered in a test/build.
    @Optional()
    @Inject(SessionsService)
    private readonly sessions: SessionsService | undefined,
    @Optional()
    @Inject(DiscourseProvisioningService)
    private readonly discourseProvisioning:
      | DiscourseProvisioningService
      | undefined,
    // Optional: the waitlist conversion sink (WaitlistService.markConverted) is
    // bound by the invite-waves agent. When unbound this resolves to undefined
    // and the conversion stamp is skipped — see waitlist-conversion.sink.ts.
    @Optional()
    @Inject(WAITLIST_CONVERSION_SINK)
    private readonly waitlistSink: WaitlistConversionSink | undefined,
  ) {
    this.logger.log('Paddle service initialized');
  }

  /**
   * Best-effort provisioning fan-out for a newly paid/renewed Builders member:
   * (a) Circle community invite + circleMemberId persistence,
   * (b) waitlist conversion stamp (convertedAt) via the optional sink,
   * (c) Google Calendar Builders-session attendee add, and
   * (d) Discourse `builders` group add.
   *
   * Every step is non-fatal — the underlying services never throw — and the
   * calls are guarded so a missing/failing collaborator never disrupts the
   * webhook path.
   */
  private async fanOutBuildersProvisioning(
    userId: string,
    email: string,
  ): Promise<void> {
    await this.circleProvisioning.provisionBuildersMember(userId, email);
    await this.markWaitlistConverted(email);
    await this.syncOwnedCommunity(userId, email, true);
  }

  /**
   * Best-effort deprovisioning fan-out when a Builders member lapses:
   * (a) Circle community removal, (b) Google session attendee removal, and
   * (c) Discourse `builders` group removal. Non-fatal — never fails the webhook.
   */
  private async fanOutBuildersDeprovisioning(
    userId: string,
    email: string,
  ): Promise<void> {
    await this.circleProvisioning.deprovisionBuildersMember(userId);
    await this.syncOwnedCommunity(userId, email, false);
  }

  /**
   * Owned-community sync (Google session attendance + Discourse group). Both
   * collaborators are optional and self-guarding; failures are swallowed here
   * as an extra belt-and-braces so nothing escapes into the webhook path.
   */
  private async syncOwnedCommunity(
    userId: string,
    email: string,
    isMember: boolean,
  ): Promise<void> {
    try {
      if (this.sessions) {
        if (isMember) {
          await this.sessions.addMemberToSessions(email);
        } else {
          await this.sessions.removeMemberFromSessions(email);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Session attendee sync failed for ${email}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    try {
      if (this.discourseProvisioning) {
        await this.discourseProvisioning.syncBuildersGroup(
          userId,
          email,
          isMember,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Discourse group sync failed for ${email}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Stamp the waitlist row as converted, if the optional sink is bound.
   * Best-effort: absence or failure is logged and swallowed.
   */
  private async markWaitlistConverted(email: string): Promise<void> {
    if (!this.waitlistSink) {
      return;
    }
    try {
      await this.waitlistSink.markConverted(email);
    } catch (error) {
      this.logger.warn(
        `Failed to mark waitlist converted for ${email}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
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
        error instanceof Error ? error.message : 'Unknown error',
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
    eventId: string,
  ): Promise<{ success: boolean; duplicate?: boolean; licenseId?: string }> {
    this.logger.log(
      `Processing subscription.created event: ${eventId} for customer: ${email}, status: ${data.status}`,
    );

    const subscriptionId = data.id;
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { paddleSubscriptionId: subscriptionId },
    });

    if (existingSubscription) {
      this.logger.log(
        `Subscription ${subscriptionId} already exists (event: ${eventId}) - skipping duplicate`,
      );
      return { success: true, duplicate: true };
    }
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
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days if missing
    const licenseKey = this.generateLicenseKey();
    const isInTrial = data.status === 'trialing';
    // No legacy trial plans: the license plan is always the resolved base plan.
    const licensePlan = basePlan;
    const trialDates = data.items[0]?.trialDates;
    const trialEnd = trialDates?.endsAt ? new Date(trialDates.endsAt) : null;

    if (isInTrial) {
      this.logger.log(
        `Subscription ${subscriptionId} is in trial period until ${
          trialEnd?.toISOString() || 'unknown'
        }`,
      );
    }
    const license = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (!user) {
        user = await tx.user.create({
          data: { email: normalizedEmail, paddleCustomerId: customerId },
        });
        this.logger.log(`Created new user for email: ${normalizedEmail}`);
      } else if (!user.paddleCustomerId && customerId) {
        user = await tx.user.update({
          where: { id: user.id },
          data: { paddleCustomerId: customerId },
        });
        this.logger.log(
          `Saved Paddle customer ID ${customerId} to user: ${normalizedEmail}`,
        );
      }
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
          `Revoked ${revokedCount.count} existing license(s) for user: ${normalizedEmail}`,
        );
      }
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
        }`,
      );
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
        `Created subscription record: ${subscriptionId}, status: ${data.status}`,
      );

      return newLicense;
    });
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
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
    this.eventsService.emitLicenseUpdated({
      email: normalizedEmail,
      plan: licensePlan,
      status: isInTrial ? 'trialing' : 'active',
      expiresAt: periodEnd.toISOString(),
    });

    // Provisioning fan-out for paid Builders members (best-effort, non-fatal):
    // Circle community invite + waitlist conversion stamp. Runs after license
    // issuance so `license.userId` is available.
    if (licensePlan === 'builders') {
      await this.fanOutBuildersProvisioning(license.userId, normalizedEmail);
    }

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
    eventId: string,
  ): Promise<{ success: boolean; duplicate?: boolean; licenseId?: string }> {
    this.logger.log(
      `Processing subscription.activated event: ${eventId} for customer: ${email}`,
    );

    const normalizedEmail = email.toLowerCase();
    const subscriptionId = data.id;
    const priceId = data.items[0]?.price?.id;
    const basePlan = this.mapPriceIdToPlan(priceId);
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { paddleSubscriptionId: subscriptionId },
      include: { user: true },
    });

    if (existingSubscription) {
      this.logger.log(
        `Trial-to-active transition for subscription ${subscriptionId}`,
      );
      await this.prisma.subscription.update({
        where: { paddleSubscriptionId: subscriptionId },
        data: {
          status: 'active',
          currentPeriodEnd: periodEnd,
          trialEnd: null,
        },
      });
      const updateResult = await this.prisma.license.updateMany({
        where: {
          userId: existingSubscription.userId,
          status: 'active',
        },
        data: {
          plan: basePlan,
          expiresAt: periodEnd,
        },
      });

      this.logger.log(
        `Updated ${updateResult.count} license(s) to ${basePlan}`,
      );
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

      // Trial/pending -> active transition for a Builders member: run the
      // provisioning fan-out (Circle invite + waitlist conversion). Best-effort.
      if (basePlan === 'builders') {
        await this.fanOutBuildersProvisioning(
          existingSubscription.userId,
          normalizedEmail,
        );
      }

      return { success: true };
    }
    return this.handleSubscriptionCreatedEvent(
      data as unknown as SubscriptionCreatedNotification,
      email,
      eventId,
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
    eventId: string,
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.log(
      `Processing subscription.updated event: ${eventId} for customer: ${email}`,
    );

    const normalizedEmail = email.toLowerCase();
    const priceId = data.items[0]?.price?.id;
    const newPlan = this.mapPriceIdToPlan(priceId);
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const subscriptionId = data.id;
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user) {
      this.logger.warn(`User not found for email: ${normalizedEmail}`);
      return { success: false, error: 'User not found' };
    }
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
      } license(s) to plan: ${newPlan}, expires: ${periodEnd.toISOString()}`,
    );
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
    eventId: string,
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.log(
      `Processing subscription.canceled event: ${eventId} for customer: ${email}`,
    );

    const normalizedEmail = email.toLowerCase();
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date();
    const subscriptionId = data.id;
    const canceledAt = data.canceledAt ? new Date(data.canceledAt) : new Date();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user) {
      this.logger.warn(`User not found for email: ${normalizedEmail}`);
      return { success: false, error: 'User not found' };
    }
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: {
        status: 'canceled',
        canceledAt,
        currentPeriodEnd: periodEnd,
      },
    });
    this.logger.log(`Marked subscription as canceled: ${subscriptionId}`);
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
      } license(s) with cancellation expiry: ${periodEnd.toISOString()}`,
    );
    const currentLicense = await this.prisma.license.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    this.eventsService.emitSubscriptionStatus({
      email: normalizedEmail,
      status: 'canceled',
      plan: currentLicense?.plan || 'unknown',
    });

    // Deprovision owned-community access (best-effort, non-fatal): Circle
    // removal + Google session attendee removal + Discourse builders group
    // removal. Safe to call unconditionally — each step no-ops when the user
    // has nothing on record (e.g. non-Builders users).
    await this.fanOutBuildersDeprovisioning(user.id, normalizedEmail);

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
    eventId: string,
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.past_due event: ${eventId} for customer: ${email}`,
    );

    const normalizedEmail = email.toLowerCase();
    const subscriptionId = data.id;
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'past_due' },
    });

    this.logger.warn(
      `Subscription ${subscriptionId} is past due for ${normalizedEmail} - payment retry in progress`,
    );
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    const currentLicense = user
      ? await this.prisma.license.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
        })
      : null;
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
    eventId: string,
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.paused event: ${eventId} for customer: ${email}`,
    );

    const subscriptionId = data.id;
    const normalizedEmail = email.toLowerCase();
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'paused' },
    });
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (user) {
      const license = await this.prisma.license.findFirst({
        where: { userId: user.id, status: 'active' },
      });

      await this.prisma.license.updateMany({
        where: { userId: user.id, status: 'active' },
        data: { status: 'paused' },
      });
      this.logger.log(
        `License(s) paused for user ${normalizedEmail} - subscription ${subscriptionId}`,
      );
      this.eventsService.emitSubscriptionStatus({
        email: normalizedEmail,
        status: 'paused',
        plan: license?.plan || 'unknown',
      });
    } else {
      this.logger.warn(
        `User not found for email: ${normalizedEmail} during pause event`,
      );
    }

    this.logger.log(
      `Subscription ${subscriptionId} paused for ${normalizedEmail}`,
    );
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
    eventId: string,
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.resumed event: ${eventId} for customer: ${email}`,
    );

    const subscriptionId = data.id;
    const normalizedEmail = email.toLowerCase();
    const periodEnd = data.currentBillingPeriod
      ? new Date(data.currentBillingPeriod.endsAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'active', currentPeriodEnd: periodEnd },
    });
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (user) {
      const license = await this.prisma.license.findFirst({
        where: { userId: user.id, status: 'paused' },
      });

      await this.prisma.license.updateMany({
        where: { userId: user.id, status: 'paused' },
        data: { status: 'active', expiresAt: periodEnd },
      });
      this.logger.log(
        `License(s) reactivated for user ${normalizedEmail} - expires ${periodEnd.toISOString()}`,
      );
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
        `User not found for email: ${normalizedEmail} during resume event`,
      );
    }

    this.logger.log(
      `Subscription ${subscriptionId} resumed for ${normalizedEmail}`,
    );
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
    eventId: string,
  ): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
    this.logger.log(
      `Processing transaction.completed event: ${eventId}, transaction: ${data.id}`,
    );
    if (!data.subscriptionId) {
      const sessionPriceId = this.configService.get<string>(
        'PADDLE_PRICE_ID_SESSION',
      );
      const transactionPriceId = data.items?.[0]?.price?.id;

      if (sessionPriceId && transactionPriceId === sessionPriceId) {
        this.logger.log(
          `Transaction ${data.id} is a session payment - updating session request`,
        );
        await this.prisma.sessionRequest.updateMany({
          where: { paddleTransactionId: data.id, paymentStatus: 'pending' },
          data: { paymentStatus: 'completed' },
        });
        return { success: true };
      }

      this.logger.log(
        `Transaction ${data.id} is not a subscription transaction (one-time purchase) - skipping`,
      );
      return { success: true, skipped: true };
    }

    const subscriptionId = data.subscriptionId;
    this.logger.log(
      `Transaction ${data.id} is for subscription ${subscriptionId}`,
    );
    if (!data.billingPeriod) {
      this.logger.warn(
        `Transaction ${data.id} has subscriptionId but no billingPeriod - cannot extend license`,
      );
      return {
        success: false,
        error: 'No billing_period in transaction data',
      };
    }

    const newPeriodEnd = new Date(data.billingPeriod.endsAt);
    const subscription = await this.prisma.subscription.findUnique({
      where: { paddleSubscriptionId: subscriptionId },
      include: { user: true },
    });

    if (!subscription) {
      this.logger.warn(
        `No local subscription found for Paddle subscription ${subscriptionId} - ` +
          `this may be a new subscription not yet processed by subscription.created`,
      );
      return {
        success: false,
        error: `Subscription ${subscriptionId} not found in database`,
      };
    }

    const email = subscription.user.email;
    await this.prisma.subscription.update({
      where: { paddleSubscriptionId: subscriptionId },
      data: {
        currentPeriodEnd: newPeriodEnd,
        status: 'active',
      },
    });
    this.logger.log(
      `Updated subscription ${subscriptionId} period end to ${newPeriodEnd.toISOString()}`,
    );
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
      `Extended ${
        updateResult.count
      } license(s) for user ${email} to ${newPeriodEnd.toISOString()}`,
    );
    const currentLicense = await this.prisma.license.findFirst({
      where: { userId: subscription.userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    this.eventsService.emitLicenseUpdated({
      email,
      plan: currentLicense?.plan || 'unknown',
      status: 'active',
      expiresAt: newPeriodEnd.toISOString(),
    });

    this.logger.log(
      `Renewal processed successfully for subscription ${subscriptionId}, user ${email}`,
    );

    return { success: true };
  }

  /**
   * Map Paddle price ID to internal plan name
   *
   * Open-source + Builders model — 'builders' is the only premium plan.
   * Community tier is FREE and has no Paddle integration.
   *
   * @param priceId - Paddle price ID from SDK notification
   * @returns Internal plan name ('builders' | 'expired')
   */
  private mapPriceIdToPlan(priceId: string | undefined): string {
    if (!priceId) {
      this.logger.warn('No price ID provided - returning expired tier');
      return 'expired';
    }
    const buildersMonthlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_BUILDERS_MONTHLY',
    );
    const buildersYearlyPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_BUILDERS_YEARLY',
    );
    if (
      priceId === buildersMonthlyPriceId ||
      priceId === buildersYearlyPriceId
    ) {
      return 'builders';
    }

    this.logger.warn(
      `Unknown price ID: ${priceId} - returning 'expired'. ` +
        `Expected Builders price IDs: ${
          [buildersMonthlyPriceId, buildersYearlyPriceId]
            .filter(Boolean)
            .join(', ') || 'no Builders price IDs configured'
        }`,
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
