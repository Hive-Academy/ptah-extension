import { SegmentResolverService } from './segment-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SegmentResolverService', () => {
  let service: SegmentResolverService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new SegmentResolverService(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('resolve', () => {
    it('resolves segment and opted-in users', async () => {
      mockPrisma.user.findMany.mockImplementation((params: any) => {
        if (params.where?.licenses) {
          // Segment query
          return [
            { id: 'u1', marketingOptIn: true },
            { id: 'u2', marketingOptIn: false },
          ];
        }
        if (params.where?.id?.in) {
          // Final opt-in check
          return [
            { id: 'u1', marketingOptIn: true },
            { id: 'u3', marketingOptIn: true },
          ];
        }
        return [];
      });

      const result = await service.resolve('proActive', ['u3']);

      expect(result.optedInUserIds).toEqual(['u1', 'u3']);
      expect(result.skippedUserIds).toEqual([]); // u2 was skipped before union, u3 is opted in
      expect(result.totalInSegment).toBe(2);
    });

    it('handles empty segment correctly', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.resolve(undefined, ['u1']);

      // If only userIds provided, it checks opt-in for them
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', marketingOptIn: false },
      ]);

      const result2 = await service.resolve(undefined, ['u1']);
      expect(result2.optedInUserIds).toEqual([]);
      expect(result2.skippedUserIds).toEqual(['u1']);
    });
  });

  describe('getSegmentCounts', () => {
    it('returns counts for all segments', async () => {
      mockPrisma.user.count.mockResolvedValue(10);

      const counts = await service.getSegmentCounts();

      expect(counts.all).toEqual({ total: 10, optedIn: 10 });
      expect(mockPrisma.user.count).toHaveBeenCalledTimes(10); // 5 segments * 2 counts each
    });
  });
});
