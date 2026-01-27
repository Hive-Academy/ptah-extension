import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '../generated-prisma-client';
import { PrismaService } from '../prisma/prisma.service';
import { PaddleService } from './paddle.service';
import {
  isSubscriptionEvent,
  isTransactionEvent,
} from './dto/paddle-webhook.dto';

/**
 * Extended Request interface with raw body for webhook signature verification
 *
 * NestJS must be configured to preserve raw body for webhook routes.
 * See main.ts for raw body middleware configuration.
 */
interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * PaddleController - Webhook endpoint for Paddle payment events
 *
 * Endpoint: POST /webhooks/paddle
 *
 * Security:
 * - All requests verified via HMAC SHA256 signature (paddle-signature header)
 * - Invalid signatures return 401 Unauthorized
 * - Must access raw body for signature verification
 *
 * Event Handling:
 * - subscription.created: Provisions license and sends email
 * - subscription.updated: Updates license plan/expiration
 * - subscription.canceled: Sets license to expire at period end
 * - Unknown events: Acknowledged with { received: true }
 *
 * Response:
 * - Always returns 200 OK for valid webhooks (Paddle requirement)
 * - Returns 401 Unauthorized for invalid signatures
 * - Returns 400 Bad Request for missing required data
 *
 * Idempotency:
 * - Events processed idempotently using event_id
 * - Duplicate events return { duplicate: true } without error
 */
@Controller('webhooks/paddle')
export class PaddleController {
  private readonly logger = new Logger(PaddleController.name);

