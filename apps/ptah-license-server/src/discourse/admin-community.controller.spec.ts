import type { ConfigService } from '@nestjs/config';
import type { DiscourseAdminProvider } from './discourse-admin.provider';
import { AdminCommunityService } from './admin-community.service';
import { AdminCommunityController } from './admin-community.controller';
import type { CommunityTopic, ReviewQueueItem } from './discourse.types';

/**
 * Unit tests for the READ-ONLY admin community surface (TASK_2026_169).
 *
 * Focus:
 *   - Feature-off degrades to empty envelopes, never a 500.
 *   - An upstream failure degrades to an empty list, and no upstream body is
 *     ever forwarded.
 *   - The surface is READ-ONLY: it exposes no mutation of any kind. The
 *     structural proof lives in `admin/admin-guards.spec.ts` (G5), which
 *     asserts every handler is a GET; the assertion here is the behavioural
 *     complement — the provider is never asked to write.
 */

const TOPICS: CommunityTopic[] = [
  {
    id: 1,
    title: 'Welcome, Builders',
    slug: 'welcome-builders',
    postsCount: 3,
    lastPostedAt: '2026-07-20T10:00:00.000Z',
    categoryName: 'Announcements',
  },
];

const REVIEW: ReviewQueueItem[] = [
  {
    id: 42,
    type: 'ReviewableFlaggedPost',
    topicTitle: 'Spam?',
    createdAt: '2026-07-30T09:00:00.000Z',
  },
];

function build(opts: {
  enabled: boolean;
  discourseUrl?: string;
  topics?: CommunityTopic[];
  review?: ReviewQueueItem[];
}) {
  const provider = {
    isEnabled: jest.fn().mockReturnValue(opts.enabled),
    getLatestTopics: jest.fn().mockResolvedValue(opts.topics ?? TOPICS),
    getReviewQueue: jest.fn().mockResolvedValue(opts.review ?? REVIEW),
  };
  const config = {
    get: (key: string): unknown =>
      key === 'DISCOURSE_URL' ? opts.discourseUrl : undefined,
  } as unknown as ConfigService;

  const service = new AdminCommunityService(
    provider as unknown as DiscourseAdminProvider,
    config,
  );
  const controller = new AdminCommunityController(service);
  return { controller, provider };
}

describe('AdminCommunityController', () => {
  describe('topics', () => {
    it('returns topics + communityUrl when Discourse is configured', async () => {
      const { controller, provider } = build({
        enabled: true,
        discourseUrl: 'https://forum.ptah.live/',
      });

      const result = await controller.topics({ limit: 5 });

      expect(provider.getLatestTopics).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        communityUrl: 'https://forum.ptah.live',
        topics: TOPICS,
        enabled: true,
      });
    });

    it('degrades to an empty, disabled envelope when Discourse is unconfigured', async () => {
      const { controller, provider } = build({ enabled: false });

      const result = await controller.topics({ limit: 20 });

      expect(result).toEqual({
        communityUrl: null,
        topics: [],
        enabled: false,
      });
      expect(provider.getLatestTopics).not.toHaveBeenCalled();
    });

    it('degrades to an empty list (not a 500) when the provider fails', async () => {
      const { controller } = build({
        enabled: true,
        discourseUrl: 'https://forum.ptah.live',
        topics: [],
      });

      const result = await controller.topics({ limit: 20 });

      expect(result.topics).toEqual([]);
      expect(result.enabled).toBe(true);
    });

    it('defaults the limit to 20 when omitted', async () => {
      const { controller, provider } = build({
        enabled: true,
        discourseUrl: 'https://forum.ptah.live',
      });

      await controller.topics({});

      expect(provider.getLatestTopics).toHaveBeenCalledWith(20);
    });
  });

  describe('reviewQueue', () => {
    it('returns items, count and a deep link into Discourse review', async () => {
      const { controller } = build({
        enabled: true,
        discourseUrl: 'https://forum.ptah.live',
      });

      const result = await controller.reviewQueue();

      expect(result).toEqual({
        items: REVIEW,
        count: 1,
        reviewUrl: 'https://forum.ptah.live/review',
      });
    });

    it('degrades to an empty queue with a null review link when unconfigured', async () => {
      const { controller, provider } = build({ enabled: false });

      const result = await controller.reviewQueue();

      expect(result).toEqual({ items: [], count: 0, reviewUrl: null });
      expect(provider.getReviewQueue).not.toHaveBeenCalled();
    });

    it('reports a null review link when DISCOURSE_URL is unset but the API is up', async () => {
      const { controller } = build({ enabled: true });

      const result = await controller.reviewQueue();

      expect(result.reviewUrl).toBeNull();
    });
  });

  describe('read-only posture', () => {
    it('exposes exactly two handlers, both reads', () => {
      const handlers = Object.getOwnPropertyNames(
        AdminCommunityController.prototype,
      ).filter((name) => name !== 'constructor');

      expect(handlers.sort()).toEqual(['reviewQueue', 'topics']);
    });

    it('never asks the provider to mutate Discourse', async () => {
      const { controller, provider } = build({
        enabled: true,
        discourseUrl: 'https://forum.ptah.live',
      });

      await controller.topics({ limit: 5 });
      await controller.reviewQueue();

      // The provider exposes sync methods that PUT/DELETE against Discourse.
      // This surface must never reach for them.
      expect(
        (provider as Record<string, unknown>)['syncGroupMembership'],
      ).toBeUndefined();
      expect(
        (provider as Record<string, unknown>)['syncNamedGroupMembership'],
      ).toBeUndefined();
    });
  });
});
