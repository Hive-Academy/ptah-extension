import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Inject,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { LicenseService } from '../services/license.service';
import { VerifyLicenseDto } from '../dto/verify-license.dto';
import { JwtAuthGuard } from '../../app/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { getPlanConfig, PlanName, PLANS } from '../../config/plans.config';

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
  private readonly logger = new Logger(LicenseController.name);

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
   * Rate Limit: 10 requests per minute (TASK_2025_125)
   *
   * @param dto - VerifyLicenseDto containing the license key
   * @returns License verification result with plan details
   *
   *
   * Response (invalid license):
   * {
   *   valid: false,
   *   tier: "expired",
   *   reason: "expired" | "revoked" | "not_found"
   * }
   *
   * Response (rate limited):
   * Status: 429 Too Many Requests
   * Headers: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
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
   *   plan: "pro",
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
   *   plan: null,
   *   status: "none",
   *   message: "No active license found"
   * }
   *
   * Security:
   * - NEVER includes licenseKey in response (security risk)
   * - License key only sent via email
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
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
        plan: null,
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

    // Step 4: No active license found - return unlicensed response
    if (!license) {
      // Check if this is a trial-ended case: subscription exists, is trialing, but trial has ended
      const isTrialEnded =
        subscription?.status === 'trialing' &&
        subscription?.trialEnd &&
        new Date() > subscription.trialEnd;

      return {
        // User info
        user: {
          email: fullUser.email,
          firstName: fullUser.firstName,
          lastName: fullUser.lastName,
          memberSince: fullUser.createdAt.toISOString(),
          emailVerified: fullUser.emailVerified,
        },
        // License info (no active plan)
        plan: null,
        planName: 'No Plan',
        planDescription: 'Start a trial or subscribe to use Ptah Extension',
        status: 'none',
        features: [],
        message: isTrialEnded
          ? 'Your trial has ended. Upgrade to Pro to continue using all features!'
          : 'No active license found. Start your free trial to get started!',
        // Reason for license status (TASK_2025_143)
        reason: isTrialEnded ? 'trial_ended' : undefined,
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
    const planConfig =
      license.plan === 'community' || license.plan === 'pro'
        ? getPlanConfig(license.plan as PlanName)
        : PLANS.community; // Safe fallback for unknown plans

    // Step 7: Determine reason for license status (TASK_2025_143)
    // Check if trial has ended (subscription is trialing but trialEnd < now)
    const isTrialEnded =
      subscription?.status === 'trialing' &&
      subscription?.trialEnd &&
      new Date() > subscription.trialEnd;

    // Check if license has expired
    const isExpired =
      license.status === 'expired' ||
      (license.expiresAt && new Date() > license.expiresAt);

    // Determine the reason field
    let reason: 'trial_ended' | 'expired' | undefined;
    if (isTrialEnded) {
      reason = 'trial_ended';
    } else if (isExpired) {
      reason = 'expired';
    }

    // Step 8: Return complete account details (NEVER include licenseKey)
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
      // Reason for license status (TASK_2025_143)
      // Returns 'trial_ended' when subscription trial has expired
      // Returns 'expired' when license has expired
      // Returns undefined for active licenses
      reason,
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

  /**
   * Reveal current user's license key
   *
   * POST /api/v1/licenses/me/reveal-key
   *
   * Authentication: Required (ptah_auth JWT cookie)
   * Rate Limit: 3 requests per minute (strict - sensitive data)
   * Used by: Customer portal profile page "Get License Key" button
   *
   * @param req - Express request with authenticated user
   * @returns License key and plan on success, error message on failure
   *
   * Response (success):
   * {
   *   success: true,
   *   licenseKey: "ptah_lic_abc123...",
   *   plan: "pro"
   * }
   *
   * Response (no active license):
   * {
   *   success: false,
   *   message: "No active license found"
   * }
   *
   * Security:
   * - Requires JWT authentication via JwtAuthGuard
   * - Strict rate limiting (3 req/min) to prevent abuse
   * - POST method to avoid URL/cache/history leakage
   * - All access events logged for audit trail
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('me/reveal-key')
  @UseGuards(JwtAuthGuard)
  async revealMyLicenseKey(@Req() req: Request) {
    const user = req.user as { id: string; email: string };

    const license = await this.prisma.license.findFirst({
      where: {
        userId: user.id,
        status: 'active',
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        licenseKey: true,
        plan: true,
      },
    });

    if (!license) {
      this.logger.warn(
        `License key reveal denied: userId=${user.id}, reason=no_active_license`
      );
      return {
        success: false,
        message: 'No active license found',
      };
    }

    this.logger.log(
      `License key revealed: userId=${user.id}, licenseId=${license.id}, plan=${license.plan}`
    );

    return {
      success: true,
      licenseKey: license.licenseKey,
      plan: license.plan,
    };
  }
}
