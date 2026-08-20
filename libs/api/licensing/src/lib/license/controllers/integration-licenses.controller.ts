import {
  Controller,
  Inject,
  Post,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminApiKeyGuard } from '../guards/admin-api-key.guard';
import { LicenseService } from '../services/license.service';
import { CreateLicenseDto } from '../dto/create-license.dto';
import { EmailService } from '@ptah-api/email';
import { dtoPipe } from '@ptah-api/core';

/**
 * IntegrationLicensesController — machine/ops license provisioning
 * (TASK_2026_170 R3).
 *
 * Security: every endpoint requires an `x-api-key` header, validated against
 * `ADMIN_API_KEY` by `AdminApiKeyGuard` (see `guards/admin-api-key.guard.ts`).
 * That guard is the RESOURCE BOUNDARY: this is an out-of-repo INTEGRATION
 * authenticated by a shared secret, NOT a dashboard route authenticated by an
 * admin's session cookie (`JwtAuthGuard` → `AdminGuard`, which is what every
 * `v1/admin/*` controller uses). R3 moved it off `v1/admin` because the URL made
 * two different trust models look like neighbours; `v1/integrations` says what
 * it is. See `admin/AdminLicensesController` for the cookie-authenticated
 * complimentary-license route that keeps the `v1/admin/licenses` prefix.
 *
 * Rate Limit: 30 requests per minute (TASK_2025_125)
 *
 * Endpoints:
 * - POST /api/v1/integrations/licenses - Create license and send email
 *
 * Routes: /api/v1/integrations/licenses (global prefix 'api' is added
 * automatically)
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. See `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts` fails the
 * build if a binding is dropped.
 *
 * This route matters more than its traffic suggests: `CreateLicenseDto` has no
 * caller anywhere in this repo, so its only clients are OUT-OF-REPO scripts
 * holding `ADMIN_API_KEY`. Nothing in the workspace can be regressed by binding
 * it, and unvalidated it was the one place an arbitrary `plan` string could be
 * written straight onto a license row.
 */
@Controller('v1/integrations/licenses')
@UseGuards(AdminApiKeyGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class IntegrationLicensesController {
  private readonly logger = new Logger(IntegrationLicensesController.name);

  constructor(
    @Inject(LicenseService) private readonly licenseService: LicenseService,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  /**
   * Create a new license for a user
   *
   * Process:
   * 1. Create license via LicenseService
   * 2. Send email if sendEmail !== false (graceful degradation on failure)
   * 3. Return license details with email status
   *
   * SECURITY: License key is NEVER returned in API response.
   * License keys are only delivered via email to maintain security.
   *
   * @param dto - License creation parameters (email, plan, sendEmail)
   * @returns Created license details with email delivery status
   *
   * Response:
   * {
   *   success: true,
   *   license: { plan, status, expiresAt, createdAt },
   *   emailSent: true | false,
   *   emailError?: string (present if emailSent=false)
   * }
   */
  @Post()
  async createLicense(@Body(dtoPipe(CreateLicenseDto)) dto: CreateLicenseDto) {
    const { licenseKey, expiresAt } = await this.licenseService.createLicense({
      email: dto.email,
      plan: dto.plan,
    });

    this.logger.log(
      `License created: plan=${dto.plan}, email=${dto.email}, expires=${
        expiresAt?.toISOString() || 'never'
      }`,
    );
    let emailSent = false;
    let emailError: string | undefined;

    if (dto.sendEmail !== false) {
      try {
        await this.emailService.sendLicenseKey({
          email: dto.email,
          licenseKey,
          plan: dto.plan,
          expiresAt,
        });
        emailSent = true;
        this.logger.log(`License key email sent to ${dto.email}`);
      } catch (error) {
        emailError =
          error instanceof Error ? error.message : 'Unknown email error';
        this.logger.error(
          `Failed to send license email to ${dto.email}: ${emailError}`,
        );
      }
    } else {
      this.logger.warn(
        `Email sending skipped (sendEmail=false) - user will NOT receive license key`,
      );
    }
    return {
      success: true,
      license: {
        email: dto.email,
        plan: dto.plan,
        status: 'active',
        expiresAt: expiresAt?.toISOString() || null,
        createdAt: new Date().toISOString(),
      },
      emailSent,
      emailError,
    };
  }
}
