import {
  Controller,
  Inject,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
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
    @Inject(LicenseService) private readonly licenseService: LicenseService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
    // Extract base plan from tier (e.g., 'trial_pro' → 'pro', 'community' → 'community')
    const basePlan = (license.plan as string).replace('trial_', '');
    const planConfig =
      basePlan === 'community' || basePlan === 'pro'
        ? getPlanConfig(basePlan as PlanName)
        : PLANS.community; // Safe fallback for unknown plans

    // Step 7: Determine reason for license status (TASK_2025_143)
    // Check if trial has ended - handles BOTH scenarios:
    // Case 1: Cron hasn't run yet - subscription is still 'trialing' but past trialEnd
    // Case 2: Cron has run - subscription is 'expired' and plan downgraded to 'community'
    const isTrialEnded =
      (subscription?.status === 'trialing' &&
        subscription?.trialEnd &&
        new Date() > subscription.trialEnd) ||
      (subscription?.status === 'expired' &&
        license.plan === 'community' &&
        license.expiresAt !== null);

    // Check if license has expired (separate from trial ending)
    const isExpired =
      license.status === 'expired' ||
      (license.expiresAt && new Date() > license.expiresAt);

    // Determine the reason field
    // TASK_2025_143: Set reason when trial has ended OR license is expired
    // Important: Trial can end even when license.status is still 'active'
    let reason: 'trial_ended' | 'expired' | undefined;
    if (isTrialEnded) {
      // Trial has ended (works before AND after cron runs)
      reason = 'trial_ended';
    } else if (isExpired) {
      // License has expired (not trial-related)
      reason = 'expired';
    }

    // Step 8: Determine effective plan (map 'pro' → 'trial_pro' for trial users)
    // The license table stores 'pro' for trial users (createTrialLicense sets plan='pro'),
    // but the frontend expects 'trial_pro' to distinguish trial from paid subscriptions.
    // This matches the mapPlanToTier() logic used in verifyLicense().
    const isInTrial = subscription?.status === 'trialing';
    const effectivePlan =
      isInTrial && license.plan === 'pro' ? 'trial_pro' : license.plan;

    // Step 9: Return complete account details (NEVER include licenseKey)
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
      plan: effectivePlan,
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
      // Subscription info - only include for users with meaningful Paddle subscriptions.
      // Exclude expired/internal-trial subscriptions (e.g. downgraded community users)
      // as they cause the frontend to show irrelevant billing/sync/manage UI.
      subscription:
        subscription &&
        subscription.status !== 'expired' &&
        subscription.priceId !== 'auto_trial_pro'
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
        `License key reveal denied: userId=${user.id}, reason=no_active_license`,
      );
      return {
        success: false,
        message: 'No active license found',
      };
    }

    this.logger.log(
      `License key revealed: userId=${user.id}, licenseId=${license.id}, plan=${license.plan}`,
    );

    return {
      success: true,
      licenseKey: license.licenseKey,
      plan: license.plan,
    };
  }

  /**
   * Downgrade to Community plan
   *
   * POST /api/v1/licenses/downgrade-to-community
   *
   * Authentication: Required (ptah_auth JWT cookie)
   * Used by: Trial-ended modal when user clicks "Continue with Community"
   * Rate Limit: 3 requests per minute (same as reveal-key)
   *
   * @param req - Express request with authenticated user
   * @returns Downgrade result
   *
   * Response (success):
   * {
   *   success: true,
   *   plan: "community",
   *   status: "active",
   *   message: "Successfully downgraded to Community plan"
   * }
   *
   * Response (validation error):
   * Status: 400 Bad Request
   * {
   *   success: false,
   *   message: "Trial has not ended yet. You have 3 days remaining."
   * }
   *
   * Response (no active license):
   * Status: 404 Not Found
   * {
   *   success: false,
   *   message: "No active license found"
   * }
   *
   * Security:
   * - Requires JWT authentication via JwtAuthGuard
   * - Strict rate limiting (3 req/min) to prevent abuse
   * - Validates trial has ended before allowing downgrade
   * - All downgrade events logged for audit trail
   *
   * Real-Time Update:
   * - Emits SSE event 'license.updated' for instant UI refresh
   * - Frontend profile page auto-updates via SSE listener
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('downgrade-to-community')
  @UseGuards(JwtAuthGuard)
  async downgradeToCommunity(@Req() req: Request) {
    const user = req.user as { id: string; email: string };

    // Step 1: Get current license state to validate trial has ended
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
      this.logger.warn(
        `Downgrade denied: userId=${user.id}, reason=user_not_found`,
      );
      return {
        success: false,
        message: 'User not found',
      };
    }

    const subscription = fullUser.subscriptions[0];

    // Step 2: Validate trial has actually ended
    // Case 1: Subscription still 'trialing' but past trialEnd (cron hasn't run yet)
    // Case 2: Subscription already 'expired' (cron ran, or previous partial downgrade)
    const isTrialEnded =
      (subscription?.status === 'trialing' &&
        subscription?.trialEnd &&
        new Date() > subscription.trialEnd) ||
      subscription?.status === 'expired';

    if (!isTrialEnded) {
      // Calculate days remaining if trial is still active
      let daysRemaining: number | undefined;
      if (subscription?.trialEnd) {
        const now = Date.now();
        const trialEndMs = new Date(subscription.trialEnd).getTime();
        daysRemaining = Math.ceil((trialEndMs - now) / (24 * 60 * 60 * 1000));
      }

      this.logger.warn(
        `Downgrade denied: userId=${
          user.id
        }, reason=trial_not_ended, daysRemaining=${daysRemaining || 'N/A'}`,
      );

      return {
        success: false,
        message: daysRemaining
          ? `Trial has not ended yet. You have ${daysRemaining} day${
              daysRemaining !== 1 ? 's' : ''
            } remaining.`
          : 'Trial has not ended yet',
      };
    }

    // Step 3: Perform downgrade
    try {
      const result = await this.licenseService.downgradeToCommunity(user.id);

      this.logger.log(
        `Downgrade successful: userId=${user.id}, email=${user.email}, plan=${result.plan}`,
      );

      return {
        ...result,
        message: 'Successfully downgraded to Community plan',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Downgrade failed: userId=${user.id}, error=${errorMessage}`,
      );

      // Return user-friendly errors
      if (errorMessage.includes('No active license')) {
        return {
          success: false,
          message: 'No active license found',
        };
      }

      return {
        success: false,
        message: 'Failed to downgrade. Please try again or contact support.',
      };
    }
  }
}
