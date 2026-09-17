import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import { AuditLogService } from '@ptah-api/audit';
import type { AdminActor } from '@ptah-api/licensing';

import { AdminWaitlistService } from './admin-waitlist.service';
import type {
  WaitlistFilterQueryDto,
  WaitlistListQueryDto,
} from './admin-waitlist.dto';
import {
  WAITLIST_STAGE_PREDICATES,
  buildWaitlistWhere,
} from './waitlist-query';
import type { WaitlistRecordRow } from './admin-waitlist.service';

/**
 * AdminWaitlistService — the admin waitlist READ surface (TASK_2026_462
 * Batch A, Component 2).
 *
 * These tests mock the Prisma client, never a database. The two things this
 * spec exists to prove:
 *
 *   🔴 THE STAGE STAYS OUT OF THE COUNTS — the page read and `total` carry the
 *   active stage; the five stage counts apply the same optional filters with
 *   the stage omitted, so the tabs stay accurate while the admin views one
 *   stage.
 *
 *   🔴 EXPORT IS COMPLIANCE-SAFE — fixed header, quoted cells with doubled
 *   embedded quotes, formula prefixes neutralized, ISO/null serialization,
 *   audit written BEFORE the bytes leave, and the search string never copied
 *   onto the audit row.
 */

const ACTOR: AdminActor = {
  email: 'admin@example.com',
  ip: '203.0.113.10',
  userAgent: 'jest-agent',
};

/** The projection every list-like read selects (mirror of the service's). */
const WAITLIST_SELECT = {
  id: true,
  email: true,
  source: true,
  createdAt: true,
  notifiedAt: true,
  approvedAt: true,
  convertedAt: true,
};

const NEW_ROW: WaitlistRecordRow = {
  id: 'wl-1',
  email: 'lead@example.com',
  source: 'landing',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
  notifiedAt: null,
  approvedAt: null,
  convertedAt: null,
};

const INVITED_ROW: WaitlistRecordRow = {
  id: 'wl-2',
  email: 'invited@example.com',
  source: null,
  createdAt: new Date('2026-06-02T12:00:00.000Z'),
  notifiedAt: new Date('2026-07-01T12:00:00.000Z'),
  approvedAt: null,
  convertedAt: null,
};

const CONVERTED_ROW: WaitlistRecordRow = {
  id: 'wl-3',
  email: 'paid@example.com',
  source: 'pricing',
  createdAt: new Date('2026-06-03T12:00:00.000Z'),
  notifiedAt: new Date('2026-07-02T12:00:00.000Z'),
  approvedAt: new Date('2026-08-01T12:00:00.000Z'),
  convertedAt: new Date('2026-09-01T12:00:00.000Z'),
};

/** A row whose stored values exercise CSV quoting and formula rules. */
const HOSTILE_ROW: WaitlistRecordRow = {
  id: 'wl-4',
  email: 'evil@example.com',
  source: '=SUM(A1); He said "hi"',
  createdAt: new Date('2026-06-04T12:00:00.000Z'),
  notifiedAt: null,
  approvedAt: null,
  convertedAt: null,
};

