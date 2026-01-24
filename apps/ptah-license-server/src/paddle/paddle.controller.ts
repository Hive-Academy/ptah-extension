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
import { PaddleService } from './paddle.service';
import { isSubscriptionEvent } from './dto/paddle-webhook.dto';

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

  constructor(private readonly paddleService: PaddleService) {}

  /**
   * Handle Paddle webhook events
   *
   * POST /webhooks/paddle
   *
   * Process:
   * 1. Extract and verify paddle-signature header
   * 2. Parse event type and route to appropriate handler
   * 3. Return 200 OK for all successfully processed events
   *
   * @param signature - The paddle-signature header for verification
   * @param req - Express request with rawBody for signature verification
   * @returns Webhook processing result
   *
   * @throws UnauthorizedException - If signature verification fails
   * @throws BadRequestException - If request body is missing or malformed
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
      this.logger.warn('Webhook timestamp outside acceptable window - possible replay attack');
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

    const eventType = payload.event_type;
    const eventId = payload.event_id;

    this.logger.log(`Received webhook: ${eventType} (${eventId})`);

    // Step 6: Route to appropriate handler based on event type
    if (!isSubscriptionEvent(eventType)) {
      // Acknowledge unknown events without processing
      this.logger.log(`Ignoring unhandled event type: ${eventType}`);
      return { received: true };
    }

    // Step 7: Validate subscription data exists
    const data = payload.data;
    if (!data || !data.customer || !data.customer.email) {
      this.logger.warn('Invalid subscription data - missing customer email');
      throw new BadRequestException(
        'Invalid subscription data - missing customer information'
      );
    }

    // Step 8: Process subscription events
    switch (eventType) {
      case 'subscription.created': {
        const result = await this.paddleService.handleSubscriptionCreated(
          data,
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.updated': {
        const result = await this.paddleService.handleSubscriptionUpdated(
          data,
          eventId
        );
        return { received: true, ...result };
      }

      case 'subscription.canceled': {
        const result = await this.paddleService.handleSubscriptionCanceled(
          data,
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
}
