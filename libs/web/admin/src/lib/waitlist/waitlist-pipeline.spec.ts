import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import {
  AdminApiService,
  AdminApproveWaitlistResponse,
  AdminStatsResponse,
} from '../services/admin-api.service';
import {
  WaitlistDetailsResponse,
  WaitlistEligibleIdsResponse,
  WaitlistListResponse,
  WaitlistListRow,
} from './waitlist-query-state';
import { WaitlistPipeline } from './waitlist-pipeline';

function row(overrides: Partial<WaitlistListRow> = {}): WaitlistListRow {
  return {
    id: 'wl-1',
    email: 'dev@hive.com',
    source: 'landing',
    createdAt: '2026-01-01T00:00:00.000Z',
    notifiedAt: null,
    approvedAt: null,
    convertedAt: null,
    stage: 'new',
    stageAt: '2026-01-01T00:00:00.000Z',
    approvalEligible: true,
    ...overrides,
  };
}

function mockListResponse(
  overrides: Partial<WaitlistListResponse> = {},
): WaitlistListResponse {
  return {
    data: [row()],
    total: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    counts: {
      all: 10,
      pending: 5,
      new: 3,
      invited: 2,
      approved: 3,
      converted: 2,
    },
    ...overrides,
  };
}

function mockApprovalResponse(): AdminApproveWaitlistResponse {
  return {
    requested: 3,
    tally: {
      approved: 1,
      already_approved: 1,
      already_paid: 0,
      not_found: 0,
      failed: 1,
    },
    results: [
      {
        id: 'wl-1',
        email: 'dev@hive.com',
        outcome: 'approved',
        licenseId: 'lic-1',
      },
      { id: 'wl-2', email: 'two@hive.com', outcome: 'already_approved' },
      {
        id: 'wl-3',
        email: 'three@hive.com',
        outcome: 'failed',
        error: { code: 'GRANT_FAILED' },
      },
    ],
  };
}

