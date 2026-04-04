import { Inject, Injectable, Logger } from '@nestjs/common';
import { User } from '@workos-inc/node';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { User as PrismaUser } from '../../../../generated-prisma-client/client';

/**
 * Database user info needed for JWT generation
 */
export interface SyncedUser {
  /** Database UUID (NOT WorkOS ID) */
  id: string;
  email: string;
}

/**
 * User Sync Service
 *
 * Single responsibility: Synchronize WorkOS users to local database.
 * Ensures local user data exists for features that don't need WorkOS.
 *
 * Returns the database user after sync so the database UUID can be used
 * in JWT tokens (not the WorkOS user ID).
 */
@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Sync WorkOS user to local database
   *
   * Strategy:
   * 1. First try to find by workosId
   * 2. If not found, try to find by email
   * 3. Create or update accordingly
   *
   * @returns The database user (with database UUID, not WorkOS ID)
   */
  async syncUser(workosUser: User): Promise<SyncedUser> {
    try {
      // First check if user exists by workosId
      let existingUser = await this.prisma.user.findUnique({
        where: { workosId: workosUser.id },
      });

      // If not found by workosId, check by email
      if (!existingUser) {
        existingUser = await this.prisma.user.findUnique({
          where: { email: workosUser.email },
        });
      }

      let dbUser: PrismaUser;

      if (existingUser) {
        // Update existing user
        dbUser = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            workosId: workosUser.id,
            email: workosUser.email,
            firstName: workosUser.firstName || existingUser.firstName,
            lastName: workosUser.lastName || existingUser.lastName,
            emailVerified: workosUser.emailVerified || false,
          },
        });
        this.logger.debug(`Updated user in database: ${workosUser.email}`);
      } else {
        // Create new user
        dbUser = await this.prisma.user.create({
          data: {
            workosId: workosUser.id,
            email: workosUser.email,
            firstName: workosUser.firstName,
            lastName: workosUser.lastName,
            emailVerified: workosUser.emailVerified || false,
          },
        });
        this.logger.debug(`Created user in database: ${workosUser.email}`);
      }

      return { id: dbUser.id, email: dbUser.email };
    } catch (error) {
      // Log but don't fail - local sync is not critical
      this.logger.warn(
        `Failed to sync user to database: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      // Return WorkOS data as fallback (queries will fail but auth won't break completely)
      return { id: workosUser.id, email: workosUser.email };
    }
  }

  /**
   * Update email verified status
   */
  async markEmailVerified(email: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { email },
        data: { emailVerified: true },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to update email verified status: ${
          error instanceof Error ? error.message : 'Unknown'
        }`,
      );
    }
  }
}