describe('AdminWaitlistService', () => {
  let service: AdminWaitlistService;
  let mockPrisma: {
    waitlist: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
    };
    user: { findFirst: jest.Mock };
    adminAuditLog: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockAudit: { write: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      waitlist: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      user: { findFirst: jest.fn() },
      adminAuditLog: { findMany: jest.fn() },
      // Array transactions resolve as written by the delegates; Promise.all
      // mirrors the positional destructure the service performs.
      $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
    };
    mockAudit = { write: jest.fn().mockResolvedValue('audit-row-1') };

    service = new AdminWaitlistService(
      mockPrisma as unknown as PrismaService,
      mockAudit as unknown as AuditLogService,
    );
  });

  describe('list', () => {
    it('returns one page with stage-derived wire rows and the five stage counts', async () => {
      mockPrisma.waitlist.findMany.mockResolvedValue([
        NEW_ROW,
        INVITED_ROW,
        CONVERTED_ROW,
      ]);
      // count call order: total, all, new, invited, approved, converted.
      mockPrisma.waitlist.count
        .mockResolvedValueOnce(42)
        .mockResolvedValueOnce(42)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);

      const result = await service.list({} as WaitlistListQueryDto);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // ONE round trip: the page read plus the total plus five counts.
      expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(7);
      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 25,
        select: WAITLIST_SELECT,
      });
      // Stage counts reuse the same (empty) filters with no stage predicate
      // of their own, ANDed with exactly one literal stage predicate.
      const countCalls = mockPrisma.waitlist.count.mock.calls;
      expect(countCalls[0][0]).toEqual({ where: {} });
      expect(countCalls[1][0]).toEqual({ where: {} });
      expect(countCalls[2][0]).toEqual({
        where: { AND: [{}, WAITLIST_STAGE_PREDICATES.new] },
      });
      expect(countCalls[3][0]).toEqual({
        where: { AND: [{}, WAITLIST_STAGE_PREDICATES.invited] },
      });
      expect(countCalls[4][0]).toEqual({
        where: { AND: [{}, WAITLIST_STAGE_PREDICATES.approved] },
      });
      expect(countCalls[5][0]).toEqual({
        where: { AND: [{}, WAITLIST_STAGE_PREDICATES.converted] },
      });

      expect(result).toEqual({
        data: [
          {
            id: 'wl-1',
            email: 'lead@example.com',
            source: 'landing',
            createdAt: '2026-06-01T12:00:00.000Z',
            notifiedAt: null,
            approvedAt: null,
            convertedAt: null,
            stage: 'new',
            stageAt: '2026-06-01T12:00:00.000Z',
            approvalEligible: true,
          },
          {
            id: 'wl-2',
            email: 'invited@example.com',
            source: null,
            createdAt: '2026-06-02T12:00:00.000Z',
            notifiedAt: '2026-07-01T12:00:00.000Z',
            approvedAt: null,
            convertedAt: null,
            stage: 'invited',
            stageAt: '2026-07-01T12:00:00.000Z',
            approvalEligible: true,
          },
          {
            id: 'wl-3',
            email: 'paid@example.com',
            source: 'pricing',
            createdAt: '2026-06-03T12:00:00.000Z',
            notifiedAt: '2026-07-02T12:00:00.000Z',
            approvedAt: '2026-08-01T12:00:00.000Z',
            convertedAt: '2026-09-01T12:00:00.000Z',
            stage: 'converted',
            stageAt: '2026-09-01T12:00:00.000Z',
            approvalEligible: false,
          },
        ],
        total: 42,
        page: 1,
        pageSize: 25,
        totalPages: 2,
        // pending is the aggregate new + invited; the four stages sum to all.
        counts: {
          all: 42,
          pending: 32,
          new: 12,
          invited: 20,
          approved: 7,
          converted: 3,
        },
      });
    });

    it('applies the active stage to the page and total, but never to the stage counts', async () => {
      mockPrisma.waitlist.findMany.mockResolvedValue([]);
      mockPrisma.waitlist.count
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(42)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);

      const filterOnlyWhere = buildWaitlistWhere({
        search: '  lead  ',
        source: 'landing',
        createdFrom: '2026-09-01T00:00:00.000Z',
        createdTo: '2026-09-16T23:59:59.999Z',
      });
      const stageWhere = buildWaitlistWhere({
        stage: 'new',
        search: '  lead  ',
        source: 'landing',
        createdFrom: '2026-09-01T00:00:00.000Z',
        createdTo: '2026-09-16T23:59:59.999Z',
      });

      await service.list({
        stage: 'new',
        search: '  lead  ',
        source: 'landing',
        createdFrom: '2026-09-01T00:00:00.000Z',
        createdTo: '2026-09-16T23:59:59.999Z',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        page: 2,
        pageSize: 10,
      } as WaitlistListQueryDto);

      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith({
        where: stageWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 10,
        take: 10,
        select: WAITLIST_SELECT,
      });
      const countCalls = mockPrisma.waitlist.count.mock.calls;
      // total carries the stage; the tabs do not.
      expect(countCalls[0][0]).toEqual({ where: stageWhere });
      expect(countCalls[1][0]).toEqual({ where: filterOnlyWhere });
      expect(countCalls[2][0]).toEqual({
        where: { AND: [filterOnlyWhere, WAITLIST_STAGE_PREDICATES.new] },
      });
      expect(countCalls[3][0]).toEqual({
        where: { AND: [filterOnlyWhere, WAITLIST_STAGE_PREDICATES.invited] },
      });
      expect(countCalls[4][0]).toEqual({
        where: { AND: [filterOnlyWhere, WAITLIST_STAGE_PREDICATES.approved] },
      });
      expect(countCalls[5][0]).toEqual({
        where: { AND: [filterOnlyWhere, WAITLIST_STAGE_PREDICATES.converted] },
      });
    });

    it('returns empty data with accurate metadata beyond the final page', async () => {
      mockPrisma.waitlist.findMany.mockResolvedValue([]);
      mockPrisma.waitlist.count
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.list({
        page: 99,
        pageSize: 25,
      } as WaitlistListQueryDto);

      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 98 * 25, take: 25 }),
      );
      expect(result.data).toEqual([]);
      expect(result.total).toBe(12);
      expect(result.totalPages).toBe(1);
      expect(result.page).toBe(99);
    });

    it('🔴 translates an unexpected failure into 503 WAITLIST_QUERY_UNAVAILABLE with no raw cause', async () => {
      mockPrisma.waitlist.findMany.mockRejectedValue(
        new Error('relation "waitlist" does not exist'),
      );

      let thrown: unknown;
      try {
        await service.list({} as WaitlistListQueryDto);
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(thrown).toBeInstanceOf(Error);
      expect(body).toMatchObject({
        code: 'WAITLIST_QUERY_UNAVAILABLE',
        message: 'Waitlist query is temporarily unavailable',
      });
      // The Prisma text stays server-side.
      expect(JSON.stringify(body)).not.toContain('does not exist');
    });

    it('validates date range once and throws BadRequestException INVALID_DATE_RANGE when createdFrom > createdTo', async () => {
      let thrown: unknown;
      try {
        await service.list({
          createdFrom: '2026-09-16T23:59:59.999Z',
          createdTo: '2026-09-01T00:00:00.000Z',
        } as WaitlistListQueryDto);
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);
      const body = (thrown as BadRequestException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        code: 'INVALID_DATE_RANGE',
        message: 'createdFrom must be before or equal to createdTo',
      });
      expect(mockPrisma.waitlist.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.waitlist.count).not.toHaveBeenCalled();
    });

    it('propagates the policy module reversed-range 400 unchanged', async () => {
      await expect(
        service.list({
          createdFrom: '2026-09-16T00:00:00.000Z',
          createdTo: '2026-09-01T00:00:00.000Z',
        } as WaitlistListQueryDto),
      ).rejects.toThrow(BadRequestException);
      // Nothing reached Prisma — the range check fires before any query.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('resolveEligibleIds', () => {
    it('returns the first 50 ordered ids, the full eligible count, and the truncation flag', async () => {
      const ids = Array.from({ length: 50 }, (_, i) => `wl-${i + 1}`);
      mockPrisma.waitlist.count.mockResolvedValue(137);
      mockPrisma.waitlist.findMany.mockResolvedValue(ids.map((id) => ({ id })));

      const result = await service.resolveEligibleIds(
        {} as WaitlistFilterQueryDto,
      );

      expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith({
        where: { AND: [{}, { approvedAt: null, convertedAt: null }] },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50,
        select: { id: true },
      });
      expect(mockPrisma.waitlist.count).toHaveBeenCalledWith({
        where: { AND: [{}, { approvedAt: null, convertedAt: null }] },
      });
      expect(result).toEqual({
        ids,
        selected: 50,
        eligibleMatching: 137,
        limit: 50,
        truncated: true,
      });
    });

    it('ANDs the filters before eligibility so a filtered tab yields only eligible rows', async () => {
      mockPrisma.waitlist.count.mockResolvedValue(2);
      mockPrisma.waitlist.findMany.mockResolvedValue([
        { id: 'wl-1' },
        { id: 'wl-2' },
      ]);

      const result = await service.resolveEligibleIds({
        stage: 'invited',
        search: 'builder',
      } as WaitlistFilterQueryDto);

      const expected = {
        AND: [
          buildWaitlistWhere({ stage: 'invited', search: 'builder' }),
          { approvedAt: null, convertedAt: null },
        ],
      };
      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected, take: 50 }),
      );
      expect(result.truncated).toBe(false);
      expect(result.selected).toBe(2);
      expect(result.eligibleMatching).toBe(2);
    });

    it('translates an unexpected failure into 503 WAITLIST_SELECTION_UNAVAILABLE', async () => {
      mockPrisma.waitlist.count.mockRejectedValue(new Error('pool exhausted'));

      let thrown: unknown;
      try {
        await service.resolveEligibleIds({} as WaitlistFilterQueryDto);
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'WAITLIST_SELECTION_UNAVAILABLE',
        message: 'Waitlist selection is temporarily unavailable',
      });
    });
  });

  describe('exportCsv', () => {
    it('🔴 encodes formula-safe CSV, audits the shape of the export, and returns a server-dated filename', async () => {
      mockPrisma.waitlist.count.mockResolvedValue(4);
      mockPrisma.waitlist.findMany.mockResolvedValue([
        NEW_ROW,
        INVITED_ROW,
        CONVERTED_ROW,
        HOSTILE_ROW,
      ]);

      const result = await service.exportCsv(
        { search: 'jane@example.com' } as WaitlistFilterQueryDto,
        ACTOR,
      );

      // One count, then one read with the same where/order as the list.
      expect(mockPrisma.waitlist.count).toHaveBeenCalledTimes(1);
      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith({
        where: buildWaitlistWhere({ search: 'jane@example.com' }),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50_001,
        select: WAITLIST_SELECT,
      });

      const lines = result.csv.split('\n');
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe(
        'id,email,source,stage,createdAt,notifiedAt,approvedAt,convertedAt',
      );
      // Every scalar quoted, nulls empty, timestamps ISO-8601 UTC, stage
      // derived by the one policy.
      expect(lines[1]).toBe(
        '"wl-1","lead@example.com","landing","new",' +
          '"2026-06-01T12:00:00.000Z","","",""',
      );
      expect(lines[2]).toBe(
        '"wl-2","invited@example.com","","invited",' +
          '"2026-06-02T12:00:00.000Z","2026-07-01T12:00:00.000Z","",""',
      );
      expect(lines[3]).toBe(
        '"wl-3","paid@example.com","pricing","converted",' +
          '"2026-06-03T12:00:00.000Z","2026-07-02T12:00:00.000Z",' +
          '"2026-08-01T12:00:00.000Z","2026-09-01T12:00:00.000Z"',
      );
      // Formula prefix neutralized BEFORE quoting, embedded quotes doubled.
      expect(lines[4]).toBe(
        '"wl-4","evil@example.com","\'=SUM(A1); He said ""hi""","new",' +
          '"2026-06-04T12:00:00.000Z","","",""',
      );

      // Audit-before-download: the row exists before the csv leaves.
      expect(mockAudit.write).toHaveBeenCalledTimes(1);
      expect(mockAudit.write).toHaveBeenCalledWith({
        actorEmail: 'admin@example.com',
        action: 'waitlist.export',
        targetType: 'Waitlist',
        metadata: {
          stage: 'all',
          source: null,
          createdFrom: null,
          createdTo: null,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          // The search STRING is never copied — only the boolean.
          searchApplied: true,
          exportedCount: 4,
        },
        ipAddress: '203.0.113.10',
        userAgent: 'jest-agent',
      });

      expect(result.filename).toMatch(/^waitlist-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it.each([
      ['leading equals', '=1+1', '"\'=1+1"'],
      ['leading plus', '+1+1', '"\'+1+1"'],
      ['leading minus', '-1+1', '"\'-1+1"'],
      ['leading at', '@SUM(A1)', '"\'@SUM(A1)"'],
      ['leading tab', '\t=1+1', '"\'\t=1+1"'],
      ['leading carriage return', '\r=1+1', '"\'\r=1+1"'],
      ['embedded quote', 'He said "hi"', '"He said ""hi"""'],
      ['embedded newline', 'line one\nline two', '"line one\nline two"'],
    ])(
      'encodes a formula-safe CSV cell for %s',
      async (_label, source, cell) => {
        mockPrisma.waitlist.count.mockResolvedValue(1);
        mockPrisma.waitlist.findMany.mockResolvedValue([
          { ...NEW_ROW, source },
        ]);

        const result = await service.exportCsv(
          {} as WaitlistFilterQueryDto,
          ACTOR,
        );

        expect(result.csv).toContain(`,${cell},"new",`);
      },
    );

    it('🔴 fails closed with 503 WAITLIST_EXPORT_AUDIT_FAILED and sends no csv when the audit write fails', async () => {
      mockPrisma.waitlist.count.mockResolvedValue(1);
      mockPrisma.waitlist.findMany.mockResolvedValue([NEW_ROW]);
      mockAudit.write.mockRejectedValue(new Error('audit insert refused'));

      let thrown: unknown;
      try {
        await service.exportCsv({} as WaitlistFilterQueryDto, ACTOR);
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'WAITLIST_EXPORT_AUDIT_FAILED',
        message: 'Waitlist export is temporarily unavailable',
      });
    });

    it('rejects an over-cap export with 413 WAITLIST_EXPORT_LIMIT_EXCEEDED before any data read', async () => {
      mockPrisma.waitlist.count.mockResolvedValue(50_001);

      let thrown: unknown;
      try {
        await service.exportCsv({} as WaitlistFilterQueryDto, ACTOR);
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'WAITLIST_EXPORT_LIMIT_EXCEEDED',
        message: 'Narrow the filters before exporting.',
      });
      expect(mockPrisma.waitlist.findMany).not.toHaveBeenCalled();
      expect(mockAudit.write).not.toHaveBeenCalled();
    });

    it('rejects a count/read race returning 50,001 rows before encoding or audit', async () => {
      mockPrisma.waitlist.count.mockResolvedValue(50_000);
      mockPrisma.waitlist.findMany.mockResolvedValue(
        new Array<WaitlistRecordRow>(50_001).fill(NEW_ROW),
      );

      let thrown: unknown;
      try {
        await service.exportCsv({} as WaitlistFilterQueryDto, ACTOR);
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'WAITLIST_EXPORT_LIMIT_EXCEEDED',
        message: 'Narrow the filters before exporting.',
      });
      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50_001 }),
      );
      expect(mockAudit.write).not.toHaveBeenCalled();
    });

    it('translates a count/read failure into 503 WAITLIST_EXPORT_UNAVAILABLE', async () => {
      mockPrisma.waitlist.count.mockRejectedValue(new Error('timeout'));

      let thrown: unknown;
      try {
        await service.exportCsv({} as WaitlistFilterQueryDto, ACTOR);
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'WAITLIST_EXPORT_UNAVAILABLE',
        message: 'Waitlist export is temporarily unavailable',
      });
    });
  });

  describe('getDetails', () => {
    it('returns the entry, the linked user graph, and the projected audit stream', async () => {
      mockPrisma.waitlist.findUnique.mockResolvedValue(NEW_ROW);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'lead@example.com',
        firstName: 'Jane',
        lastName: null,
        createdAt: new Date('2026-06-05T12:00:00.000Z'),
        licenses: [
          {
            id: 'lic-1',
            plan: 'community',
            status: 'active',
            source: 'signup',
            expiresAt: null,
            createdAt: new Date('2026-06-05T12:00:00.000Z'),
            createdBy: 'registration',
          },
        ],
        subscriptions: [],
        memberGroupAssignments: [
          {
            id: 'assign-1',
            assignedAt: new Date('2026-08-02T12:00:00.000Z'),
            source: 'admin',
            group: { id: 'grp-1', key: 'founding', name: 'Founding' },
          },
        ],
      });
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([
        {
          id: 'audit-1',
          actorEmail: 'admin@example.com',
          action: 'waitlist.approve',
          targetType: 'Waitlist',
          targetId: 'wl-1',
          createdAt: new Date('2026-08-01T12:00:00.000Z'),
          metadata: {
            userId: 'user-1',
            userWasCreated: { invalid: true },
            licenseId: 42,
            durationPreset: ['one-year'],
            expiresAt: 123,
            groupKey: 'founding',
            wasNotified: false,
            cohortAlreadyAssigned: 'false',
            // Anything the projection does not know is dropped.
            secret: 'internal-only',
          },
        },
      ]);

      const result = await service.getDetails('wl-1');

      expect(mockPrisma.waitlist.findUnique).toHaveBeenCalledWith({
        where: { id: 'wl-1' },
        select: WAITLIST_SELECT,
      });
      // One nested user query, normalized email, case-insensitive.
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          email: { equals: 'lead@example.com', mode: 'insensitive' },
        },
        select: expect.objectContaining({
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          // NEVER licenseKey — the credential stays out of the payload.
          licenses: expect.objectContaining({
            select: expect.not.objectContaining({ licenseKey: true }),
          }),
        }),
      });
      expect(mockPrisma.adminAuditLog.findMany).toHaveBeenCalledWith({
        where: { targetType: 'Waitlist', targetId: 'wl-1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          actorEmail: true,
          action: true,
          targetType: true,
          targetId: true,
          createdAt: true,
          metadata: true,
        },
      });

      expect(result.entry.id).toBe('wl-1');
      expect(result.entry.stage).toBe('new');
      expect(result.user).toEqual({
        id: 'user-1',
        email: 'lead@example.com',
        firstName: 'Jane',
        lastName: null,
        createdAt: '2026-06-05T12:00:00.000Z',
        licenses: [
          {
            id: 'lic-1',
            plan: 'community',
            status: 'active',
            source: 'signup',
            expiresAt: null,
            createdAt: '2026-06-05T12:00:00.000Z',
            createdBy: 'registration',
          },
        ],
        subscriptions: [],
        groups: [
          {
            id: 'grp-1',
            key: 'founding',
            name: 'Founding',
            assignedAt: '2026-08-02T12:00:00.000Z',
            source: 'admin',
          },
        ],
      });
      expect(result.audit).toEqual([
        {
          id: 'audit-1',
          actorEmail: 'admin@example.com',
          action: 'waitlist.approve',
          targetType: 'Waitlist',
          targetId: 'wl-1',
          createdAt: '2026-08-01T12:00:00.000Z',
          metadata: {
            userId: 'user-1',
            groupKey: 'founding',
            wasNotified: false,
          },
        },
      ]);
    });

    it('normalizes the entry email before the user lookup', async () => {
      mockPrisma.waitlist.findUnique.mockResolvedValue({
        ...NEW_ROW,
        email: 'Lead@Example.com',
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([]);

      await service.getDetails('wl-1');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: { equals: 'lead@example.com', mode: 'insensitive' } },
        }),
      );
    });

    it('returns null user and empty audit for a lead who never registered', async () => {
      mockPrisma.waitlist.findUnique.mockResolvedValue(INVITED_ROW);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.adminAuditLog.findMany.mockResolvedValue([]);

      const result = await service.getDetails('wl-2');

      expect(result.entry.id).toBe('wl-2');
      expect(result.user).toBeNull();
      expect(result.audit).toEqual([]);
    });

    it('🔴 returns 404 WAITLIST_NOT_FOUND for a missing entry', async () => {
      mockPrisma.waitlist.findUnique.mockResolvedValue(null);

      let thrown: unknown;
      try {
        await service.getDetails('ghost');
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'WAITLIST_NOT_FOUND',
        message: 'Waitlist entry not found',
      });
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('translates a context failure into 503 WAITLIST_DETAILS_UNAVAILABLE with the fixed safe message', async () => {
      mockPrisma.waitlist.findUnique.mockResolvedValue(NEW_ROW);
      mockPrisma.user.findFirst.mockRejectedValue(new Error('deadlock'));

      let thrown: unknown;
      try {
        await service.getDetails('wl-1');
      } catch (error: unknown) {
        thrown = error;
      }

      const body = (
        thrown as { getResponse: () => unknown }
      ).getResponse() as Record<string, unknown>;
      expect(body).toMatchObject({
        code: 'WAITLIST_DETAILS_UNAVAILABLE',
        message: 'Waitlist details are temporarily unavailable',
      });
      expect(JSON.stringify(body)).not.toContain('deadlock');
    });
  });
});
