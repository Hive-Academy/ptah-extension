import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type SegmentKey =
  | 'all'
  | 'proActive'
  | 'communityActive'
  | 'trialing'
  | 'subscriptionPastDue';

export interface SegmentCount {
  total: number;
  optedIn: number;
}

@Injectable()
export class SegmentResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Resolve a segment or list of userIds into a unique set of opted-in user IDs.
   */
  async resolve(
    segment: SegmentKey | undefined,
    userIds: string[] | undefined,
  ): Promise<{
    optedInUserIds: string[];
    skippedUserIds: string[];
    totalInSegment: number;
  }> {
    let resolvedUserIds: string[] = [];
    let totalInSegment = 0;

    if (segment) {
      const users = await this.prisma.user.findMany({
        where: this.getSegmentFilter(segment),
        select: { id: true, marketingOptIn: true },
      });

      totalInSegment = users.length;
      resolvedUserIds = users.filter((u) => u.marketingOptIn).map((u) => u.id);
    }

    if (userIds && userIds.length > 0) {
      // Add explicitly provided user IDs to the set (union)
      resolvedUserIds = Array.from(new Set([...resolvedUserIds, ...userIds]));
    }

    // Final opt-in check (double check for explicitly provided IDs)
    const finalUsers = await this.prisma.user.findMany({
      where: {
        id: { in: resolvedUserIds },
      },
      select: { id: true, marketingOptIn: true },
    });

    const optedInUserIds = finalUsers
      .filter((u) => u.marketingOptIn)
      .map((u) => u.id);

    const skippedUserIds = resolvedUserIds.filter(
      (id) => !optedInUserIds.includes(id),
    );

    return {
      optedInUserIds,
      skippedUserIds,
      totalInSegment,
    };
  }

  /**
   * Get counts for all segments
   */
  async getSegmentCounts(): Promise<Record<SegmentKey, SegmentCount>> {
    const keys: SegmentKey[] = [
      'all',
      'proActive',
      'communityActive',
      'trialing',
      'subscriptionPastDue',
    ];
    const results = {} as Record<SegmentKey, SegmentCount>;

    for (const key of keys) {
      const total = await this.prisma.user.count({
        where: this.getSegmentFilter(key),
      });
      const optedIn = await this.prisma.user.count({
        where: {
          AND: [this.getSegmentFilter(key), { marketingOptIn: true }],
        },
      });
      results[key] = { total, optedIn };
    }

    return results;
  }

  private getSegmentFilter(segment: SegmentKey): any {
    switch (segment) {
      case 'all':
        return {};
      case 'proActive':
        return {
          licenses: {
            some: {
              plan: 'pro',
              status: 'active',
              source: 'paddle',
            },
          },
        };
      case 'communityActive':
        return {
          licenses: {
            some: {
              plan: 'community',
              status: 'active',
            },
          },
        };
      case 'trialing':
        return {
          subscriptions: {
            some: {
              status: 'trialing',
            },
          },
        };
      case 'subscriptionPastDue':
        return {
          subscriptions: {
            some: {
              status: 'past_due',
            },
          },
        };
      default:
        return {};
    }
  }
}
