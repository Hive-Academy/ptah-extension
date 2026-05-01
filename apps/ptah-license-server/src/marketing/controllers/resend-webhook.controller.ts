import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ResendWebhookGuard } from '../guards/resend-webhook.guard';
import { MarketingService } from '../services/marketing.service';
import type { ResendWebhookPayload } from '../dto/resend-webhook.dto';

/**
 * Resend Webhook Receiver (TASK_2025_292 — Batch 5).
 *
 * Mounted at the public path `/webhooks/resend` so it sits OUTSIDE the
 * `v1/admin` prefix and is NOT covered by `AdminGuard`. Authentication is
 * provided by the Svix HMAC check in `ResendWebhookGuard`. The route-specific
 * raw-body parser registered in `main.ts` makes `req.rawBody` available for
 * signature verification.
 *
 * Returning 2xx (HTTP 200) is the contract Resend expects on success;
 * unhandled exceptions (5xx) trigger Resend retry — those retries are
 * de-duped inside `MarketingService.handleResendWebhook` via the svix-id.
 */
@Controller('webhooks/resend')
@UseGuards(ResendWebhookGuard)
export class ResendWebhookController {
  constructor(
    @Inject(MarketingService) private readonly marketing: MarketingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() payload: ResendWebhookPayload,
    @Headers('svix-id') svixId?: string,
  ): Promise<{ received: true }> {
    await this.marketing.handleResendWebhook(payload, svixId);
    return { received: true };
  }
}
