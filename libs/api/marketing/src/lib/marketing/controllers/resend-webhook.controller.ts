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
    // ⚠️ DELIBERATELY UNBOUND — TASK_2026_170 exclusion (plan §6.2).
    // Every other `@Body()`/`@Query()` payload param in this server binds
    // `dtoPipe(TheDto)` because the global ValidationPipe is inert under
    // esbuild (see `src/common/dto-validation.pipe.ts`). This one does not, on
    // purpose: third-party webhook payload shapes change without notice, and
    // `forbidNonWhitelisted` would 400 a perfectly valid webhook the first time
    // Resend adds a field — turning a vendor-side additive change into dropped
    // delivery events. `ResendWebhookPayload` is also an `interface`, not a
    // class, so it cannot be an `expectedType` at all. The authoritative check
    // on this route is the Svix HMAC in `ResendWebhookGuard`.
    // Recorded as data in the `EXCLUDED` list of
    // `src/common/controller-validation.spec.ts`, which asserts this param is
    // still unbound so the exclusion cannot outlive its subject.
    @Body() payload: ResendWebhookPayload,
    @Headers('svix-id') svixId?: string,
  ): Promise<{ received: true }> {
    await this.marketing.handleResendWebhook(payload, svixId);
    return { received: true };
  }
}
