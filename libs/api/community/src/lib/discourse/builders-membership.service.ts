import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';

/**
 * BuildersMembershipService — the single source of truth for "does this user
 * currently hold an active Builders membership?", resolved from the database
 * (never a JWT claim, so a stale token can never grant access).
 *
 * Rule (mirrors the members gate): an active/trialing subscription OR an
 * active, non-expired `builders` license. Extracted to DRY the identical query
 * that `MembersController` and `DiscourseController` each carry inline.
 *
 * Provided by the `@Global()` DiscourseModule, so it is injectable app-wide.
 */
@Injectable()
export class BuildersMembershipService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * True when the user currently holds an active Builders membership.
   * Subscription first (active/trialing), then a non-expired active builders
   * license.
   */
  async isBuildersMember(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ['active', 'trialing'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (subscription) {
      return true;
    }

    const license = await this.prisma.license.findFirst({
      where: { userId, status: 'active', plan: 'builders' },
      orderBy: { createdAt: 'desc' },
    });
    if (!license) {
      return false;
    }
    if (license.expiresAt && license.expiresAt < new Date()) {
      return false;
    }
    return true;
  }
}
