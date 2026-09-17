import { ValidationPipe } from '@nestjs/common';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';
import { ApproveWaitlistDto } from './admin.dto';
import {
  WaitlistFilterQueryDto,
  WaitlistIdParamsDto,
  WaitlistListQueryDto,
} from './admin-waitlist.dto';
import { AdminWaitlistController } from './admin-waitlist.controller';
import type { AdminWaitlistService } from './admin-waitlist.service';
import type {
  WaitlistDetailsResponse,
  WaitlistEligibleIdsResponse,
  WaitlistListResponse,
} from './admin-waitlist.types';
import type { WaitlistApprovalService } from './waitlist-approval/waitlist-approval.service';
import type { WaitlistApprovalResponse } from './waitlist-approval/waitlist-approval.types';

/**
 * Unit tests for AdminWaitlistController (TASK_2026_462 Batch A).
 *
 * Verifies:
 *   - Class-level guard chain (JwtAuthGuard -> AdminGuard)
 *   - dtoPipe validation binding with expectedType on all query/param/body inputs
 *   - Route delegation to AdminWaitlistService and WaitlistApprovalService
 *   - CSV export headers, filename, and actor extraction
 *   - Static routes (eligible-ids, export.csv) declared before dynamic :id/details
 */
describe('AdminWaitlistController', () => {
  let controller: AdminWaitlistController;
  let mockWaitlistService: {
    list: jest.Mock;
    resolveEligibleIds: jest.Mock;
    exportCsv: jest.Mock;
    getDetails: jest.Mock;
  };
  let mockApprovalService: {
    approve: jest.Mock;
  };

  beforeEach(() => {
    mockWaitlistService = {
      list: jest.fn(),
      resolveEligibleIds: jest.fn(),
      exportCsv: jest.fn(),
      getDetails: jest.fn(),
    };
    mockApprovalService = {
      approve: jest.fn(),
    };
    controller = new AdminWaitlistController(
      mockApprovalService as unknown as WaitlistApprovalService,
      mockWaitlistService as unknown as AdminWaitlistService,
    );
  });

  describe('guards and metadata', () => {
    it('carries JwtAuthGuard and AdminGuard at class level', () => {
      const guards = Reflect.getMetadata('__guards__', AdminWaitlistController);
      expect(guards).toEqual([JwtAuthGuard, AdminGuard]);
    });

    it('approve carries AdminThrottlerGuard at method level', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        AdminWaitlistController.prototype.approveWaitlist,
      );
      expect(guards).toEqual([AdminThrottlerGuard]);
    });

    it('controller prefix is v1/admin/waitlist', () => {
      const prefix = Reflect.getMetadata(
        PATH_METADATA,
        AdminWaitlistController,
      );
      expect(prefix).toBe('v1/admin/waitlist');
    });
  });

  describe('DTO validation bindings (dtoPipe)', () => {
    function getPipesForHandler(
      handlerName: string,
    ): Array<{ paramIndex: number; expectedType: unknown }> {
      const meta =
        (Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          AdminWaitlistController,
          handlerName,
        ) as Record<string, { pipes?: unknown[] }>) ?? {};

      const result: Array<{ paramIndex: number; expectedType: unknown }> = [];
      for (const [key, value] of Object.entries(meta)) {
        const paramIndex = Number(key.split(':')[1] ?? key.split(':')[0]);
        for (const pipe of value.pipes ?? []) {
          if (pipe instanceof ValidationPipe) {
            result.push({
              paramIndex,
              expectedType: (
                pipe as ValidationPipe & { expectedType?: unknown }
              ).expectedType,
            });
          }
        }
      }
      return result;
    }

    it('listWaitlist binds WaitlistListQueryDto via dtoPipe', () => {
      const pipes = getPipesForHandler('listWaitlist');
      expect(pipes).toHaveLength(1);
      expect(pipes[0].expectedType).toBe(WaitlistListQueryDto);
    });

    it('getEligibleIds binds WaitlistFilterQueryDto via dtoPipe', () => {
      const pipes = getPipesForHandler('getEligibleIds');
      expect(pipes).toHaveLength(1);
      expect(pipes[0].expectedType).toBe(WaitlistFilterQueryDto);
    });

    it('exportCsv binds WaitlistFilterQueryDto via dtoPipe', () => {
      const pipes = getPipesForHandler('exportCsv');
      expect(pipes).toHaveLength(1);
      expect(pipes[0].expectedType).toBe(WaitlistFilterQueryDto);
    });

    it('getDetails binds WaitlistIdParamsDto via dtoPipe', () => {
      const pipes = getPipesForHandler('getDetails');
      expect(pipes).toHaveLength(1);
      expect(pipes[0].expectedType).toBe(WaitlistIdParamsDto);
    });

    it('approveWaitlist binds ApproveWaitlistDto via dtoPipe', () => {
      const pipes = getPipesForHandler('approveWaitlist');
      expect(pipes).toHaveLength(1);
      expect(pipes[0].expectedType).toBe(ApproveWaitlistDto);
    });
  });

  describe('route ordering (shadow prevention)', () => {
    it('registers eligible-ids and export.csv as static paths distinct from :id/details', () => {
      const proto = AdminWaitlistController.prototype;
      const eligiblePath = Reflect.getMetadata(
        PATH_METADATA,
        proto.getEligibleIds,
      );
      const exportPath = Reflect.getMetadata(PATH_METADATA, proto.exportCsv);
      const detailsPath = Reflect.getMetadata(PATH_METADATA, proto.getDetails);

      expect(eligiblePath).toBe('eligible-ids');
      expect(exportPath).toBe('export.csv');
      expect(detailsPath).toBe(':id/details');
      expect(new Set([eligiblePath, exportPath, detailsPath]).size).toBe(3);
    });
  });

  describe('route delegation', () => {
    it('GET / lists waitlist with query and returns response', async () => {
      const query: WaitlistListQueryDto = {
        stage: 'new',
        page: 1,
        pageSize: 25,
      };
      const expectedResponse: WaitlistListResponse = {
        data: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0,
        counts: {
          all: 0,
          pending: 0,
          new: 0,
          invited: 0,
          approved: 0,
          converted: 0,
        },
      };
      mockWaitlistService.list.mockResolvedValue(expectedResponse);

      const result = await controller.listWaitlist(query);

      expect(mockWaitlistService.list).toHaveBeenCalledWith(query);
      expect(result).toBe(expectedResponse);
    });

    it('GET /eligible-ids resolves eligible ids with query and returns response', async () => {
      const query: WaitlistFilterQueryDto = { stage: 'all' };
      const expectedResponse: WaitlistEligibleIdsResponse = {
        ids: ['w1', 'w2'],
        selected: 2,
        eligibleMatching: 2,
        limit: 50,
        truncated: false,
      };
      mockWaitlistService.resolveEligibleIds.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getEligibleIds(query);

      expect(mockWaitlistService.resolveEligibleIds).toHaveBeenCalledWith(
        query,
      );
      expect(result).toBe(expectedResponse);
    });

    it('GET /export.csv sets headers and returns CSV body with actor context', async () => {
      const query: WaitlistFilterQueryDto = { stage: 'all' };
      const req = {
        user: { email: 'admin@hive.com' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'JestClient/1.0' },
      } as unknown as Request;

      const headersSet: Record<string, string> = {};
      const res = {
        setHeader: jest.fn((key: string, value: string) => {
          headersSet[key] = value;
        }),
      } as unknown as Response;

      const exportResult = {
        filename: 'waitlist-2026-09-17.csv',
        csv: 'id,email,source,stage,createdAt,notifiedAt,approvedAt,convertedAt\n',
      };
      mockWaitlistService.exportCsv.mockResolvedValue(exportResult);

      const result = await controller.exportCsv(req, query, res);

      expect(mockWaitlistService.exportCsv).toHaveBeenCalledWith(query, {
        email: 'admin@hive.com',
        ip: '127.0.0.1',
        userAgent: 'JestClient/1.0',
      });
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="waitlist-2026-09-17.csv"',
      );
      expect(result).toBe(exportResult.csv);
    });

    it('GET /export.csv falls back gracefully when actor email or userAgent is absent', async () => {
      const query: WaitlistFilterQueryDto = {};
      const req = {
        ip: '10.0.0.1',
        headers: {},
      } as unknown as Request;
      const res = {
        setHeader: jest.fn(),
      } as unknown as Response;

      mockWaitlistService.exportCsv.mockResolvedValue({
        filename: 'waitlist-2026-09-17.csv',
        csv: '',
      });

      await controller.exportCsv(req, query, res);

      expect(mockWaitlistService.exportCsv).toHaveBeenCalledWith(query, {
        email: 'unknown',
        ip: '10.0.0.1',
        userAgent: undefined,
      });
    });

    it('GET /:id/details delegates id to getDetails', async () => {
      const params: WaitlistIdParamsDto = { id: 'wl-123' };
      const expectedResponse: WaitlistDetailsResponse = {
        entry: {
          id: 'wl-123',
          email: 'test@example.com',
          source: 'landing',
          createdAt: '2026-09-01T00:00:00.000Z',
          notifiedAt: null,
          approvedAt: null,
          convertedAt: null,
          stage: 'new',
          stageAt: '2026-09-01T00:00:00.000Z',
          approvalEligible: true,
        },
        user: null,
        audit: [],
      };
      mockWaitlistService.getDetails.mockResolvedValue(expectedResponse);

      const result = await controller.getDetails(params);

      expect(mockWaitlistService.getDetails).toHaveBeenCalledWith('wl-123');
      expect(result).toBe(expectedResponse);
    });

    it('POST /approve delegates to approval service', async () => {
      const body: ApproveWaitlistDto = { ids: ['wl-1', 'wl-2'] };
      const req = {
        user: { email: 'admin@hive.com' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'JestTest' },
      } as unknown as Request;

      const expectedResponse: WaitlistApprovalResponse = {
        requested: 2,
        tally: {
          approved: 1,
          already_approved: 0,
          already_paid: 1,
          not_found: 0,
          failed: 0,
        },
        results: [
          { id: 'wl-1', email: 'lead1@example.com', outcome: 'approved' },
          { id: 'wl-2', email: 'lead2@example.com', outcome: 'already_paid' },
        ],
      };
      mockApprovalService.approve.mockResolvedValue(expectedResponse);

      const result = await controller.approveWaitlist(req, body);

      expect(mockApprovalService.approve).toHaveBeenCalledWith(
        ['wl-1', 'wl-2'],
        {
          email: 'admin@hive.com',
          ip: '127.0.0.1',
          userAgent: 'JestTest',
        },
      );
      expect(result).toBe(expectedResponse);
    });
  });
});
