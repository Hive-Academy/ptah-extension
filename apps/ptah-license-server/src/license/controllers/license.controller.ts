import {
  Controller,
  Inject,
  Optional,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { LicenseService } from '../services/license.service';
import { VerifyLicenseDto } from '../dto/verify-license.dto';
import { JwtAuthGuard } from '../../app/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { getPlanConfig, PlanName, PLANS } from '../../config/plans.config';
import { isBuildersCheckoutEnabled } from '../../config/checkout.config';
import {
  MemberGroupsService,
  type UserMemberGroup,
} from '../../member-groups/member-groups.service';

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
    @Inject(ConfigService) private readonly configService: ConfigService,
    // Optional: member-cohort lookup for the /me response. Bound by the
    // @Global() MemberGroupsModule; @Optional + best-effort read means a
    // groups failure never fails /me (empty-array fallback).
    @Optional()
    @Inject(MemberGroupsService)
    private readonly memberGroups?: MemberGroupsService,
  ) {}

  /**
   * Best-effort member-group lookup for the /me response. A failure or an
   * unbound collaborator yields an empty array — it must never fail /me.
   */
  private async safeMemberGroups(userId: string): Promise<UserMemberGroup[]> {
    if (!this.memberGroups) {
      return [];
    }
    try {
      return await this.memberGroups.getGroupsForUser(userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to resolve member groups for user ${userId}: ${message}`,
      );
      return [];
    }
  }

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
   *   plan: "builders",
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
    const checkoutEnabled = isBuildersCheckoutEnabled(this.configService);
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
        checkoutEnabled,
      };
    }
    const license = await this.prisma.license.findFirst({
      where: {
        userId: user.id,
        status: 'active',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    const subscription = fullUser.subscriptions[0] || null;
    const memberGroups = await this.safeMemberGroups(user.id);
    if (!license) {
      return {
        user: {
          email: fullUser.email,
          firstName: fullUser.firstName,
          lastName: fullUser.lastName,
          memberSince: fullUser.createdAt.toISOString(),
          emailVerified: fullUser.emailVerified,
        },
        plan: null,
        planName: 'No Plan',
        planDescription: 'Sign in to use the free, open-source Ptah orchestra',
        status: 'none',
        features: [],
        message:
          'No active license found. Ptah Community is free and open source.',
        subscription: null,
        memberGroups,
        checkoutEnabled,
      };
    }
    let daysRemaining: number | undefined;
    if (license.expiresAt) {
      const now = Date.now();
      const expiresAtMs = new Date(license.expiresAt).getTime();
      daysRemaining = Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000));
    }
    const planConfig =
      license.plan === 'community' || license.plan === 'builders'
        ? getPlanConfig(license.plan as PlanName)
        : PLANS.community; // Safe fallback for unknown plans
    const isExpired =
      license.status === 'expired' ||
      (license.expiresAt && new Date() > license.expiresAt);
    const reason: 'expired' | undefined = isExpired ? 'expired' : undefined;
    return {
      user: {
        email: fullUser.email,
        firstName: fullUser.firstName,
        lastName: fullUser.lastName,
        memberSince: fullUser.createdAt.toISOString(),
        emailVerified: fullUser.emailVerified,
      },
      plan: license.plan,
      planName: planConfig.name,
      planDescription: planConfig.description,
      status: license.status,
      expiresAt: license.expiresAt?.toISOString() || null,
      daysRemaining,
      licenseCreatedAt: license.createdAt.toISOString(),
      features: planConfig.features,
      reason,
      memberGroups,
      checkoutEnabled,
      subscription:
        subscription && subscription.status !== 'expired'
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
   *   plan: "builders"
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
}
