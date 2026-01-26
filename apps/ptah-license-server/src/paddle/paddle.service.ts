import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { EventEntity } from '@paddle/paddle-node-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';
import { PaddleSubscriptionDataDto } from './dto/paddle-webhook.dto';
import { PADDLE_CLIENT, PaddleClient } from './providers/paddle.provider';

/**
 * PaddleService - Paddle webhook processing and license provisioning
 *
 * Responsibilities:
 * - Verify webhook signatures using HMAC SHA256
 * - Handle subscription lifecycle events (created, updated, canceled)
 * - Provision licenses for new subscriptions
 * - Update licenses on plan changes or cancellations
 * - Send license key emails to customers
 *
 * Security:
 * - Timing-safe signature comparison to prevent timing attacks
 * - Idempotent processing via createdBy field with paddle_{eventId}
 *
 * Configuration (environment variables):
 * - PADDLE_API_KEY: Paddle API key (required)
 * - PADDLE_WEBHOOK_SECRET: Webhook signature secret (required)
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
    @Inject(PADDLE_CLIENT)
    private readonly paddle: PaddleClient
  ) {
    this.logger.log('Paddle service initialized');

    // Log webhook configuration status
    const webhookSecret = this.configService.get<string>(
      'PADDLE_WEBHOOK_SECRET'
    );
    if (!webhookSecret) {
      this.logger.warn(
        'PADDLE_WEBHOOK_SECRET not configured - webhook verification will fail'
      );
    }
  }

  /**
   * Verify Paddle webhook signature using HMAC SHA256
   *
   * Paddle signature format: ts={timestamp};h1={signature}
   *
   * Verification process:
   * 1. Parse timestamp and signature from header
   * 2. Construct signed payload: {timestamp}:{rawBody}
   * 3. Compute HMAC SHA256 with webhook secret
   * 4. Compare using timing-safe comparison
   *
   * @param signature - The paddle-signature header value
   * @param rawBody - The raw request body as Buffer
   * @returns true if signature is valid, false otherwise
   */
  verifySignature(signature: string, rawBody: Buffer): boolean {
    if (!signature || !rawBody) {
      this.logger.warn('Missing signature or raw body for verification');
      return false;
    }

    const webhookSecret = this.configService.get<string>(
      'PADDLE_WEBHOOK_SECRET'
    );
    if (!webhookSecret) {
      this.logger.error('PADDLE_WEBHOOK_SECRET not configured');
      return false;
    }

    try {
      // Parse signature header: ts=1234567890;h1=abc123...
      const parts = signature.split(';');
      const timestampPart = parts.find((p) => p.startsWith('ts='));
      const signaturePart = parts.find((p) => p.startsWith('h1='));

      if (!timestampPart || !signaturePart) {
        this.logger.warn('Invalid signature format - missing ts or h1');
        return false;
      }

      const timestamp = timestampPart.split('=')[1];
      const receivedSignature = signaturePart.split('=')[1];

      // Construct the signed payload: {timestamp}:{rawBody}
      const signedPayload = `${timestamp}:${rawBody.toString()}`;

      // Compute expected signature using HMAC SHA256
      const expectedSignature = createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');

      // Timing-safe comparison to prevent timing attacks
      const receivedBuffer = Buffer.from(receivedSignature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      // Ensure buffers are same length before comparison
      if (receivedBuffer.length !== expectedBuffer.length) {
        this.logger.warn('Signature length mismatch');
        return false;
      }

      const isValid = timingSafeEqual(receivedBuffer, expectedBuffer);

      if (!isValid) {
        this.logger.warn('Webhook signature verification failed');
      }

      return isValid;
    } catch (error) {
      this.logger.error(
        'Error verifying webhook signature',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return false;
    }
  }

  /**
   * Verify webhook timestamp is within acceptable window (5 minutes)
   *
   * Prevents replay attacks by rejecting webhooks with stale timestamps.
   * Paddle includes a Unix timestamp in the signature header.
   *
   * Security:
   * - 5-minute window accounts for clock skew and network latency
   * - Rejects both past and future timestamps outside window
   * - Must be called BEFORE processing webhook payload
   *
   * @param signature - The paddle-signature header value (format: ts={timestamp};h1={signature})
   * @returns true if timestamp is within 5-minute window, false otherwise
   */
  verifyTimestamp(signature: string): boolean {
    if (!signature) {
      this.logger.warn('Missing signature for timestamp verification');
      return false;
    }

    try {
      // Parse timestamp from signature header: ts=1234567890;h1=abc123...
      const timestampPart = signature
        .split(';')
        .find((p) => p.startsWith('ts='));

      if (!timestampPart) {
        this.logger.warn('Invalid signature format - missing timestamp');
        return false;
      }

      const timestampStr = timestampPart.split('=')[1];
      if (!timestampStr) {
        this.logger.warn('Invalid timestamp format in signature');
        return false;
      }

      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp)) {
        this.logger.warn(`Invalid timestamp value: ${timestampStr}`);
        return false;
      }

      const now = Math.floor(Date.now() / 1000);
      const fiveMinutes = 5 * 60; // 300 seconds

      const isWithinWindow = Math.abs(now - timestamp) <= fiveMinutes;

      if (!isWithinWindow) {
        this.logger.warn(
          `Webhook timestamp outside acceptable window. ` +
            `Timestamp: ${timestamp}, Now: ${now}, Diff: ${Math.abs(
              now - timestamp
            )}s`
        );
      }

      return isWithinWindow;
    } catch (error) {
      this.logger.error(
        'Error verifying webhook timestamp',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return false;
    }
  }

  /**
   * Unmarshal and verify webhook using Paddle SDK (Paddle Billing v2 best practice)
   *
   * This method uses the official Paddle SDK for type-safe webhook verification.
   * It's an alternative to manual HMAC verification that provides:
   * - Type-safe event entities
   * - Automatic signature verification
   * - Built-in timestamp validation
   *
   * @param signature - The paddle-signature header value
   * @param rawBody - The raw request body as string
   * @returns Typed EventEntity or null if verification fails
   */
  async unmarshalWebhook(
    signature: string,
    rawBody: string
  ): Promise<EventEntity | null> {
    const webhookSecret = this.configService.get<string>(
      'PADDLE_WEBHOOK_SECRET'
    );

    if (!webhookSecret) {
      this.logger.error('PADDLE_WEBHOOK_SECRET not configured');
      return null;
    }

    try {
      const event = await this.paddle.webhooks.unmarshal(
        rawBody,
        webhookSecret,
        signature
      );
      this.logger.log(`Webhook unmarshaled successfully: ${event.eventType}`);
      return event;
    } catch (error) {
      this.logger.error(
        'Webhook unmarshal failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return null;
    }
  }

  /**
   * Handle subscription.created event
   *
   * TASK_2025_121: Enhanced with trial status detection
   *
   * Process:
   * 1. Check for duplicate processing via eventId (idempotency)
   * 2. Detect trial status from subscription.status === 'trialing'
   * 3. Create or find user by email
   * 4. Create subscription record with trial end date
   * 5. Generate and create license with trial-aware plan
   * 6. Send license key email
   *
   * Trial handling:
   * - When data.status === 'trialing', license plan becomes 'trial_basic' or 'trial_pro'
   * - trialEnd date is stored in subscription record from data.trial_end
   * - When subscription.activated fires, plan is updated to non-trial version
   *
   * All database operations are wrapped in a transaction for atomicity.
   * If any step fails, all changes are rolled back.
   *
   * @param data - Subscription data from webhook payload
   * @param eventId - Unique event ID for idempotency
   * @returns Processing result
   */
  async handleSubscriptionCreated(
    data: PaddleSubscriptionDataDto,
    eventId: string
  ): Promise<{ success: boolean; duplicate?: boolean; licenseId?: string }> {
    this.logger.log(
      `Processing subscription.created event: ${eventId} for customer: ${data.customer.email}, status: ${data.status}`
    );

    // Step 1: Idempotency check - prevent duplicate processing
    const existingLicense = await this.prisma.license.findFirst({
      where: { createdBy: `paddle_${eventId}` },
    });

    if (existingLicense) {
      this.logger.log(`Duplicate event detected: ${eventId} - skipping`);
      return { success: true, duplicate: true };
    }

    const email = data.customer.email.toLowerCase();
    const priceId = data.items[0]?.price?.id;
    const basePlan = this.mapPriceIdToPlan(priceId);
    const customerId = data.customer.id;
    const subscriptionId = data.id;
    const periodEnd = new Date(data.current_billing_period.ends_at);
    const licenseKey = this.generateLicenseKey();

    // Step 2: Detect trial status from Paddle webhook
    const isInTrial = data.status === 'trialing';
    const licensePlan = isInTrial ? `trial_${basePlan}` : basePlan;
    const trialEnd = data.trial_end ? new Date(data.trial_end) : null;

    if (isInTrial) {
      this.logger.log(
        `Subscription ${subscriptionId} is in trial period until ${
          trialEnd?.toISOString() || 'unknown'
        }`
      );
    }

    // Wrap all database operations in a transaction for atomicity
    // If any operation fails, all changes are rolled back
    const license = await this.prisma.$transaction(async (tx) => {
      // Step 3: Find or create user
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        user = await tx.user.create({
          data: { email },
        });
        this.logger.log(`Created new user for email: ${email}`);
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
          `Revoked ${revokedCount.count} existing license(s) for user: ${email}`
        );
      }

      // Step 5: Create new license with trial-aware plan
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

      // Step 6: Create subscription record with trial end date
      await tx.subscription.create({
        data: {
          userId: user.id,
          paddleSubscriptionId: subscriptionId,
          paddleCustomerId: customerId,
          status: data.status,
          priceId: priceId || '',
          currentPeriodEnd: periodEnd,
          trialEnd, // Store trial end date for trial detection
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
        email,
        licenseKey,
        plan: licensePlan,
        expiresAt: periodEnd,
      });
      this.logger.log(`License key email sent to: ${email}`);
    } catch (error) {
      // Log error but don't fail the webhook - license is already created
      this.logger.error(
        `Failed to send license email to ${email}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    return { success: true, licenseId: license.id };
  }

  /**
   * Handle subscription.updated event
   *
   * Updates license plan and expiration based on subscription changes.
   * Handles plan upgrades/downgrades and billing period changes.
   *
   * @param data - Subscription data from webhook payload
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionUpdated(
    data: PaddleSubscriptionDataDto,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.log(
      `Processing subscription.updated event: ${eventId} for customer: ${data.customer.email}`
    );

    const email = data.customer.email.toLowerCase();
    const priceId = data.items[0]?.price?.id;
    const newPlan = this.mapPriceIdToPlan(priceId);
    const periodEnd = new Date(data.current_billing_period.ends_at);
    const subscriptionId = data.id;

    // Find user by email
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      this.logger.warn(`User not found for email: ${email}`);
      return { success: false, error: 'User not found' };
    }

    // Update subscription record
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: {
        status: data.status,
        priceId: priceId || '',
        currentPeriodEnd: periodEnd,
        canceledAt: data.canceled_at ? new Date(data.canceled_at) : null,
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

    return { success: true };
  }

  /**
   * Handle subscription.canceled event
   *
   * Sets license expiration to the end of the current billing period.
   * User keeps access until their paid period ends.
   * A cron job should mark licenses as 'expired' after expiresAt passes.
   *
   * @param data - Subscription data from webhook payload
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionCanceled(
    data: PaddleSubscriptionDataDto,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    this.logger.log(
      `Processing subscription.canceled event: ${eventId} for customer: ${data.customer.email}`
    );

    const email = data.customer.email.toLowerCase();
    const periodEnd = new Date(data.current_billing_period.ends_at);
    const subscriptionId = data.id;
    const canceledAt = data.canceled_at
      ? new Date(data.canceled_at)
      : new Date();

    // Find user by email
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      this.logger.warn(`User not found for email: ${email}`);
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

    return { success: true };
  }

  /**
   * Handle subscription.activated event (Paddle Billing v2 recommended)
   *
   * TASK_2025_121: Enhanced to handle trial-to-active transitions
   *
   * This event fires when subscription becomes fully active (payment confirmed).
   * For trial subscriptions, this fires when:
   * - Trial period ends and first payment is successful
   * - User upgrades from trial to paid before trial ends
   *
   * Process:
   * 1. Check if subscription already exists (from earlier subscription.created)
   * 2. If exists: Update license plan from trial_X to X (remove trial prefix)
   * 3. If not exists: Create new license (delegate to handleSubscriptionCreated)
   *
   * @param data - Subscription data from webhook payload
   * @param eventId - Unique event ID for idempotency
   * @returns Processing result
   */
  async handleSubscriptionActivated(
    data: PaddleSubscriptionDataDto,
    eventId: string
  ): Promise<{ success: boolean; duplicate?: boolean; licenseId?: string }> {
    this.logger.log(
      `Processing subscription.activated event: ${eventId} for customer: ${data.customer.email}`
    );

    const email = data.customer.email.toLowerCase();
    const subscriptionId = data.id;
    const priceId = data.items[0]?.price?.id;
    const basePlan = this.mapPriceIdToPlan(priceId);
    const periodEnd = new Date(data.current_billing_period.ends_at);

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
          trialEnd: null, // Clear trial end date
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
          plan: basePlan, // Remove trial_ prefix
          expiresAt: periodEnd,
        },
      });

      this.logger.log(
        `Updated ${updateResult.count} license(s) from trial to ${basePlan}`
      );

      return { success: true };
    }

    // No existing subscription - delegate to handleSubscriptionCreated
    // This handles the case where subscription.activated fires without
    // a prior subscription.created event
    return this.handleSubscriptionCreated(data, eventId);
  }

  /**
   * Handle subscription.past_due event
   *
   * Occurs when payment fails but the subscription isn't canceled yet.
   * Paddle will retry payment according to dunning settings.
   *
   * During this period:
   * - Subscription is still technically active
   * - User should be warned about payment issues
   * - Consider limiting some features or showing banners
   *
   * @param data - Subscription data from webhook payload
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionPastDue(
    data: PaddleSubscriptionDataDto,
    eventId: string
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.past_due event: ${eventId} for customer: ${data.customer.email}`
    );

    const email = data.customer.email.toLowerCase();
    const subscriptionId = data.id;

    // Update subscription status to past_due
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'past_due' },
    });

    // Log warning - business may want to send reminder emails
    this.logger.warn(
      `Subscription ${subscriptionId} is past due for ${email} - payment retry in progress`
    );

    return { success: true };
  }

  /**
   * Handle subscription.paused event
   *
   * User has paused their subscription. During pause:
   * - No payments are collected
   * - User loses access to premium features
   * - Subscription can be resumed later
   *
   * @param data - Subscription data from webhook payload
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionPaused(
    data: PaddleSubscriptionDataDto,
    eventId: string
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.paused event: ${eventId} for customer: ${data.customer.email}`
    );

    const subscriptionId = data.id;
    const email = data.customer.email.toLowerCase();

    // Update subscription status to paused
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'paused' },
    });

    // Find user and update license status
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      await this.prisma.license.updateMany({
        where: { userId: user.id, status: 'active' },
        data: { status: 'paused' },
      });
      this.logger.log(
        `License(s) paused for user ${email} - subscription ${subscriptionId}`
      );
    } else {
      this.logger.warn(`User not found for email: ${email} during pause event`);
    }

    this.logger.log(`Subscription ${subscriptionId} paused for ${email}`);
    return { success: true };
  }

  /**
   * Handle subscription.resumed event
   *
   * User has resumed their previously paused subscription.
   * - Payments resume
   * - User regains access to premium features
   * - Billing cycle continues from pause point
   *
   * @param data - Subscription data from webhook payload
   * @param eventId - Unique event ID for logging
   * @returns Processing result
   */
  async handleSubscriptionResumed(
    data: PaddleSubscriptionDataDto,
    eventId: string
  ): Promise<{ success: boolean }> {
    this.logger.log(
      `Processing subscription.resumed event: ${eventId} for customer: ${data.customer.email}`
    );

    const subscriptionId = data.id;
    const email = data.customer.email.toLowerCase();
    const periodEnd = new Date(data.current_billing_period.ends_at);

    // Update subscription status to active
    await this.prisma.subscription.updateMany({
      where: { paddleSubscriptionId: subscriptionId },
      data: { status: 'active', currentPeriodEnd: periodEnd },
    });

    // Find user and reactivate license
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      await this.prisma.license.updateMany({
        where: { userId: user.id, status: 'paused' },
        data: { status: 'active', expiresAt: periodEnd },
      });
      this.logger.log(
        `License(s) reactivated for user ${email} - expires ${periodEnd.toISOString()}`
      );
    } else {
      this.logger.warn(
        `User not found for email: ${email} during resume event`
      );
    }

    this.logger.log(`Subscription ${subscriptionId} resumed for ${email}`);
    return { success: true };
  }

  /**
   * Map Paddle price ID to internal plan name
   *
   * TASK_2025_121: Supports 4 price IDs for Basic and Pro plans
   *
   * Price ID to Plan mapping:
   * - PADDLE_PRICE_ID_BASIC_MONTHLY -> 'basic'
   * - PADDLE_PRICE_ID_BASIC_YEARLY -> 'basic'
   * - PADDLE_PRICE_ID_PRO_MONTHLY -> 'pro'
   * - PADDLE_PRICE_ID_PRO_YEARLY -> 'pro'
   * - Unknown/null -> 'expired' (no valid plan)
   *
   * @param priceId - Paddle price ID from webhook
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
   * Format: PTAH-XXXX-XXXX-XXXX (uppercase hex)
   * Entropy: 96 bits (12 bytes = 24 hex chars = 3 x 4 segments)
   *
   * @returns A unique license key in PTAH-XXXX-XXXX-XXXX format
   */
  private generateLicenseKey(): string {
    const segment1 = randomBytes(4).toString('hex').toUpperCase();
    const segment2 = randomBytes(4).toString('hex').toUpperCase();
    const segment3 = randomBytes(4).toString('hex').toUpperCase();
    return `PTAH-${segment1}-${segment2}-${segment3}`;
  }
}
