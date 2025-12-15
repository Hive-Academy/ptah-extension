import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { AdminApiKeyGuard } from '../guards/admin-api-key.guard';
import { LicenseService } from '../services/license.service';
import { CreateLicenseDto } from '../dto/create-license.dto';
import { EmailService } from '../../email/services/email.service';

/**
 * AdminController - Admin-only license management endpoints
 *
 * Security: All endpoints require X-API-Key header validation
 *
 * Endpoints:
 * - POST /api/v1/admin/licenses - Create license and send email
 */
@Controller('api/v1/admin')
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly licenseService: LicenseService,
    private readonly emailService: EmailService
  ) {}

  /**
   * Create a new license for a user
   *
   * Process:
   * 1. Create license via LicenseService
   * 2. Send email if sendEmail !== false (graceful degradation on failure)
   * 3. Return license details with email status
   *
   * @param dto - License creation parameters (email, plan, sendEmail)
   * @returns Created license details with email delivery status
   *
   * Response:
   * {
   *   success: true,
   *   license: { licenseKey, plan, status, expiresAt, createdAt },
   *   emailSent: true | false,
   *   emailError?: string (present if emailSent=false)
   * }
   */
  @Post('licenses')
  async createLicense(@Body() dto: CreateLicenseDto) {
    // Step 1: Create license using LicenseService
    const { licenseKey, expiresAt } = await this.licenseService.createLicense({
      email: dto.email,
      plan: dto.plan,
    });

    this.logger.log(
      `License created: plan=${dto.plan}, email=${dto.email}, expires=${
        expiresAt?.toISOString() || 'never'
      }`
    );

    // Step 2: Send email (if requested)
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
        // Graceful degradation: Log error but still return success
        emailError =
          error instanceof Error ? error.message : 'Unknown email error';
        this.logger.error(
          `Failed to send license email to ${dto.email}: ${emailError}`
        );
      }
    } else {
      this.logger.log(`Email sending skipped (sendEmail=false)`);
    }

    // Step 3: Return response
    return {
      success: true,
      license: {
        licenseKey,
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