describe('WaitlistPipeline', () => {
  let api: {
    listWaitlist: jest.Mock;
    resolveEligibleWaitlistIds: jest.Mock;
    getWaitlistDetails: jest.Mock;
    exportWaitlistCsv: jest.Mock;
    getStats: jest.Mock;
    approveWaitlist: jest.Mock;
  };

  beforeAll(() => {
    window.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
    window.URL.revokeObjectURL = jest.fn();
  });

  beforeEach(() => {
    api = {
      listWaitlist: jest.fn().mockReturnValue(of(mockListResponse())),
      resolveEligibleWaitlistIds: jest.fn().mockReturnValue(
        of<WaitlistEligibleIdsResponse>({
          ids: ['wl-1', 'wl-2'],
          selected: 2,
          eligibleMatching: 85,
          limit: 50,
          truncated: true,
        }),
      ),
      getWaitlistDetails: jest.fn().mockReturnValue(
        of<WaitlistDetailsResponse>({
          entry: row(),
          user: null,
          audit: [],
        }),
      ),
      exportWaitlistCsv: jest.fn().mockReturnValue(
        of({
          blob: new Blob(['id,email'], { type: 'text/csv' }),
          filename: 'waitlist-2026-03-16.csv',
        }),
      ),
      getStats: jest.fn().mockReturnValue(
        of<AdminStatsResponse>({
          waitlist: {
            total: 100,
            notified: 40,
            converted: 5,
            last7Days: 12,
            approved: 15,
            new: 45,
            invited: 40,
            pending: 85,
          },
          members: { builders: 10, community: 90 },
          groups: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
      approveWaitlist: jest.fn().mockReturnValue(of(mockApprovalResponse())),
    };

    TestBed.configureTestingModule({
      imports: [WaitlistPipeline],
      providers: [
        provideRouter([
          { path: 'admin/waitlist', component: WaitlistPipeline },
        ]),
        { provide: AdminApiService, useValue: api },
      ],
    });
  });

  async function renderAt(
    url: string,
  ): Promise<{ component: WaitlistPipeline; harness: RouterTestingHarness }> {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl(url, WaitlistPipeline);
    harness.detectChanges();
    return { component, harness };
  }

  describe('URL state & query binding', () => {
    it('restores all filters and pagination from deep-link query parameters', async () => {
      await renderAt(
        '/admin/waitlist?stage=invited&search=alex&source=vscode&createdFrom=2026-03-01T00:00:00.000Z&createdTo=2026-03-10T23:59:59.999Z&sortBy=notifiedAt&sortOrder=asc&page=2&pageSize=50',
      );

      expect(api.listWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'invited',
          search: 'alex',
          source: 'vscode',
          createdFrom: '2026-03-01T00:00:00.000Z',
          createdTo: '2026-03-10T23:59:59.999Z',
          sortBy: 'notifiedAt',
          sortOrder: 'asc',
          page: 2,
          pageSize: 50,
        }),
      );
    });

    it('falls back to defaults for absent or invalid parameters', async () => {
      await renderAt(
        '/admin/waitlist?stage=invalid&sortBy=invalid&page=-5&pageSize=999',
      );

      expect(api.listWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'new',
          sortBy: 'createdAt',
          sortOrder: 'asc',
          page: 1,
          pageSize: 25,
        }),
      );
    });

    it('canonicalizes legacy ?tab= query param to stage', async () => {
      await renderAt('/admin/waitlist?tab=approved');

      expect(api.listWaitlist).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'approved',
        }),
      );
    });

    it('canonicalizes invalid values in URL using replaceUrl without navigation loop', async () => {
      const router = TestBed.inject(Router);
      const navigateSpy = jest.spyOn(router, 'navigate');

      const { harness } = await renderAt(
        '/admin/waitlist?stage=invalid&sortBy=invalid&sortOrder=invalid&source=invalid&page=-5&pageSize=999&createdFrom=invalid&createdTo=invalid',
      );

      expect(navigateSpy).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          replaceUrl: true,
        }),
      );
      await navigateSpy.mock.results[0]?.value;
      harness.detectChanges();

      // Clean canonical URL has no invalid query params
      expect(router.url).toBe('/admin/waitlist');
    });

    it('uses replaceUrl: true for debounced search navigation to avoid flooding history', fakeAsync(() => {
      const fixture = TestBed.createComponent(WaitlistPipeline);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      const router = TestBed.inject(Router);
      const navigateSpy = jest.spyOn(router, 'navigate');

      component.onSearchChange('debounced query');
      tick(300);
      fixture.detectChanges();

      expect(navigateSpy).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          replaceUrl: true,
          queryParams: expect.objectContaining({
            search: 'debounced query',
          }),
        }),
      );
    }));

    it('navigates when the same search is entered again after clearing filters', fakeAsync(() => {
      const fixture = TestBed.createComponent(WaitlistPipeline);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      const router = TestBed.inject(Router);
      const navigateSpy = jest.spyOn(router, 'navigate');

      component.onSearchChange('alex');
      tick(300);
      tick();
      fixture.detectChanges();

      void component.onClearFilters();
      tick();
      fixture.detectChanges();

      component.onSearchChange('alex');
      tick(300);
      fixture.detectChanges();

      const alexNavigations = navigateSpy.mock.calls.filter(
        ([, extras]) => extras?.queryParams?.['search'] === 'alex',
      );
      expect(alexNavigations).toHaveLength(2);
    }));

    it('replace-navigates an empty out-of-range page to the last page exactly once', async () => {
      api.listWaitlist.mockImplementation((query: { page?: number }) =>
        of(
          query.page === 99
            ? mockListResponse({
                data: [],
                total: 26,
                page: 99,
                totalPages: 2,
              })
            : mockListResponse({ page: 2, total: 26, totalPages: 2 }),
        ),
      );
      const router = TestBed.inject(Router);
      const navigateSpy = jest.spyOn(router, 'navigate');

      const { harness } = await renderAt('/admin/waitlist?page=99');
      await Promise.resolve();
      harness.detectChanges();

      const lastPageCalls = navigateSpy.mock.calls.filter(
        ([, extras]) =>
          extras?.replaceUrl === true && extras.queryParams?.['page'] === 2,
      );
      expect(lastPageCalls).toHaveLength(1);
    });
  });

  describe('filter clearing & stage preservation', () => {
    it('clears optional filters and resets sort/page while preserving the active stage', async () => {
      const { component, harness } = await renderAt(
        '/admin/waitlist?stage=approved&search=test&source=pricing&page=3',
      );

      await component.onClearFilters();
      harness.detectChanges();

      expect(api.listWaitlist).toHaveBeenLastCalledWith(
        expect.objectContaining({
          stage: 'approved',
          search: undefined,
          source: undefined,
          page: 1,
          pageSize: 25,
        }),
      );
    });
  });

  describe('selection & pagination interaction', () => {
    it('retains explicit selection across page changes', async () => {
      const row1 = row({ id: 'wl-1' });
      const row2 = row({ id: 'wl-2' });
      api.listWaitlist.mockReturnValue(
        of(
          mockListResponse({
            data: [row1],
            totalPages: 2,
          }),
        ),
      );

      const { component } = await renderAt('/admin/waitlist');
      const selection = component.selection;

      // Select row1
      selection.toggleRow(row1);
      expect(selection.isSelected('wl-1')).toBe(true);

      // Navigate to page 2 with new row
      api.listWaitlist.mockReturnValue(
        of(
          mockListResponse({
            data: [row2],
            page: 2,
            totalPages: 2,
          }),
        ),
      );

      component.onPageChange(2);

      // Selection of row1 is preserved across page change
      expect(selection.isSelected('wl-1')).toBe(true);
      expect(selection.count()).toBe(1);
    });

    it('clears selection when narrowing criteria (stage) changes', async () => {
      const { component } = await renderAt('/admin/waitlist?stage=new');
      const selection = component.selection;

      selection.toggleRow(row({ id: 'wl-1' }));
      expect(selection.count()).toBe(1);

      component.setStage('invited');

      expect(selection.count()).toBe(0);
    });
  });

  describe('select matching & 50-of-N disclosure', () => {
    it('requests eligible matching IDs and discloses 50 of N', async () => {
      const { component } = await renderAt('/admin/waitlist?stage=new');
      const selection = component.selection;

      component.onSelectMatching();

      expect(api.resolveEligibleWaitlistIds).toHaveBeenCalled();
      expect(selection.count()).toBe(2);
      expect(selection.disclosureLabel()).toBe('2 selected of 85 matching');
    });
  });

  describe('partial approval results & retry', () => {
    it('retains failed IDs in selection and refreshes the list', () => {
      const fixture = TestBed.createComponent(WaitlistPipeline);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      const selection = component.selection;

      selection.toggleRow(row({ id: 'wl-1' }));
      selection.toggleRow(row({ id: 'wl-2' }));
      selection.toggleRow(row({ id: 'wl-3' }));
      expect(selection.count()).toBe(3);

      const listCallsBefore = api.listWaitlist.mock.calls.length;
      component.onApproveDone(mockApprovalResponse());
      fixture.detectChanges();

      // wl-1 was approved, wl-2 was already_approved -> removed
      // wl-3 failed -> retained for retry
      expect(selection.isSelected('wl-1')).toBe(false);
      expect(selection.isSelected('wl-2')).toBe(false);
      expect(selection.isSelected('wl-3')).toBe(true);
      expect(selection.count()).toBe(1);

      // List and stats refreshed
      expect(api.listWaitlist.mock.calls.length).toBeGreaterThan(
        listCallsBefore,
      );
      expect(api.getStats).toHaveBeenCalled();
    });
  });

  describe('CSV export', () => {
    it('initiates export and cleans up object URL', async () => {
      const { component } = await renderAt('/admin/waitlist?stage=new');

      component.onExportCsv();

      expect(api.exportWaitlistCsv).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'new' }),
      );
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('maps a known export code to fixed safe copy', async () => {
      api.exportWaitlistCsv.mockReturnValue(
        throwError(() => ({
          status: 413,
          error: {
            code: 'WAITLIST_EXPORT_LIMIT_EXCEEDED',
            message: 'raw server detail',
          },
        })),
      );
      const { component, harness } = await renderAt('/admin/waitlist');

      component.onExportCsv();
      harness.detectChanges();

      const text =
        (harness.routeNativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain(
        'This export is too large. Narrow the filters and try again.',
      );
      expect(text).not.toContain('raw server detail');
    });

    it('uses generic fixed copy for an unknown export error object', async () => {
      api.exportWaitlistCsv.mockReturnValue(
        throwError(() => ({
          status: 502,
          error: { code: 'UNKNOWN_PROXY', message: 'private proxy detail' },
          message: 'private transport detail',
        })),
      );
      const { component, harness } = await renderAt('/admin/waitlist');

      component.onExportCsv();
      harness.detectChanges();

      const text =
        (harness.routeNativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain(
        'Failed to export waitlist CSV. Please try again.',
      );
      expect(text).not.toContain('private proxy detail');
      expect(text).not.toContain('private transport detail');
    });
  });

  describe('details drawer & focus return', () => {
    it('opens drawer on row viewDetails and restores focus on drawer close', async () => {
      const { component } = await renderAt('/admin/waitlist');

      const triggerBtn = document.createElement('button');
      document.body.appendChild(triggerBtn);
      const focusSpy = jest.spyOn(triggerBtn, 'focus');

      component.onOpenDetails({
        row: row({ id: 'wl-42' }),
        triggerEl: triggerBtn,
      });

      expect(component.drawerOpen()).toBe(true);
      expect(component.activeEntryId()).toBe('wl-42');

      component.onDrawerClosed();

      expect(component.drawerOpen()).toBe(false);
      expect(component.activeEntryId()).toBeNull();
      expect(focusSpy).toHaveBeenCalled();

      document.body.removeChild(triggerBtn);
    });
  });

  describe('selection limits and accessibility announcements', () => {
    it('wraps selection toolbar in an aria-live="polite" output and shows limit message when cap reached', async () => {
      const { component, harness } = await renderAt('/admin/waitlist');
      const selection = component.selection;

      // Select 1 row
      selection.toggleRow(row({ id: 'wl-1' }));
      harness.detectChanges();

      const el = harness.routeNativeElement as HTMLElement;
      const liveRegion = el.querySelector('output[aria-live="polite"]');
      expect(liveRegion).toBeTruthy();
      expect(liveRegion?.textContent).toContain('1 row selected');

      // Select 50 rows to reach cap
      for (let i = 2; i <= 50; i++) {
        selection.toggleRow(row({ id: `wl-${i}` }));
      }
      harness.detectChanges();

      expect(selection.limitReached()).toBe(true);
      expect(liveRegion?.textContent).toContain(
        'Selection limit of 50 reached',
      );
    });
  });

  describe('date range error mapping', () => {
    it('maps 400 INVALID_DATE_RANGE list response to filter bar input instead of generic load error banner', async () => {
      api.listWaitlist.mockReturnValue(
        throwError(() => ({
          status: 400,
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'createdFrom must be before or equal to createdTo',
          },
        })),
      );

      const { component, harness } = await renderAt(
        '/admin/waitlist?createdFrom=2026-03-10T00:00:00.000Z&createdTo=2026-03-01T00:00:00.000Z',
      );
      harness.detectChanges();

      expect(component.loadError()).toBe(false);
      expect(component.dateRangeError()).toBe(
        'createdFrom must be before or equal to createdTo',
      );

      const el = harness.routeNativeElement as HTMLElement;
      // Generic error alert should NOT be present
      expect(
        el.querySelector('div[aria-label="Waitlist load error"]'),
      ).toBeNull();
      // Filter bar should display the invalid date range error
      expect(el.textContent).toContain(
        'createdFrom must be before or equal to createdTo',
      );
    });
  });
});
