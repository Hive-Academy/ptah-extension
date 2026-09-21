import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import {
  AdminApiService,
  WaitlistDetailsResponse,
  WaitlistEligibleIdsResponse,
  WaitlistListResponse,
} from './admin-api.service';

describe('AdminApiService - waitlist boundary', () => {
  let api: AdminApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        AdminApiService,
      ],
    });
    api = TestBed.inject(AdminApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('listWaitlist', () => {
    it('serializes all query parameters correctly', async () => {
      const mockResponse: WaitlistListResponse = {
        data: [
          {
            id: 'wl-1',
            email: 'user@example.com',
            source: 'landing',
            createdAt: '2026-03-01T00:00:00.000Z',
            notifiedAt: null,
            approvedAt: null,
            convertedAt: null,
            stage: 'new',
            stageAt: '2026-03-01T00:00:00.000Z',
            approvalEligible: true,
          },
        ],
        total: 1,
        page: 2,
        pageSize: 50,
        totalPages: 1,
        counts: {
          all: 10,
          pending: 5,
          new: 3,
          invited: 2,
          approved: 3,
          converted: 2,
        },
      };

      const promise = firstValueFrom(
        api.listWaitlist({
          stage: 'new',
          search: 'user@',
          source: 'landing',
          createdFrom: '2026-03-01T00:00:00.000Z',
          createdTo: '2026-03-15T23:59:59.999Z',
          sortBy: 'createdAt',
          sortOrder: 'asc',
          page: 2,
          pageSize: 50,
        }),
      );

      const req = httpMock.expectOne((r) => r.url === '/api/v1/admin/waitlist');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('stage')).toBe('new');
      expect(req.request.params.get('search')).toBe('user@');
      expect(req.request.params.get('source')).toBe('landing');
      expect(req.request.params.get('createdFrom')).toBe(
        '2026-03-01T00:00:00.000Z',
      );
      expect(req.request.params.get('createdTo')).toBe(
        '2026-03-15T23:59:59.999Z',
      );
      expect(req.request.params.get('sortBy')).toBe('createdAt');
      expect(req.request.params.get('sortOrder')).toBe('asc');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('50');

      req.flush(mockResponse);
      const res = await promise;
      expect(res.data).toHaveLength(1);
      expect(res.data[0].email).toBe('user@example.com');
      expect(res.counts.pending).toBe(5);
    });

    it('rejects an invalid response missing required fields at the boundary', async () => {
      const invalidResponse = {
        data: [{ id: 'wl-1' }], // missing email, stage, etc.
        total: 1,
      };

      const promise = firstValueFrom(api.listWaitlist());
      const req = httpMock.expectOne('/api/v1/admin/waitlist');
      req.flush(invalidResponse);

      await expect(promise).rejects.toThrow();
    });
  });

  describe('resolveEligibleWaitlistIds', () => {
    it('serializes filter params and validates eligible ids response', async () => {
      const mockResponse: WaitlistEligibleIdsResponse = {
        ids: ['wl-1', 'wl-2'],
        selected: 2,
        eligibleMatching: 120,
        limit: 50,
        truncated: true,
      };

      const promise = firstValueFrom(
        api.resolveEligibleWaitlistIds({
          stage: 'new',
          search: 'test',
        }),
      );

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v1/admin/waitlist/eligible-ids',
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('stage')).toBe('new');
      expect(req.request.params.get('search')).toBe('test');

      req.flush(mockResponse);
      const res = await promise;
      expect(res.ids).toEqual(['wl-1', 'wl-2']);
      expect(res.limit).toBe(50);
      expect(res.truncated).toBe(true);
      expect(res.eligibleMatching).toBe(120);
    });

    it.each([
      [
        'more than 50 ids',
        {
          ids: Array.from({ length: 51 }, (_, index) => `wl-${index}`),
          selected: 51,
          eligibleMatching: 51,
          limit: 50,
          truncated: false,
        },
      ],
      [
        'selected does not equal ids.length',
        {
          ids: ['wl-1'],
          selected: 0,
          eligibleMatching: 1,
          limit: 50,
          truncated: true,
        },
      ],
      [
        'ids contain duplicates',
        {
          ids: ['wl-1', 'wl-1'],
          selected: 2,
          eligibleMatching: 2,
          limit: 50,
          truncated: false,
        },
      ],
      [
        'eligibleMatching is below selected',
        {
          ids: ['wl-1', 'wl-2'],
          selected: 2,
          eligibleMatching: 1,
          limit: 50,
          truncated: false,
        },
      ],
      [
        'truncated disagrees with the counts',
        {
          ids: ['wl-1'],
          selected: 1,
          eligibleMatching: 2,
          limit: 50,
          truncated: false,
        },
      ],
      [
        'selected is negative',
        {
          ids: [],
          selected: -1,
          eligibleMatching: 0,
          limit: 50,
          truncated: true,
        },
      ],
    ])('rejects an eligible-ids response when %s', async (_label, body) => {
      const promise = firstValueFrom(api.resolveEligibleWaitlistIds());
      const req = httpMock.expectOne(
        (request) => request.url === '/api/v1/admin/waitlist/eligible-ids',
      );
      req.flush(body);

      await expect(promise).rejects.toThrow();
    });
  });

  describe('getWaitlistDetails', () => {
    it('fetches and validates waitlist details with full user and audit graphs', async () => {
      const mockResponse: WaitlistDetailsResponse = {
        entry: {
          id: 'wl-10',
          email: 'founder@example.com',
          source: 'vscode',
          createdAt: '2026-02-01T12:00:00.000Z',
          notifiedAt: '2026-02-02T12:00:00.000Z',
          approvedAt: '2026-02-03T12:00:00.000Z',
          convertedAt: null,
          stage: 'approved',
          stageAt: '2026-02-03T12:00:00.000Z',
          approvalEligible: false,
        },
        user: {
          id: 'u-1',
          email: 'founder@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          createdAt: '2026-02-03T12:00:00.000Z',
          licenses: [
            {
              id: 'lic-1',
              plan: 'builders',
              status: 'active',
              source: 'complimentary',
              expiresAt: '2027-02-03T12:00:00.000Z',
              createdAt: '2026-02-03T12:00:00.000Z',
              createdBy: 'admin@hive.com',
            },
          ],
          subscriptions: [],
          groups: [
            {
              id: 'grp-1',
              key: 'founding-members',
              name: 'Founding Members',
              assignedAt: '2026-02-03T12:00:00.000Z',
              source: 'waitlist_approval',
            },
          ],
        },
        audit: [
          {
            id: 'aud-1',
            actorEmail: 'admin@hive.com',
            action: 'waitlist.approve',
            targetType: 'Waitlist',
            targetId: 'wl-10',
            createdAt: '2026-02-03T12:00:00.000Z',
            metadata: {
              userId: 'u-1',
              licenseId: 'lic-1',
              wasNotified: true,
            },
          },
        ],
      };

      const promise = firstValueFrom(api.getWaitlistDetails('wl-10'));
      const req = httpMock.expectOne('/api/v1/admin/waitlist/wl-10/details');
      expect(req.request.method).toBe('GET');

      req.flush(mockResponse);
      const res = await promise;
      expect(res.entry.id).toBe('wl-10');
      expect(res.user?.firstName).toBe('Ada');
      expect(res.audit).toHaveLength(1);
    });

    it('accepts null user when entry is not yet linked to an account', async () => {
      const mockResponse: WaitlistDetailsResponse = {
        entry: {
          id: 'wl-11',
          email: 'newbie@example.com',
          source: null,
          createdAt: '2026-03-10T00:00:00.000Z',
          notifiedAt: null,
          approvedAt: null,
          convertedAt: null,
          stage: 'new',
          stageAt: '2026-03-10T00:00:00.000Z',
          approvalEligible: true,
        },
        user: null,
        audit: [],
      };

      const promise = firstValueFrom(api.getWaitlistDetails('wl-11'));
      const req = httpMock.expectOne('/api/v1/admin/waitlist/wl-11/details');
      req.flush(mockResponse);

      const res = await promise;
      expect(res.user).toBeNull();
      expect(res.audit).toEqual([]);
    });
  });

  describe('exportWaitlistCsv', () => {
    it('downloads CSV blob and extracts filename from Content-Disposition header', async () => {
      const csvContent = 'id,email,source,stage\nwl-1,a@b.com,landing,new';
      const blob = new Blob([csvContent], { type: 'text/csv; charset=utf-8' });

      const promise = firstValueFrom(api.exportWaitlistCsv({ stage: 'new' }));

      const req = httpMock.expectOne(
        (r) => r.url === '/api/v1/admin/waitlist/export.csv',
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');

      req.flush(blob, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition':
            'attachment; filename="waitlist-2026-03-16.csv"',
        },
      });

      const res = await promise;
      expect(res.filename).toBe('waitlist-2026-03-16.csv');
      expect(res.blob).toBeDefined();
    });

    it('rejects when response content-type is not text/csv', async () => {
      const jsonBlob = new Blob(['{"error":"unauthorized"}'], {
        type: 'application/json',
      });

      const promise = firstValueFrom(api.exportWaitlistCsv());
      const req = httpMock.expectOne(
        (r) => r.url === '/api/v1/admin/waitlist/export.csv',
      );
      req.flush(jsonBlob, {
        headers: { 'content-type': 'application/json' },
      });

      await expect(promise).rejects.toThrow(/Expected text\/csv response/);
    });
  });

  describe('getStats', () => {
    const validStatsPayload = () => ({
      waitlist: {
        total: 100,
        pending: 60,
        new: 40,
        invited: 20,
        approved: 30,
        converted: 10,
        notified: 25,
        last7Days: 15,
      },
      members: { builders: 50, community: 150 },
      groups: [],
      updatedAt: '2026-03-16T00:00:00.000Z',
    });

    it('parses stats with new waitlist stage fields', async () => {
      const statsPayload = {
        waitlist: {
          total: 100,
          pending: 60,
          new: 40,
          invited: 20,
          approved: 30,
          converted: 10,
          notified: 25,
          last7Days: 15,
        },
        members: { builders: 50, community: 150 },
        groups: [],
        attention: {
          waitlistUninvited: 40,
          failedWebhooksUnresolved: 0,
          subscriptionsPastDue: 1,
          sessionRequestsPending: 0,
        },
        updatedAt: '2026-03-16T00:00:00.000Z',
      };

      const promise = firstValueFrom(api.getStats());
      const req = httpMock.expectOne('/api/v1/admin/stats');
      req.flush(statsPayload);

      const res = await promise;
      expect(res.waitlist.pending).toBe(60);
      expect(res.waitlist.new).toBe(40);
      expect(res.waitlist.invited).toBe(20);
      expect(res.waitlist.approved).toBe(30);
    });

    it.each(['pending', 'new', 'invited', 'approved'])(
      'rejects stats when waitlist.%s is missing',
      async (field) => {
        const statsPayload = validStatsPayload();
        delete (statsPayload.waitlist as Record<string, number>)[field];

        const promise = firstValueFrom(api.getStats());
        const req = httpMock.expectOne('/api/v1/admin/stats');
        req.flush(statsPayload);

        await expect(promise).rejects.toThrow();
      },
    );

    it.each([
      ['negative', -1],
      ['fractional', 1.5],
    ])('rejects stats when waitlist.pending is %s', async (_label, pending) => {
      const statsPayload = validStatsPayload();
      statsPayload.waitlist.pending = pending;

      const promise = firstValueFrom(api.getStats());
      const req = httpMock.expectOne('/api/v1/admin/stats');
      req.flush(statsPayload);

      await expect(promise).rejects.toThrow();
    });
  });
});
