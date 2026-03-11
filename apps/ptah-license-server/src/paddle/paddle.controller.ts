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
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  PaddleWebhookService,
  WebhookResponse,
} from './paddle-webhook.service';

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
 * PaddleController - Thin webhook endpoint for Paddle payment events
 *
 * Endpoint: POST /webhooks/paddle
 *
 * This controller is intentionally thin - it only handles HTTP concerns:
 * - Request validation (raw body, signature header)
 * - Delegating to PaddleWebhookService for processing
 * - Response mapping
 *
 * All business logic is in PaddleWebhookService and PaddleService.
 * Signature verification is handled by Paddle SDK's webhooks.unmarshal().
 *
 * Security:
 * - Raw body required for SDK signature verification
 * - paddle-signature header required
 * - SDK handles HMAC SHA256 verification + timestamp validation
 *
 * Response:
 * - Always returns 200 OK for valid webhooks (Paddle requirement)
 * - Returns 401 Unauthorized for missing signature
 * - Returns 400 Bad Request for missing raw body
 */
@SkipThrottle()
@Controller('webhooks/paddle')
export class PaddleController {
  private readonly logger = new Logger(PaddleController.name);

  constructor(private readonly webhookService: PaddleWebhookService) {}

  /**
   * Handle Paddle webhook events
   *
   * POST /webhooks/paddle
   *
   * This endpoint:
   * 1. Validates raw body is available (required for signature verification)
   * 2. Validates paddle-signature header is present
   * 3. Delegates to PaddleWebhookService for SDK-based verification and processing
   *
   * The SDK's webhooks.unmarshal() handles:
   * - HMAC SHA256 signature verification
   * - Timestamp validation (replay protection)
   * - JSON parsing into typed EventEntity
   *
   * @param signature - The paddle-signature header for verification
   * @param req - Express request with rawBody for signature verification
   * @returns Webhook processing result - ALWAYS returns 200 OK to Paddle
   *
   * @throws BadRequestException - If raw body is not available
   * @throws UnauthorizedException - If signature is missing
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('paddle-signature') signature: string,
    @Req() req: RequestWithRawBody
  ): Promise<WebhookResponse> {
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

    // Step 3: Delegate to webhook service for SDK-based processing
    // The service handles signature verification, event routing, and business logic
    return this.webhookService.processWebhook(req.rawBody, signature);
  }
}
