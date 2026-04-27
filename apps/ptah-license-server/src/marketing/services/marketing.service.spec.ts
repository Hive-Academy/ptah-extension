import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketingService } from './marketing.service';
import { SegmentResolverService } from './segment-resolver.service';
import { TemplateRenderService } from './template-render.service';
import { UnsubscribeTokenService } from './unsubscribe-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { EmailService } from '../../email/services/email.service';
import type { SendCampaignDto } from '../dto/send-campaign.dto';
import type { ResendWebhookPayload } from '../dto/resend-webhook.dto';

/**
 * MarketingService unit tests (T-B5-05).
 *
 * Covers the contract surface called out in the task:
 *   - DTO validation (CONTENT_REQUIRED / CONTENT_AMBIGUOUS / TEMPLATE_NOT_FOUND).
 *   - Empty segment short-circuit (EMPTY_SEGMENT 400).
 *   - Skipped opted-out users surface in `skippedUserIds`.
 *   - Mid-loop unsubscribe race (R3) — user flips marketingOptIn to false
 *     between segment resolve and per-email dispatch and is NOT emailed.
 *   - Bounce webhook flips opt-in + bumps the campaign counter.
 *   - Soft bounce / delivery_delayed bumps counter only.
 *   - Idempotency: duplicate svix-id is ignored.
 */

