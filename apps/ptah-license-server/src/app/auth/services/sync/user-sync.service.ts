import { Injectable, Logger } from '@nestjs/common';
import { User } from '@workos-inc/node';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * User Sync Service
 *
 * Single responsibility: Synchronize WorkOS users to local database.
 * Ensures local user data exists for features that don't need WorkOS.
 */
@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sync WorkOS user to local database
   *
   * Strategy:
   * 1. First try to find by workosId
   * 2. If not found, try to find by email
   * 3. Create or update accordingly
   */
  async syncUser(workosUser: User): Promise<void> {
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

      if (existingUser) {
        // Update existing user
        await this.prisma.user.update({
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
        await this.prisma.user.create({
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
    } catch (error) {
      // Log but don't fail - local sync is not critical
      this.logger.warn(
        `Failed to sync user to database: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
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
        }`
      );
    }
  }
}
