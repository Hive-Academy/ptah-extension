import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import type { Request } from 'express';
import { LicenseService } from '../services/license.service';
import { VerifyLicenseDto } from '../dto/verify-license.dto';
import { PtahJwtAuthGuard } from '../../app/auth/guards/ptah-jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { getPlanConfig, PlanName } from '../../config/plans.config';

/**
 * LicenseController - Public license verification endpoint
 *
 * Provides the public API for license verification.
 * No authentication required - this is a public endpoint used by VS Code extensions.
 *
 * Routes: /api/v1/licenses/* (global prefix 'api' is added automatically)
 */
@Controller('v1/licenses')
export class LicenseController {
  constructor(
    private readonly licenseService: LicenseService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Verify a license key
   *
   * POST /api/v1/licenses/verify
   *
   * Authentication: None (public endpoint)
   * Performance: <200ms p95 latency target
   *
   * @param dto - VerifyLicenseDto containing the license key
   * @returns License verification result with plan details
   *
   * Response (valid license):
   * {
   *   valid: true,
   *   tier: "early_adopter",
   *   plan: { name: "Early Adopter", features: [...], ... },
   *   expiresAt: "2026-02-15T00:00:00Z",
   *   daysRemaining: 45
   * }
   *
   * Response (invalid license):
   * {
   *   valid: false,
   *   tier: "free",
   *   reason: "expired" | "revoked" | "not_found"
   * }
   */
  @Post('verify')
  async verify(@Body() dto: VerifyLicenseDto) {
    return this.licenseService.verifyLicense(dto.licenseKey);
  }

  /**
   * Get current user's license details
   *
   * GET /api/v1/licenses/me
   *
   * Authentication: Required (ptah_auth JWT cookie)
   * Used by: Customer portal dashboard
   *
   * @param req - Express request with authenticated user
   * @returns User's active license details with plan information
   *
   * Response (user with license):
   * {
   *   plan: "early_adopter",
   *   status: "active",
   *   expiresAt: "2026-02-15T00:00:00Z",
   *   daysRemaining: 45,
   *   email: "user@example.com",
   *   createdAt: "2025-12-01T00:00:00Z",
   *   features: ["sdk_access", "custom_tools", ...]
   * }
   *
   * Response (user without license):
   * {
   *   plan: "free",
   *   status: "none",
   *   message: "No active license found"
   * }
   *
   * Security:
   * - NEVER includes licenseKey in response (security risk)
   * - License key only sent via email
   */
  @Get('me')
  @UseGuards(PtahJwtAuthGuard)
  async getMyLicense(@Req() req: Request) {
    const user = req.user as { id: string; email: string };

    // Step 1: Find full user data with subscriptions
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!fullUser) {
      return {
        plan: 'free',
        status: 'none',
        message: 'User not found',
      };
    }

    // Step 2: Find user's active license
    const license = await this.prisma.license.findFirst({
      where: {
        userId: user.id,
        status: 'active',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Step 3: Get subscription data if exists
    const subscription = fullUser.subscriptions[0] || null;

    // Step 4: No active license found - return free tier with user info
    if (!license) {
      const freePlanConfig = getPlanConfig('free');
      return {
        // User info
        user: {
          email: fullUser.email,
          firstName: fullUser.firstName,
          lastName: fullUser.lastName,
          memberSince: fullUser.createdAt.toISOString(),
          emailVerified: fullUser.emailVerified,
        },
        // License info
        plan: 'free',
        planName: freePlanConfig.name,
        planDescription: freePlanConfig.description,
        status: 'none',
        features: freePlanConfig.features,
        message:
          'No active license found. Start your free trial or upgrade to Pro!',
        // Subscription info
        subscription: null,
      };
    }

    // Step 5: Calculate days remaining (if applicable)
    let daysRemaining: number | undefined;
    if (license.expiresAt) {
      const now = Date.now();
      const expiresAtMs = new Date(license.expiresAt).getTime();
      daysRemaining = Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000));
    }

    // Step 6: Get plan configuration for features
    const planConfig = getPlanConfig(license.plan as PlanName);

    // Step 7: Return complete account details (NEVER include licenseKey)
    return {
      // User info
      user: {
        email: fullUser.email,
        firstName: fullUser.firstName,
        lastName: fullUser.lastName,
        memberSince: fullUser.createdAt.toISOString(),
        emailVerified: fullUser.emailVerified,
      },
      // License info
      plan: license.plan,
      planName: planConfig.name,
      planDescription: planConfig.description,
      status: license.status,
      expiresAt: license.expiresAt?.toISOString() || null,
      daysRemaining,
      licenseCreatedAt: license.createdAt.toISOString(),
      features: planConfig.features,
      // Subscription info (if Pro with Paddle subscription)
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            canceledAt: subscription.canceledAt?.toISOString() || null,
          }
        : null,
    };
  }
}
