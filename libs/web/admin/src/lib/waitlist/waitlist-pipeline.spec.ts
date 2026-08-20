import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import {
  AdminApiService,
  AdminApproveWaitlistResponse,
  AdminStatsResponse,
} from '../services/admin-api.service';
import { WaitlistPipeline, WaitlistRow } from './waitlist-pipeline';

/**
 * WaitlistPipeline — the approve queue (TASK_2026_201 R9).
 *
 * These tests guard the four behaviours that a template tweak can silently
 * break: the `?tab=approved` deep link, the server filter each tab sends, the
 * four-way stage ranking, and that a returned tally actually reaches the
 * admin's toast rather than being swallowed.
 */

function row(overrides: Partial<WaitlistRow> = {}): WaitlistRow {
  return {
    id: 'wl-1',
    email: 'someone@example.com',
    source: 'landing',
    createdAt: '2026-01-01T00:00:00.000Z',
    notifiedAt: null,
    approvedAt: null,
    convertedAt: null,
    ...overrides,
  };
}

function stats(approved: number | undefined): AdminStatsResponse {
  return {
    waitlist: {
      total: 100,
      notified: 40,
      converted: 5,
      last7Days: 12,
      approved,
    },
    members: { builders: 10, community: 90 },
    groups: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function approvalResponse(): AdminApproveWaitlistResponse {
  return {
    requested: 5,
    tally: {
      approved: 2,
      already_approved: 1,
      already_paid: 1,
      not_found: 1,
      failed: 0,
    },
    results: [
      { id: 'a', email: 'a@example.com', outcome: 'approved', licenseId: 'l1' },
      { id: 'b', email: 'b@example.com', outcome: 'already_approved' },
      { id: 'c', email: 'c@example.com', outcome: 'already_paid' },
      { id: 'd', email: null, outcome: 'not_found' },
      { id: 'e', email: 'e@example.com', outcome: 'approved', licenseId: 'l2' },
    ],
  };
}

/**
 * The component's members are `protected`, which is a template-visibility
 * modifier only — TypeScript blocks the read from a spec, so the cast names
 * the surface under test rather than widening the component's API.
 */
interface PipelineInternals {
  normalizeTab(raw: string | null): string;
  filter(): string | undefined;
  stageLabel(row: WaitlistRow): string;
  stageVariant(row: WaitlistRow): string;
  approvableTab(): boolean;
  selectedIds(): readonly string[];
  approveIds(): readonly string[];
  approveOpen(): boolean;
  approveToast(): AdminApproveWaitlistResponse | null;
  summaryApproved(): number;
  toggleSelected(id: string): void;
  onApproveSelected(): void;
  onApproveRow(row: WaitlistRow): void;
  onApproveDone(result: AdminApproveWaitlistResponse): void;
}

const internals = (c: WaitlistPipeline): PipelineInternals =>
  c as unknown as PipelineInternals;

describe('WaitlistPipeline', () => {
  let api: {
    list: jest.Mock;
    getStats: jest.Mock;
    approveWaitlist: jest.Mock;
  };

  beforeEach(() => {
    api = {
      list: jest
        .fn()
        .mockReturnValue(
          of({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }),
        ),
      getStats: jest.fn().mockReturnValue(of(stats(7))),
      approveWaitlist: jest.fn(),
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

  /** Renders the component at a URL so `?tab=` really drives the tab signal. */
  async function renderAt(url: string): Promise<WaitlistPipeline> {
    const harness = await RouterTestingHarness.create();
    return harness.navigateByUrl(url, WaitlistPipeline);
  }

  function createDetached(): ComponentFixture<WaitlistPipeline> {
    const fixture = TestBed.createComponent(WaitlistPipeline);
    fixture.detectChanges();
    return fixture;
  }

  describe('tab normalisation (R9.5)', () => {
    it('accepts every real stage, including the new approved stage', () => {
      const c = internals(createDetached().componentInstance);
      expect(c.normalizeTab('approved')).toBe('approved');
      expect(c.normalizeTab('invited')).toBe('invited');
      expect(c.normalizeTab('converted')).toBe('converted');
      expect(c.normalizeTab('all')).toBe('all');
    });

    it('falls back to new for an absent or unknown tab', () => {
      const c = internals(createDetached().componentInstance);
      expect(c.normalizeTab(null)).toBe('new');
      expect(c.normalizeTab('nonsense')).toBe('new');
      // The retired stage name must NOT resolve to itself.
      expect(c.normalizeTab('invite')).toBe('new');
    });

    it('activates the Approved tab from the ?tab=approved deep link', async () => {
      const component = await renderAt('/admin/waitlist?tab=approved');
      expect(internals(component).filter()).toBe('approved:true');
    });
  });

  describe('server filter per tab', () => {
    it.each([
      ['/admin/waitlist', 'notified:false'],
      ['/admin/waitlist?tab=invited', 'notified:true'],
      ['/admin/waitlist?tab=approved', 'approved:true'],
      ['/admin/waitlist?tab=converted', 'converted:true'],
    ])('%s sends filter %s', async (url, expected) => {
      const component = await renderAt(url);
      expect(internals(component).filter()).toBe(expected);
    });

    it('sends no filter on the All tab', async () => {
      const component = await renderAt('/admin/waitlist?tab=all');
      expect(internals(component).filter()).toBeUndefined();
    });
  });

  describe('stage ranking Converted → Approved → Invited → New (R9.4)', () => {
    it('ranks converted above every other stamp', () => {
      const c = internals(createDetached().componentInstance);
      const r = row({
        notifiedAt: '2026-01-02T00:00:00.000Z',
        approvedAt: '2026-01-03T00:00:00.000Z',
        convertedAt: '2026-01-04T00:00:00.000Z',
      });
      expect(c.stageLabel(r)).toBe('Converted');
      expect(c.stageVariant(r)).toBe('success');
    });

    it('ranks approved above invited', () => {
      const c = internals(createDetached().componentInstance);
      const r = row({
        notifiedAt: '2026-01-02T00:00:00.000Z',
        approvedAt: '2026-01-03T00:00:00.000Z',
      });
      expect(c.stageLabel(r)).toBe('Approved');
      expect(c.stageVariant(r)).toBe('info');
    });

    it('reads Approved for a row approved without ever being invited', () => {
      // The accepted tab overlap: this row appears under both New and
      // Approved, and the chip is what tells the admin which it really is.
      const c = internals(createDetached().componentInstance);
      const r = row({ approvedAt: '2026-01-03T00:00:00.000Z' });
      expect(c.stageLabel(r)).toBe('Approved');
    });

    it('ranks invited above new, and an untouched row reads New', () => {
      const c = internals(createDetached().componentInstance);
      expect(
        c.stageLabel(row({ notifiedAt: '2026-01-02T00:00:00.000Z' })),
      ).toBe('Invited');
      expect(c.stageLabel(row())).toBe('New');
      expect(c.stageVariant(row())).toBe('ghost');
    });
  });

  describe('approve action', () => {
    // R6.4 — New is approvable. Approve used to be gated behind Invited, so a
    // New row could only be approved after being mailed the paid invite.
    it.each([
      ['/admin/waitlist', true],
      ['/admin/waitlist?tab=invited', true],
      ['/admin/waitlist?tab=approved', false],
      ['/admin/waitlist?tab=converted', false],
    ])('%s → approvable: %s', async (url, approvable) => {
      const component = await renderAt(url);
      expect(internals(component).approvableTab()).toBe(approvable);
    });

    it('opens the modal with a single id from a per-row approve', () => {
      const c = internals(createDetached().componentInstance);
      c.onApproveRow(row({ id: 'wl-42' }));
      expect(c.approveIds()).toEqual(['wl-42']);
      expect(c.approveOpen()).toBe(true);
    });

    it('opens the modal with the whole selection from a bulk approve', () => {
      const c = internals(createDetached().componentInstance);
      c.toggleSelected('wl-1');
      c.toggleSelected('wl-2');
      c.onApproveSelected();
      expect(c.approveIds()).toEqual(['wl-1', 'wl-2']);
      expect(c.approveOpen()).toBe(true);
    });

    it('does not open the modal with an empty selection', () => {
      const c = internals(createDetached().componentInstance);
      c.onApproveSelected();
      expect(c.approveOpen()).toBe(false);
    });
  });

  describe('approval result handling (R9.3)', () => {
    it('puts the full per-outcome tally on the toast, skips included', () => {
      const c = internals(createDetached().componentInstance);
      const result = approvalResponse();
      c.onApproveDone(result);

      const toast = c.approveToast();
      expect(toast).toBe(result);
      // The skips are the point — a summary of successes only would hide them.
      expect(toast?.tally).toEqual({
        approved: 2,
        already_approved: 1,
        already_paid: 1,
        not_found: 1,
        failed: 0,
      });
    });

    it('refreshes both the row list and the header summary', () => {
      const fixture = createDetached();
      const c = internals(fixture.componentInstance);
      const listCallsBefore = api.list.mock.calls.length;
      const statsCallsBefore = api.getStats.mock.calls.length;

      c.onApproveDone(approvalResponse());
      fixture.detectChanges();

      expect(api.list.mock.calls.length).toBeGreaterThan(listCallsBefore);
      expect(api.getStats.mock.calls.length).toBeGreaterThan(statsCallsBefore);
    });

    it('clears the selection once a response comes back', () => {
      const c = internals(createDetached().componentInstance);
      c.toggleSelected('wl-1');
      c.onApproveDone(approvalResponse());
      expect(c.selectedIds()).toEqual([]);
    });
  });

  describe('header summary', () => {
    it('reads the approved count from the stats endpoint', () => {
      const c = internals(createDetached().componentInstance);
      expect(c.summaryApproved()).toBe(7);
    });

    it('reads 0 when a server predating the approve endpoint omits the count', () => {
      api.getStats.mockReturnValue(of(stats(undefined)));
      const c = internals(createDetached().componentInstance);
      expect(c.summaryApproved()).toBe(0);
    });

    it('survives a failing stats call without blanking the page', () => {
      api.getStats.mockReturnValue(throwError(() => new Error('boom')));
      const c = internals(createDetached().componentInstance);
      expect(c.summaryApproved()).toBe(0);
    });
  });
});
