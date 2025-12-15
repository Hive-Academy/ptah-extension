import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS, getPlanConfig, PlanName } from '../../config/plans.config';
import { randomBytes } from 'crypto';

/**
 * LicenseService - Core license management logic
 *
 * Responsibilities:
 * - Verify license key validity and return plan details
 * - Create new licenses with proper expiration
 * - Generate cryptographically secure license keys
 */
@Injectable()
export class LicenseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify a license key's validity and return plan details
   *
   * @param licenseKey - The license key to verify (format: ptah_lic_{64-hex})
   * @returns License status with validity, tier, plan details, and expiration info
   *
   * Response cases:
   * - Valid license: { valid: true, tier, plan, expiresAt, daysRemaining }
   * - Expired: { valid: false, tier: "free", reason: "expired" }
   * - Revoked: { valid: false, tier: "free", reason: "revoked" }
   * - Not found: { valid: false, tier: "free", reason: "not_found" }
   */
  async verifyLicense(licenseKey: string): Promise<{
    valid: boolean;
    tier: 'free' | 'early_adopter';
    plan?: (typeof PLANS)[keyof typeof PLANS];
    expiresAt?: string;
    daysRemaining?: number;
    reason?: 'expired' | 'revoked' | 'not_found';
  }> {
    // Step 1: Find license in database (indexed query on licenseKey)
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
    });

    // Step 2: Check if license exists
    if (!license) {
      return {
        valid: false,
        tier: 'free',
        reason: 'not_found',
      };
    }

    // Step 3: Check if license is revoked
    if (license.status === 'revoked') {
      return {
        valid: false,
        tier: 'free',
        reason: 'revoked',
      };
    }

    // Step 4: Check if license is expired
    if (license.expiresAt && new Date() > license.expiresAt) {
      return {
        valid: false,
        tier: 'free',
        reason: 'expired',
      };
    }

    // Step 5: Calculate days remaining (if expiration exists)
    const daysRemaining = license.expiresAt
      ? Math.ceil(
          (license.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      : undefined;

    // Step 6: Get plan configuration from hardcoded PLANS
    const planConfig = getPlanConfig(license.plan as PlanName);

    // Step 7: Return valid license with full details
    return {
      valid: true,
      tier: license.plan as 'free' | 'early_adopter',
      plan: planConfig,
      expiresAt: license.expiresAt?.toISOString(),
      daysRemaining,
    };
  }

  /**
   * Create a new license for a user
   *
   * Process:
   * 1. Find or create user by email
   * 2. Revoke any existing active licenses for the user
   * 3. Generate a new cryptographically secure license key
   * 4. Calculate expiration date from plan configuration
   * 5. Create license record in database
   *
   * @param params - Email and plan for license creation
   * @returns The generated license key and expiration date
   */
  async createLicense(params: {
    email: string;
    plan: PlanName;
  }): Promise<{ licenseKey: string; expiresAt: Date | null }> {
    const { email, plan } = params;

    // Step 1: Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: { email: email.toLowerCase() },
      });
    }

    // Step 2: Revoke existing active licenses for this user
    // (Ensures only one active license per user at a time)
    await this.prisma.license.updateMany({
      where: {
        userId: user.id,
        status: 'active',
      },
      data: {
        status: 'revoked',
      },
    });

    // Step 3: Generate cryptographically secure license key
    const licenseKey = this.generateLicenseKey();

    // Step 4: Calculate expiration date from plan configuration
    const planConfig = getPlanConfig(plan);
    const expiresAt =
      planConfig.expiresAfterDays !== null
        ? new Date(
            Date.now() + planConfig.expiresAfterDays * 24 * 60 * 60 * 1000
          )
        : null;

    // Step 5: Create license record
    await this.prisma.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan,
        status: 'active',
        expiresAt,
        createdBy: 'admin',
      },
    });

    return { licenseKey, expiresAt };
  }

  /**
   * Generate a cryptographically secure license key
   *
   * Format: ptah_lic_{64 hex characters}
   * Entropy: 256 bits (32 bytes = 64 hex chars)
   *
   * @private
   * @returns A unique license key
   */
  private generateLicenseKey(): string {
    const random = randomBytes(32).toString('hex'); // 32 bytes = 64 hex chars
    return `ptah_lic_${random}`;
  }
}