  constructor(
    private readonly paddleService: PaddleService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Handle Paddle webhook events
   *
   * POST /webhooks/paddle
   *
   * Process:
   * 1. Extract and verify paddle-signature header
   * 2. Parse event type and route to appropriate handler
   * 3. Return 200 OK for all webhooks (Paddle requirement - never fail response)
   *
   * TASK_2025_123: Added transaction.completed handling for renewals
   * TASK_2025_123: Added failed webhook storage for recovery
   *
   * @param signature - The paddle-signature header for verification
   * @param req - Express request with rawBody for signature verification
   * @returns Webhook processing result - ALWAYS returns 200 OK
   *
   * @throws UnauthorizedException - If signature verification fails (before main processing)
   * @throws BadRequestException - If request body is missing (before main processing)
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('paddle-signature') signature: string,
    @Req() req: RequestWithRawBody
  ): Promise<{
    received: boolean;
    success?: boolean;
    duplicate?: boolean;
    skipped?: boolean;
    error?: string;
    licenseId?: string;
  }> {
    // Step 1: Validate request has raw body for signature verification
    if (!req.rawBody) {
      this.logger.error('Raw body not available - check middleware config');
      throw new BadRequestException(
        'Webhook processing error - raw body not available'
      );
    }

    // Step 2: Validate signature header exists
    if (!signature) {
      this.logger.warn('Missing paddle-signature header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Step 3: Verify webhook timestamp (replay attack prevention)
    const isTimestampValid = this.paddleService.verifyTimestamp(signature);
    if (!isTimestampValid) {
      this.logger.warn(
        'Webhook timestamp outside acceptable window - possible replay attack'
      );
      throw new UnauthorizedException('Webhook timestamp expired');
    }

    // Step 4: Verify webhook signature
    const isValid = this.paddleService.verifySignature(signature, req.rawBody);
    if (!isValid) {
      this.logger.warn('Invalid webhook signature received');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Step 5: Parse and validate payload
    const payload = req.body;
    if (!payload || !payload.event_type || !payload.event_id) {
      this.logger.warn('Invalid webhook payload - missing required fields');
      throw new BadRequestException(
        'Invalid webhook payload - missing event_type or event_id'
      );
    }

    const eventType = payload.event_type as string;
    const eventId = payload.event_id as string;

    this.logger.log(`Received webhook: ${eventType} (${eventId})`);

    // TASK_2025_123: Wrap main processing in try/catch for failed webhook storage
    // Always return 200 OK to Paddle - store failures for later investigation
    try {
      return await this.processWebhookEvent(eventType, eventId, payload);
    } catch (error) {
      // Store failed webhook for later recovery/investigation
      await this.storeFailedWebhook(eventId, eventType, payload, error);

      // Always return 200 OK to Paddle to prevent retries that might fail repeatedly
      // The failure is logged and stored for manual investigation
      this.logger.error(
        `Webhook processing failed for ${eventType} (${eventId}) - stored for recovery`
      );

      return {
        received: true,
        success: false,
        error: 'Processing failed - stored for recovery',
      };
    }
  }

  /**
   * Process webhook event based on type
   *
   * Separated from handleWebhook for cleaner error handling.
   * This method can throw - errors are caught and stored by handleWebhook.
   *
   * @param eventType - Paddle event type
   * @param eventId - Unique event ID
   * @param payload - Full webhook payload
   * @returns Processing result
   */
  private async processWebhookEvent(
    eventType: string,
    eventId: string,
    payload: Record<string, unknown>
  ): Promise<{
    received: boolean;
    success?: boolean;
    duplicate?: boolean;
    skipped?: boolean;
    error?: string;
    licenseId?: string;
  }> {
    // Step 6: Route to appropriate handler based on event type

    // Handle transaction events (TASK_2025_123: renewals)
    if (isTransactionEvent(eventType)) {
      return this.handleTransactionEvent(eventType, eventId, payload);
    }

    // Handle subscription events
    if (isSubscriptionEvent(eventType)) {
      return this.handleSubscriptionEventInternal(eventType, eventId, payload);
    }

    // Acknowledge unknown events without processing
    this.logger.log(`Ignoring unhandled event type: ${eventType}`);
    return { received: true };
  }

  /**
   * Handle transaction events (e.g., transaction.completed for renewals)
   *
   * TASK_2025_123: Added for subscription renewal handling
   *
   * @param eventType - Transaction event type
   * @param eventId - Unique event ID
   * @param payload - Full webhook payload
   * @returns Processing result
   */
  private async handleTransactionEvent(
    eventType: string,
    eventId: string,
    payload: Record<string, unknown>
  ): Promise<{
    received: boolean;
    success?: boolean;
    skipped?: boolean;
    error?: string;
  }> {
    const data = payload.data as Record<string, unknown>;

    if (!data) {
      this.logger.warn('Invalid transaction data - missing data object');
      throw new Error('Invalid transaction data - missing data');
    }

    switch (eventType) {
      case 'transaction.completed': {
        // Handle subscription renewals
        const result = await this.paddleService.handleTransactionCompleted(
          data as Parameters<typeof this.paddleService.handleTransactionCompleted>[0],
          eventId
        );
        return { received: true, ...result };
      }

      default: {
        this.logger.log(`Unhandled transaction event: ${eventType}`);
        return { received: true };
      }
    }
  }

  /**
   * Handle subscription events
   *
   * Extracted from original handleWebhook for cleaner separation.
   *
   * @param eventType - Subscription event type
   * @param eventId - Unique event ID
   * @param payload - Full webhook payload
   * @returns Processing result
   */
  private async handleSubscriptionEventInternal(
    eventType: string,
    eventId: string,
    payload: Record<string, unknown>
  ): Promise<{
    received: boolean;
    success?: boolean;
    duplicate?: boolean;
    error?: string;
    licenseId?: string;
  }> {
    // Step 7: Validate subscription data exists
    const data = payload.data as Record<string, unknown>;

    if (!data) {
      this.logger.warn('Invalid subscription data - missing data object');
      throw new Error('Invalid subscription data - missing data');
    }

    // Paddle Billing v2 may send customer_id instead of full customer object
    // Resolve email from API if not present in webhook
    const customerId =
      (data.customer_id as string) ||
      (data.customer as { id?: string })?.id;
    let customerEmail = (data.customer as { email?: string })?.email;

    if (!customerEmail && customerId) {
      this.logger.log(
        `Customer email not in webhook, fetching for customer_id: ${customerId}`
      );
      customerEmail = await this.paddleService.getCustomerEmail(customerId);
    }

    if (!customerEmail) {
      this.logger.warn('Could not resolve customer email from webhook or API');
      this.logger.warn(`Payload keys: ${Object.keys(data).join(', ')}`);
      throw new Error(
        'Invalid subscription data - could not resolve customer email'
      );
    }

    // Inject the resolved email into data for downstream handlers
    const customerData = (data.customer as Record<string, unknown>) || {
      id: customerId,
    };
    customerData.email = customerEmail;
    data.customer = customerData;

    this.logger.log(`Resolved customer email: ${customerEmail}`);

    // Step 8: Process subscription events
    switch (eventType) {
      case 'subscription.created': {
        const result = await this.paddleService.handleSubscriptionCreated(
          data as Parameters<typeof this.paddleService.handleSubscriptionCreated>[0],
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.activated': {
        // Paddle Billing v2 recommended event for license provisioning
        const result = await this.paddleService.handleSubscriptionActivated(
          data as Parameters<typeof this.paddleService.handleSubscriptionActivated>[0],
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.updated': {
        const result = await this.paddleService.handleSubscriptionUpdated(
          data as Parameters<typeof this.paddleService.handleSubscriptionUpdated>[0],
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.canceled': {
        const result = await this.paddleService.handleSubscriptionCanceled(
          data as Parameters<typeof this.paddleService.handleSubscriptionCanceled>[0],
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.past_due': {
        // Payment failed, entering dunning period
        const result = await this.paddleService.handleSubscriptionPastDue(
          data as Parameters<typeof this.paddleService.handleSubscriptionPastDue>[0],
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.paused': {
        // User paused their subscription
        const result = await this.paddleService.handleSubscriptionPaused(
          data as Parameters<typeof this.paddleService.handleSubscriptionPaused>[0],
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.resumed': {
        // User resumed their paused subscription
        const result = await this.paddleService.handleSubscriptionResumed(
          data as Parameters<typeof this.paddleService.handleSubscriptionResumed>[0],
          eventId
        );
        return { received: true, ...result };
      }

      default: {
        // This shouldn't happen due to isSubscriptionEvent check, but handle gracefully
        this.logger.log(`Unhandled subscription event: ${eventType}`);
        return { received: true };
      }
    }
  }

  /**
   * Store failed webhook for later recovery and investigation
   *
   * TASK_2025_123: Added for webhook resilience
   *
   * This method stores failed webhooks to the FailedWebhook table so they can be:
   * - Investigated manually
   * - Retried later (manually or via scheduled job)
   * - Used for debugging and monitoring
   *
   * This method never throws - errors are logged but swallowed to prevent
   * cascading failures.
   *
   * @param eventId - Paddle event ID
   * @param eventType - Event type (e.g., 'subscription.created')
   * @param rawPayload - Full webhook payload
   * @param error - The error that caused the failure
   */
  private async storeFailedWebhook(
    eventId: string,
    eventType: string,
    rawPayload: unknown,
    error: unknown
  ): Promise<void> {
    try {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;

      await this.prisma.failedWebhook.create({
        data: {
          eventId,
          eventType,
          rawPayload: rawPayload as Prisma.JsonValue,
          errorMessage,
          stackTrace,
        },
      });

      this.logger.log(
        `Stored failed webhook: ${eventId} (${eventType}) - ${errorMessage}`
      );
    } catch (storeError) {
      // Log but don't throw - we don't want storage failure to affect response
      this.logger.error(
        `Failed to store failed webhook ${eventId}:`,
        storeError instanceof Error ? storeError.message : 'Unknown error'
      );
    }
  }
}
