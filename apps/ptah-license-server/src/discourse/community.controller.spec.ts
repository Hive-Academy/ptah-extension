/**
 * Unit tests for `CommunityController` (GET /api/v1/community/summary) and its
 * authorization posture.
 *
 * Focus:
 *   (a) No ptah_auth cookie → the JwtAuthGuard rejects (401).
 *   (b) Authenticated NON-Builders → { communityUrl: null, topics: [] } and the
 *       Discourse provider is NEVER hit (admin-key visibility must not leak
 *       gated Builders topics to non-members).
 *   (c) Authenticated Builders → topics returned + communityUrl resolved.
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CommunityController } from './community.controller';
import type { DiscourseAdminProvider } from './discourse-admin.provider';
import type { BuildersMembershipService } from './builders-membership.service';
import type { CommunityTopic } from './discourse.types';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import type { AuthService } from '../app/auth/services/auth.service';

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

function buildController(opts: {
  isBuilders: boolean;
  topics?: CommunityTopic[];
  discourseUrl?: string;
}): {
  controller: CommunityController;
  provider: { getLatestTopics: jest.Mock };
  membership: { isBuildersMember: jest.Mock };
} {
  const provider = {
    getLatestTopics: jest.fn().mockResolvedValue(opts.topics ?? TOPICS),
  };
  const membership = {
    isBuildersMember: jest.fn().mockResolvedValue(opts.isBuilders),
  };
  const config = {
    get: (key: string): unknown =>
      key === 'DISCOURSE_URL' ? opts.discourseUrl : undefined,
  } as unknown as ConfigService;

  const controller = new CommunityController(
    provider as unknown as DiscourseAdminProvider,
    config,
    membership as unknown as BuildersMembershipService,
  );
  return { controller, provider, membership };
}

function reqWithUser(id = 'usr_1', email = 'b@example.com'): Request {
  return { user: { id, email } } as unknown as Request;
}

describe('CommunityController', () => {
  describe('JwtAuthGuard (auth gate)', () => {
    it('rejects a request with no ptah_auth cookie', async () => {
      const guard = new JwtAuthGuard({
        validateToken: jest.fn(),
      } as unknown as AuthService);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ cookies: {} }) as unknown as Request,
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('getSummary', () => {
    it('degrades a non-Builders caller to an empty summary without hitting Discourse', async () => {
      const { controller, provider } = buildController({
        isBuilders: false,
        discourseUrl: 'https://forum.ptah.live',
      });

      const result = await controller.getSummary(reqWithUser());

      expect(result).toEqual({ communityUrl: null, topics: [] });
      expect(provider.getLatestTopics).not.toHaveBeenCalled();
    });

    it('returns topics + communityUrl for an active Builders member', async () => {
      const { controller, provider, membership } = buildController({
        isBuilders: true,
        discourseUrl: 'https://forum.ptah.live/',
      });

      const result = await controller.getSummary(reqWithUser('usr_42'));

      expect(membership.isBuildersMember).toHaveBeenCalledWith('usr_42');
      expect(provider.getLatestTopics).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        communityUrl: 'https://forum.ptah.live',
        topics: TOPICS,
      });
    });

    it('resolves communityUrl to null when DISCOURSE_URL is unset (feature-off) even for a member', async () => {
      const { controller } = buildController({ isBuilders: true });

      const result = await controller.getSummary(reqWithUser());

      expect(result.communityUrl).toBeNull();
    });
  });
});
