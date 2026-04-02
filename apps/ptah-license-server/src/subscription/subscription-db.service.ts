import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * User with subscription data from database
 */
export interface UserWithSubscription {
  id: string;
  email: string;
  subscription: LocalSubscription | null;
}

/**
 * User with subscription and license data from database
 */
export interface UserWithSubscriptionAndLicense {
  id: string;
  email: string;
  subscription: LocalSubscription | null;
  license: LocalLicense | null;
}

/**
 * Local subscription record from database
 */
export interface LocalSubscription {
  id: string;
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  status: string;
  priceId: string;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
  trialEnd: Date | null;
}

/**
 * Local license record from database
 */
export interface LocalLicense {
  id: string;
  licenseKey: string;
  plan: string;
  status: string;
  expiresAt: Date | null;
}

/**
 * Data for creating a new subscription
 */
export interface CreateSubscriptionData {
  userId: string;
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  status: string;
  priceId: string;
  currentPeriodEnd: Date;
  trialEnd: Date | null;
}

/**
 * Data for creating a new license
 */
export interface CreateLicenseData {
  userId: string;
  plan: string;
  expiresAt: Date;
  createdBy: string;
}

/**
 * Data for updating a subscription
 */
export interface UpdateSubscriptionData {
  status?: string;
  priceId?: string;
  currentPeriodEnd?: Date;
  canceledAt?: Date | null;
  trialEnd?: Date | null;
}

/**
 * Data for updating a license
 */
export interface UpdateLicenseData {
  status?: string;
  plan?: string;
  expiresAt?: Date;
}

/**
 * Result of creating subscription and license
 */
export interface CreateRecordsResult {
  subscriptionId: string;
  licenseId: string;
  licenseKey: string;
}

/**
 * SubscriptionDbService - Database operations for subscription management
 *
 * Encapsulates all Prisma operations for better testability and separation of concerns.
 * The main SubscriptionService handles business logic and Paddle API calls,
 * while this service handles all database operations.
 */
@Injectable()
export class SubscriptionDbService {
  private readonly logger = new Logger(SubscriptionDbService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Find user with their most recent subscription
   */
  async findUserWithSubscription(
    userId: string,
  ): Promise<UserWithSubscription | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      return null;
    }

    const subscription = user.subscriptions[0];

    return {
      id: user.id,
      email: user.email,
      subscription: subscription
        ? {
            id: subscription.id,
            paddleSubscriptionId: subscription.paddleSubscriptionId,
            paddleCustomerId: subscription.paddleCustomerId,
            status: subscription.status,
            priceId: subscription.priceId,
            currentPeriodEnd: subscription.currentPeriodEnd,
            canceledAt: subscription.canceledAt,
            trialEnd: subscription.trialEnd,
          }
        : null,
    };
  }

  /**
   * Find user with their most recent subscription and active/paused license
   */
  async findUserWithSubscriptionAndLicense(
    userId: string,
  ): Promise<UserWithSubscriptionAndLicense | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        licenses: {
          where: { status: { in: ['active', 'paused'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      return null;
    }

    const subscription = user.subscriptions[0];
    const license = user.licenses[0];

    return {
      id: user.id,
      email: user.email,
      subscription: subscription
        ? {
            id: subscription.id,
            paddleSubscriptionId: subscription.paddleSubscriptionId,
            paddleCustomerId: subscription.paddleCustomerId,
            status: subscription.status,
            priceId: subscription.priceId,
            currentPeriodEnd: subscription.currentPeriodEnd,
            canceledAt: subscription.canceledAt,
            trialEnd: subscription.trialEnd,
          }
        : null,
      license: license
        ? {
            id: license.id,
            licenseKey: license.licenseKey,
            plan: license.plan,
            status: license.status,
            expiresAt: license.expiresAt,
          }
        : null,
    };
  }

  /**
   * Find user by ID
   * Returns user with email and paddleCustomerId for checkout
   */
  async findUserById(userId: string): Promise<{
    id: string;
    email: string;
    paddleCustomerId: string | null;
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        paddleCustomerId: true,
      },
    });

    return user;
  }

  /**
   * Find subscription for portal session creation
   * Returns the most recent subscription with valid status
   */
  async findSubscriptionForPortal(
    userId: string,
  ): Promise<LocalSubscription | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: ['active', 'trialing', 'past_due', 'paused', 'canceled'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return null;
    }

    return {
      id: subscription.id,
      paddleSubscriptionId: subscription.paddleSubscriptionId,
      paddleCustomerId: subscription.paddleCustomerId,
      status: subscription.status,
      priceId: subscription.priceId,
      currentPeriodEnd: subscription.currentPeriodEnd,
      canceledAt: subscription.canceledAt,
      trialEnd: subscription.trialEnd,
    };
  }

  /**
   * Create subscription and license records in a transaction
   * Also revokes any existing active licenses for the user
   */
  async createSubscriptionAndLicense(
    subscriptionData: CreateSubscriptionData,
    licenseData: CreateLicenseData,
  ): Promise<CreateRecordsResult> {
    const licenseKey = this.generateLicenseKey();

    const result = await this.prisma.$transaction(async (tx) => {
      // Revoke any existing active licenses
      await tx.license.updateMany({
        where: { userId: subscriptionData.userId, status: 'active' },
        data: { status: 'revoked' },
      });

      // Create new license
      const license = await tx.license.create({
        data: {
          userId: licenseData.userId,
          licenseKey,
          plan: licenseData.plan,
          status: 'active',
          expiresAt: licenseData.expiresAt,
          createdBy: licenseData.createdBy,
        },
      });

      // Create subscription record
      const subscription = await tx.subscription.create({
        data: {
          userId: subscriptionData.userId,
          paddleSubscriptionId: subscriptionData.paddleSubscriptionId,
          paddleCustomerId: subscriptionData.paddleCustomerId,
          status: subscriptionData.status,
          priceId: subscriptionData.priceId,
          currentPeriodEnd: subscriptionData.currentPeriodEnd,
          trialEnd: subscriptionData.trialEnd,
        },
      });

      return {
        subscriptionId: subscription.id,
        licenseId: license.id,
        licenseKey,
      };
    });

    this.logger.log(
      `Created subscription ${result.subscriptionId} and license ${result.licenseId}`,
    );

    return result;
  }

  /**
   * Update subscription record
   */
  async updateSubscription(
    subscriptionId: string,
    data: UpdateSubscriptionData,
  ): Promise<void> {
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data,
    });

    this.logger.debug(`Updated subscription ${subscriptionId}`);
  }

  /**
   * Update license record
   */
  async updateLicense(
    licenseId: string,
    data: UpdateLicenseData,
  ): Promise<void> {
    await this.prisma.license.update({
      where: { id: licenseId },
      data,
    });

    this.logger.debug(`Updated license ${licenseId}`);
  }

  /**
   * Generate a cryptographically secure license key
   *
   * Format: ptah_lic_{64 lowercase hex chars}
   * Entropy: 256 bits (32 bytes = 64 hex chars)
   */
  private generateLicenseKey(): string {
    const bytes = randomBytes(32);
    return `ptah_lic_${bytes.toString('hex')}`;
  }
}