type MockPrisma = {
  marketingCampaign: {
    create: jest.Mock;
    update: jest.Mock;
  };
  marketingCampaignTemplate: {
    findUnique: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

const flushAsync = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
};

describe('MarketingService', () => {
  let service: MarketingService;
  let mockPrisma: MockPrisma;
  let mockSegmentResolver: jest.Mocked<
    Pick<SegmentResolverService, 'resolve' | 'getSegmentCounts'>
  >;
  let mockTemplateRender: jest.Mocked<Pick<TemplateRenderService, 'render'>>;
  let mockTokenService: jest.Mocked<Pick<UnsubscribeTokenService, 'sign'>>;
  let mockEmail: jest.Mocked<Pick<EmailService, 'sendCustomEmail'>>;
  let mockAuditLog: jest.Mocked<Pick<AuditLogService, 'write'>>;
  let mockConfig: jest.Mocked<Pick<ConfigService, 'get'>>;

  beforeEach(() => {
    mockPrisma = {
      marketingCampaign: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'campaign-1', ...data }),
          ),
        update: jest.fn().mockResolvedValue({ id: 'campaign-1' }),
      },
      marketingCampaignTemplate: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      // Implement $transaction the way Prisma does for the interactive form:
      // run the callback with `tx` aliased to the mock client so the
      // service's tx-aware code path executes its branch.
      $transaction: jest.fn().mockImplementation(async (cb) => cb(mockPrisma)),
    };

    mockSegmentResolver = {
      resolve: jest.fn(),
      getSegmentCounts: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<SegmentResolverService, 'resolve' | 'getSegmentCounts'>
    >;

    mockTemplateRender = {
      render: jest.fn().mockReturnValue({
        html: '<p>rendered</p>',
        subject: 'Hello',
      }),
    } as unknown as jest.Mocked<Pick<TemplateRenderService, 'render'>>;

    mockTokenService = {
      sign: jest.fn().mockResolvedValue('signed-token'),
    } as unknown as jest.Mocked<Pick<UnsubscribeTokenService, 'sign'>>;

    mockEmail = {
      sendCustomEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Pick<EmailService, 'sendCustomEmail'>>;

    mockAuditLog = {
      write: jest.fn().mockResolvedValue('audit-row-1'),
    } as unknown as jest.Mocked<Pick<AuditLogService, 'write'>>;

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MARKETING_UNSUBSCRIBE_BASE_URL')
          return 'https://api.ptah.live';
        return undefined;
      }),
    } as unknown as jest.Mocked<Pick<ConfigService, 'get'>>;

    service = new MarketingService(
      mockPrisma as unknown as PrismaService,
      mockAuditLog as unknown as AuditLogService,
      mockSegmentResolver as unknown as SegmentResolverService,
      mockTemplateRender as unknown as TemplateRenderService,
      mockTokenService as unknown as UnsubscribeTokenService,
      mockEmail as unknown as EmailService,
      mockConfig as unknown as ConfigService,
    );
  });

  // ===========================================================================
  // sendCampaign — DTO validation
  // ===========================================================================

  describe('sendCampaign — validation', () => {
    it('rejects when neither templateId nor inline content is supplied (CONTENT_REQUIRED)', async () => {
      const dto: SendCampaignDto = {
        name: 'Empty content',
        segment: 'all',
      };

      await expect(
        service.sendCampaign(dto, { email: 'admin@ptah.live' }),
      ).rejects.toMatchObject({ message: 'CONTENT_REQUIRED' });
      expect(mockSegmentResolver.resolve).not.toHaveBeenCalled();
    });

    it('rejects when templateId is supplied alongside inline subject/htmlBody (CONTENT_AMBIGUOUS)', async () => {
      const dto: SendCampaignDto = {
        name: 'Ambiguous',
        templateId: '00000000-0000-0000-0000-000000000111',
        subject: 'Inline subject',
        htmlBody: '<p>Inline</p>',
        segment: 'all',
      };

      await expect(
        service.sendCampaign(dto, { email: 'admin@ptah.live' }),
      ).rejects.toMatchObject({ message: 'CONTENT_AMBIGUOUS' });
    });

    it('throws NotFoundException when templateId does not resolve (TEMPLATE_NOT_FOUND)', async () => {
      mockPrisma.marketingCampaignTemplate.findUnique.mockResolvedValue(null);

      const dto: SendCampaignDto = {
        name: 'Missing template',
        templateId: '00000000-0000-0000-0000-000000000222',
        segment: 'all',
      };

      await expect(
        service.sendCampaign(dto, { email: 'admin@ptah.live' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when the resolved segment is empty (EMPTY_SEGMENT)', async () => {
      mockSegmentResolver.resolve.mockResolvedValue({
        optedInUserIds: [],
        skippedUserIds: [],
        totalInSegment: 0,
      });

      const dto: SendCampaignDto = {
        name: 'Empty audience',
        subject: 'Hi',
        htmlBody: '<p>Body</p>',
        segment: 'all',
      };

      await expect(
        service.sendCampaign(dto, { email: 'admin@ptah.live' }),
      ).rejects.toMatchObject({ message: 'EMPTY_SEGMENT' });
      expect(mockPrisma.marketingCampaign.create).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // sendCampaign — happy path + skip-opted-out + R3 race
  // ===========================================================================

  describe('sendCampaign — dispatch loop', () => {
    it('records skipped opted-out users in MarketingCampaign.skippedUserIds', async () => {
      mockSegmentResolver.resolve.mockResolvedValue({
        optedInUserIds: ['u-active'],
        skippedUserIds: ['u-opted-out-1', 'u-opted-out-2'],
        totalInSegment: 3,
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-active',
        email: 'active@example.com',
        firstName: 'Active',
        marketingOptIn: true,
      });

      const dto: SendCampaignDto = {
        name: 'Skip test',
        subject: 'Hi',
        htmlBody: '<p>Body</p>',
        userIds: [
          '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000a2',
          '00000000-0000-0000-0000-0000000000a3',
        ],
      };

      const result = await service.sendCampaign(dto, {
        email: 'admin@ptah.live',
      });

      expect(result).toMatchObject({
        campaignId: 'campaign-1',
        recipientCount: 1,
        skippedCount: 2,
        status: 'in_progress',
      });

      expect(mockPrisma.marketingCampaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipientCount: 1,
            skippedUserIds: ['u-opted-out-1', 'u-opted-out-2'],
            createdBy: 'admin@ptah.live',
          }),
        }),
      );

      // Drain the fire-and-forget worker so we can assert on dispatch state.
      await flushAsync(20);
    });

    it('R3: re-reads marketingOptIn per email and skips users who unsubscribe mid-loop', async () => {
      mockSegmentResolver.resolve.mockResolvedValue({
        optedInUserIds: ['u-1', 'u-2', 'u-3'],
        skippedUserIds: [],
        totalInSegment: 3,
      });

      // Simulate one user flipping opt-in to false after segment resolution.
      mockPrisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === 'u-2') {
            return Promise.resolve({
              id: 'u-2',
              email: 'u2@example.com',
              firstName: null,
              marketingOptIn: false, // unsubscribed mid-loop
            });
          }
          return Promise.resolve({
            id: where.id,
            email: `${where.id}@example.com`,
            firstName: null,
            marketingOptIn: true,
          });
        },
      );

      const dto: SendCampaignDto = {
        name: 'Mid-loop race',
        subject: 'Hi',
        htmlBody: '<p>Body</p>',
        segment: 'all',
      };

      await service.sendCampaign(dto, { email: 'admin@ptah.live' });

      // Wait for fire-and-forget runCampaign to drain.
      await flushAsync(50);

      const recipients = mockEmail.sendCustomEmail.mock.calls.map(
        (c) => c[0].to,
      );
      expect(recipients).toContain('u-1@example.com');
      expect(recipients).toContain('u-3@example.com');
      expect(recipients).not.toContain('u-2@example.com');
      expect(mockEmail.sendCustomEmail).toHaveBeenCalledTimes(2);

      // Each delivered email carries the RFC 8058 List-Unsubscribe headers.
      for (const call of mockEmail.sendCustomEmail.mock.calls) {
        expect(call[0].headers).toEqual({
          'List-Unsubscribe': expect.stringMatching(
            /^<https:\/\/.+\/unsubscribe\/.+>$/,
          ),
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        });
        expect(call[0].tags).toEqual([
          { name: 'campaignId', value: 'campaign-1' },
          { name: 'userId', value: expect.any(String) },
        ]);
      }
    });
  });

  // ===========================================================================
  // handleResendWebhook
  // ===========================================================================

  describe('handleResendWebhook', () => {
    const baseEvent: ResendWebhookPayload = {
      created_at: new Date().toISOString(),
      type: 'email.bounced',
      data: {
        created_at: new Date().toISOString(),
        email_id: 'em_123',
        from: 'help@ptah.live',
        to: ['target@example.com'],
        subject: 'Hi',
        tags: { campaignId: 'campaign-1', userId: 'user-77' },
        bounce: { type: 'hard' },
      },
    };

    it('hard bounce flips opt-in and bumps bouncedCount', async () => {
      await service.handleResendWebhook(baseEvent, 'svix-evt-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-77' },
        data: {
          marketingOptIn: false,
          unsubscribedAt: expect.any(Date),
        },
      });
      expect(mockAuditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.bounced',
          targetType: 'User',
          targetId: 'user-77',
        }),
      );
      expect(mockPrisma.marketingCampaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: { bouncedCount: { increment: 1 } },
      });
    });

    it('soft bounce bumps counter without flipping opt-in', async () => {
      const softEvent: ResendWebhookPayload = {
        ...baseEvent,
        data: { ...baseEvent.data, bounce: { type: 'soft' } },
      };

      await service.handleResendWebhook(softEvent, 'svix-evt-soft');

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.marketingCampaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: { bouncedCount: { increment: 1 } },
      });
    });

    it('complaint flips opt-in, audits user.complained, bumps complainedCount', async () => {
      const complaintEvent: ResendWebhookPayload = {
        ...baseEvent,
        type: 'email.complained',
        data: { ...baseEvent.data, bounce: undefined },
      };

      await service.handleResendWebhook(complaintEvent, 'svix-evt-cmp');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-77' },
        data: {
          marketingOptIn: false,
          unsubscribedAt: expect.any(Date),
        },
      });
      expect(mockAuditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.complained' }),
      );
      expect(mockPrisma.marketingCampaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: { complainedCount: { increment: 1 } },
      });
    });

    it('is idempotent on duplicate svix-id — no double increment', async () => {
      await service.handleResendWebhook(baseEvent, 'svix-evt-dup');
      await service.handleResendWebhook(baseEvent, 'svix-evt-dup');

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.marketingCampaign.update).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // Hardening pass — tag payload normalizer (issue #2)
    // -------------------------------------------------------------------------

    it('normalizer — Record shape extracts userId/campaignId and proceeds with bounce flow', async () => {
      const recordEvent: ResendWebhookPayload = {
        ...baseEvent,
        data: {
          ...baseEvent.data,
          tags: { userId: 'user-record', campaignId: 'campaign-record' },
        },
      };

      await service.handleResendWebhook(recordEvent, 'svix-record');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-record' },
        data: { marketingOptIn: false, unsubscribedAt: expect.any(Date) },
      });
      expect(mockPrisma.marketingCampaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-record' },
        data: { bouncedCount: { increment: 1 } },
      });
    });

    it('normalizer — Array shape [{name,value}] extracts userId/campaignId and proceeds with bounce flow', async () => {
      const arrayEvent: ResendWebhookPayload = {
        ...baseEvent,
        data: {
          ...baseEvent.data,
          // Resend's alternate array shape — DTO permits it.
          tags: [
            { name: 'userId', value: 'u-x' },
            { name: 'campaignId', value: 'c-x' },
          ],
        },
      };

      await service.handleResendWebhook(arrayEvent, 'svix-array');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-x' },
        data: { marketingOptIn: false, unsubscribedAt: expect.any(Date) },
      });
      expect(mockPrisma.marketingCampaign.update).toHaveBeenCalledWith({
        where: { id: 'c-x' },
        data: { bouncedCount: { increment: 1 } },
      });
    });

    it('normalizer — neither shape: warns, no opt-out flip, no counter bump, no throw', async () => {
      const warnSpy = jest
        // Logger is private but jest can poke through via prototype.
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      const garbageEvent: ResendWebhookPayload = {
        ...baseEvent,
        data: {
          ...baseEvent.data,
          // Cast through unknown — the runtime sees a string where DTO expects
          // record/array. The normalizer must collapse this safely.
          tags: 'random-string' as unknown as Record<string, string>,
        },
      };

      await expect(
        service.handleResendWebhook(garbageEvent, 'svix-garbage'),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Resend webhook tags yielded no userId/campaignId',
        ),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.marketingCampaign.update).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Hardening pass — runCampaign try/finally (issues #1 + #3)
  // ===========================================================================

  describe('runCampaign — try/finally + atomic completion', () => {
    it('happy path: completedAt set, audit row written inside a transaction with metadata.status=completed', async () => {
      mockSegmentResolver.resolve.mockResolvedValue({
        optedInUserIds: ['u-1', 'u-2'],
        skippedUserIds: [],
        totalInSegment: 2,
      });
      mockPrisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            email: `${where.id}@example.com`,
            firstName: null,
            marketingOptIn: true,
          }),
      );

      const dto: SendCampaignDto = {
        name: 'Happy path',
        subject: 'Hi',
        htmlBody: '<p>Body</p>',
        segment: 'all',
      };

      await service.sendCampaign(dto, { email: 'admin@ptah.live' });
      await flushAsync(50);

      // The transaction must have run.
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Final completion update must include completedAt.
      expect(mockPrisma.marketingCampaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'campaign-1' },
          data: expect.objectContaining({
            sentCount: 2,
            completedAt: expect.any(Date),
          }),
        }),
      );

      // Audit row must have been written with `status: 'completed'`.
      const sendCalls = mockAuditLog.write.mock.calls.filter(
        (c) => c[0]?.action === 'marketing.campaign.send',
      );
      expect(sendCalls.length).toBe(1);
      expect(sendCalls[0][0]).toEqual(
        expect.objectContaining({
          action: 'marketing.campaign.send',
          targetType: 'MarketingCampaign',
          targetId: 'campaign-1',
          tx: expect.anything(),
          metadata: expect.objectContaining({
            sent: 2,
            failed: 0,
            skippedMidLoop: 0,
            status: 'completed',
          }),
        }),
      );
    });

    it('sad path: chunk-progress update throws → finally still records audit row with status=failed and completedAt populated', async () => {
      mockSegmentResolver.resolve.mockResolvedValue({
        optedInUserIds: ['u-1'],
        skippedUserIds: [],
        totalInSegment: 1,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'u1@example.com',
        firstName: null,
        marketingOptIn: true,
      });

      // First update call (in-loop chunk progress) throws; second call (inside
      // the finally transaction) succeeds. We branch on whether `data` carries
      // `completedAt` to distinguish them.
      mockPrisma.marketingCampaign.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          if (data && 'completedAt' in data) {
            return Promise.resolve({ id: 'campaign-1' });
          }
          return Promise.reject(new Error('transient db blip'));
        },
      );

      const dto: SendCampaignDto = {
        name: 'Sad path',
        subject: 'Hi',
        htmlBody: '<p>Body</p>',
        segment: 'all',
      };

      await service.sendCampaign(dto, { email: 'admin@ptah.live' });
      await flushAsync(50);

      // Transaction (finally) must have run despite the in-loop throw.
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Final completion update must include completedAt.
      const completionCall =
        mockPrisma.marketingCampaign.update.mock.calls.find(
          ([arg]) =>
            arg?.data &&
            Object.prototype.hasOwnProperty.call(arg.data, 'completedAt'),
        );
      expect(completionCall).toBeDefined();
      expect(completionCall![0].data.completedAt).toBeInstanceOf(Date);

      // Audit row written with status=failed and the error message captured.
      const sendCalls = mockAuditLog.write.mock.calls.filter(
        (c) => c[0]?.action === 'marketing.campaign.send',
      );
      expect(sendCalls.length).toBe(1);
      expect(sendCalls[0][0]).toEqual(
        expect.objectContaining({
          action: 'marketing.campaign.send',
          targetId: 'campaign-1',
          metadata: expect.objectContaining({
            status: 'failed',
            errorMessage: 'transient db blip',
          }),
        }),
      );
    });
  });
});
