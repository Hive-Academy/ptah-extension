import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';
import { PaddleSubscriptionDataDto } from './dto/paddle-webhook.dto';

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
 * - PADDLE_API_KEY: Paddle API key (for SDK initialization)
 * - PADDLE_WEBHOOK_SECRET: Webhook signature secret
 * - PADDLE_PRICE_ID_EARLY_ADOPTER: Price ID for early adopter plan
 * - PADDLE_PRICE_ID_PRO: Price ID for pro plan
 */
@Injectable()
export class PaddleService {
  private readonly logger = new Logger(PaddleService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService
  ) {
    // Log configuration status on initialization
    const webhookSecret = this.configService.get<string>(
      'PADDLE_WEBHOOK_SECRET'
    );
    if (!webhookSecret) {
      this.logger.warn(
        'PADDLE_WEBHOOK_SECRET not configured - webhook verification will fail'
      );
    } else {
      this.logger.log('Paddle service initialized successfully');
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
   * Handle subscription.created event
   *
   * Process:
   * 1. Check for duplicate processing via eventId (idempotency)
   * 2. Create or find user by email
   * 3. Create subscription record in database
   * 4. Generate and create license
   * 5. Send license key email
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
      `Processing subscription.created event: ${eventId} for customer: ${data.customer.email}`
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
    const plan = this.mapPriceIdToPlan(priceId);
    const customerId = data.customer.id;
    const subscriptionId = data.id;
    const periodEnd = new Date(data.current_billing_period.ends_at);

    // Step 2: Find or create user
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email },
      });
      this.logger.log(`Created new user for email: ${email}`);
    }

    // Step 3: Create subscription record
    await this.prisma.subscription.create({
      data: {
        userId: user.id,
        paddleSubscriptionId: subscriptionId,
        paddleCustomerId: customerId,
        status: data.status,
        priceId: priceId || '',
        currentPeriodEnd: periodEnd,
      },
    });
    this.logger.log(`Created subscription record: ${subscriptionId}`);

    // Step 4: Revoke any existing active licenses (one active license per user)
    await this.prisma.license.updateMany({
      where: {
        userId: user.id,
        status: 'active',
      },
      data: {
        status: 'revoked',
      },
    });

    // Step 5: Generate and create license
    const licenseKey = this.generateLicenseKey();
    const license = await this.prisma.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan,
        status: 'active',
        expiresAt: periodEnd,
        createdBy: `paddle_${eventId}`,
      },
    });
    this.logger.log(`Created license: ${license.id} for plan: ${plan}`);

    // Step 6: Send license key email
    try {
      await this.emailService.sendLicenseKey({
        email,
        licenseKey,
        plan,
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
   * Map Paddle price ID to internal plan name
   *
   * Uses environment variables for price ID configuration.
   * Defaults to 'free' if price ID is not recognized.
   *
   * @param priceId - Paddle price ID from webhook
   * @returns Internal plan name ('early_adopter', 'pro', or 'free')
   */
  private mapPriceIdToPlan(priceId: string | undefined): string {
    if (!priceId) {
      return 'free';
    }

    const earlyAdopterPriceId = this.configService.get<string>(
      'PADDLE_PRICE_ID_EARLY_ADOPTER'
    );
    const proPriceId = this.configService.get<string>('PADDLE_PRICE_ID_PRO');

    if (priceId === earlyAdopterPriceId) {
      return 'early_adopter';
    }

    if (priceId === proPriceId) {
      return 'pro';
    }

    this.logger.warn(`Unknown price ID: ${priceId} - defaulting to 'free'`);
    return 'free';
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
