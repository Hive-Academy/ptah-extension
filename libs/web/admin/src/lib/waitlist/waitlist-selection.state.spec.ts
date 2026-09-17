import { TestBed } from '@angular/core/testing';

import { AdminApproveWaitlistResponse } from '../services/admin-api.service';
import { WaitlistListRow } from './waitlist-query-state';
import { WaitlistSelectionState } from './waitlist-selection.state';

function createRow(
  id: string,
  approvalEligible: boolean,
  stage: 'new' | 'invited' | 'approved' | 'converted' = 'new',
): WaitlistListRow {
  return {
    id,
    email: `${id}@example.com`,
    source: 'landing',
    createdAt: '2026-03-01T00:00:00.000Z',
    notifiedAt: stage === 'invited' ? '2026-03-02T00:00:00.000Z' : null,
    approvedAt: stage === 'approved' ? '2026-03-03T00:00:00.000Z' : null,
    convertedAt: stage === 'converted' ? '2026-03-04T00:00:00.000Z' : null,
    stage,
    stageAt: '2026-03-01T00:00:00.000Z',
    approvalEligible,
  };
}

describe('WaitlistSelectionState', () => {
  let state: WaitlistSelectionState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WaitlistSelectionState],
    });
    state = TestBed.inject(WaitlistSelectionState);
  });

  describe('toggleRow', () => {
    it('selects and deselects an eligible row', () => {
      const row = createRow('wl-1', true);
      expect(state.isSelected('wl-1')).toBe(false);

      state.toggleRow(row);
      expect(state.isSelected('wl-1')).toBe(true);
      expect(state.count()).toBe(1);

      state.toggleRow(row);
      expect(state.isSelected('wl-1')).toBe(false);
      expect(state.count()).toBe(0);
    });

    it('strictly ignores ineligible rows (approved or converted)', () => {
      const approvedRow = createRow('wl-app', false, 'approved');
      const convertedRow = createRow('wl-conv', false, 'converted');

      state.toggleRow(approvedRow);
      expect(state.isSelected('wl-app')).toBe(false);

      state.toggleRow(convertedRow);
      expect(state.isSelected('wl-conv')).toBe(false);
      expect(state.count()).toBe(0);
    });
  });

  describe('page selection & pageStatus', () => {
    const pageRows: WaitlistListRow[] = [
      createRow('wl-1', true, 'new'),
      createRow('wl-2', true, 'invited'),
      createRow('wl-3', false, 'approved'),
      createRow('wl-4', false, 'converted'),
    ];

    it('returns "none" when no eligible rows are selected', () => {
      expect(state.pageStatus(pageRows)).toBe('none');
    });

    it('returns "mixed" when some eligible rows are selected', () => {
      state.toggleRow(pageRows[0]);
      expect(state.pageStatus(pageRows)).toBe('mixed');
    });

    it('returns "all" when all eligible rows on the page are selected', () => {
      state.toggleRow(pageRows[0]);
      state.toggleRow(pageRows[1]);
      expect(state.pageStatus(pageRows)).toBe('all');
    });

    it('selects only eligible rows when selectPage is called', () => {
      state.selectPage(pageRows);
      expect(state.count()).toBe(2);
      expect(state.isSelected('wl-1')).toBe(true);
      expect(state.isSelected('wl-2')).toBe(true);
      expect(state.isSelected('wl-3')).toBe(false);
      expect(state.isSelected('wl-4')).toBe(false);
      expect(state.pageStatus(pageRows)).toBe('all');
    });

    it('deselects eligible rows when selectPage is called and all eligible rows were selected', () => {
      state.selectPage(pageRows);
      expect(state.pageStatus(pageRows)).toBe('all');

      state.selectPage(pageRows);
      expect(state.pageStatus(pageRows)).toBe('none');
      expect(state.count()).toBe(0);
    });

    it('preserves selection across pages', () => {
      const page1 = [createRow('wl-1', true)];
      const page2 = [createRow('wl-2', true)];

      state.selectPage(page1);
      expect(state.count()).toBe(1);

      state.selectPage(page2);
      expect(state.count()).toBe(2);
      expect(state.isSelected('wl-1')).toBe(true);
      expect(state.isSelected('wl-2')).toBe(true);
    });
  });

  describe('selectMatching & 50-of-N disclosure', () => {
    it('sets scope to matching, updates ids, and formats 50 of N disclosure', () => {
      const ids50 = Array.from({ length: 50 }, (_, i) => `wl-${i + 1}`);
      state.selectMatching({
        ids: ids50,
        selected: 50,
        eligibleMatching: 180,
        limit: 50,
        truncated: true,
      });

      expect(state.count()).toBe(50);
      expect(state.scope()).toBe('matching');
      expect(state.eligibleMatching()).toBe(180);
      expect(state.isTruncatedMatching()).toBe(true);
      expect(state.disclosureLabel()).toBe('50 selected of 180 matching');
    });

    it('does not format truncated disclosure when matching count equals selected count', () => {
      state.selectMatching({
        ids: ['wl-1', 'wl-2'],
        selected: 2,
        eligibleMatching: 2,
        limit: 50,
        truncated: false,
      });

      expect(state.disclosureLabel()).toBe('2 selected');
    });

    it('defensively slices an oversized matching response to 50 ids', () => {
      const ids = Array.from({ length: 51 }, (_, index) => `wl-${index + 1}`);

      state.selectMatching({
        ids,
        selected: 51,
        eligibleMatching: 51,
        limit: 50,
        truncated: false,
      });

      expect(state.count()).toBe(50);
      expect(state.isSelected('wl-50')).toBe(true);
      expect(state.isSelected('wl-51')).toBe(false);
    });
  });

  describe('clear', () => {
    it('clears all selected ids and resets scope to explicit', () => {
      state.toggleRow(createRow('wl-1', true));
      expect(state.count()).toBe(1);

      state.clear();
      expect(state.count()).toBe(0);
      expect(state.scope()).toBe('explicit');
      expect(state.eligibleMatching()).toBeNull();
      expect(state.disclosureLabel()).toBe('0 selected');
    });
  });

  describe('handleApprovalResult & partial retention', () => {
    it('removes approved, already_approved, and already_paid; retains failed and not_found', () => {
      state.toggleRow(createRow('wl-approved', true));
      state.toggleRow(createRow('wl-already-app', true));
      state.toggleRow(createRow('wl-already-paid', true));
      state.toggleRow(createRow('wl-failed', true));
      state.toggleRow(createRow('wl-not-found', true));
      expect(state.count()).toBe(5);

      const response: AdminApproveWaitlistResponse = {
        requested: 5,
        tally: {
          approved: 1,
          already_approved: 1,
          already_paid: 1,
          not_found: 1,
          failed: 1,
        },
        results: [
          {
            id: 'wl-approved',
            email: 'a@ex.com',
            outcome: 'approved',
            licenseId: 'lic-1',
          },
          {
            id: 'wl-already-app',
            email: 'b@ex.com',
            outcome: 'already_approved',
          },
          { id: 'wl-already-paid', email: 'c@ex.com', outcome: 'already_paid' },
          {
            id: 'wl-failed',
            email: 'd@ex.com',
            outcome: 'failed',
            error: { code: 'GRANT_FAILED' },
          },
          { id: 'wl-not-found', email: null, outcome: 'not_found' },
        ],
      };

      state.handleApprovalResult(response);

      expect(state.count()).toBe(2);
      expect(state.isSelected('wl-approved')).toBe(false);
      expect(state.isSelected('wl-already-app')).toBe(false);
      expect(state.isSelected('wl-already-paid')).toBe(false);
      expect(state.isSelected('wl-failed')).toBe(true);
      expect(state.isSelected('wl-not-found')).toBe(true);
    });
  });

  describe('handleTransportFailure', () => {
    it('preserves selection intact on transport error (no-op)', () => {
      state.toggleRow(createRow('wl-1', true));
      state.toggleRow(createRow('wl-2', true));
      expect(state.count()).toBe(2);

      state.handleTransportFailure();

      expect(state.count()).toBe(2);
      expect(state.isSelected('wl-1')).toBe(true);
      expect(state.isSelected('wl-2')).toBe(true);
    });
  });

  describe('50-row selection limit and limitReached signal', () => {
    it('refuses to add rows past 50 via toggleRow and signals limitReached', () => {
      for (let i = 1; i <= 50; i++) {
        state.toggleRow(createRow(`wl-${i}`, true));
      }

      expect(state.count()).toBe(50);
      expect(state.limitReached()).toBe(true);
      expect(state.selectionLimitReached()).toBe(true);

      // Attempt to add a 51st row
      state.toggleRow(createRow('wl-51', true));
      expect(state.count()).toBe(50);
      expect(state.isSelected('wl-51')).toBe(false);
      expect(state.limitReached()).toBe(true);

      // Deselecting one drops count to 49 and resets limitReached
      state.toggleRow(createRow('wl-50', true));
      expect(state.count()).toBe(49);
      expect(state.isSelected('wl-50')).toBe(false);
      expect(state.limitReached()).toBe(false);
    });

    it('caps selection at 50 rows when selectPage is called with >50 eligible rows', () => {
      const largePage: WaitlistListRow[] = [];
      for (let i = 1; i <= 60; i++) {
        largePage.push(createRow(`wl-${i}`, true));
      }

      state.selectPage(largePage);
      expect(state.count()).toBe(50);
      expect(state.limitReached()).toBe(true);
      expect(state.isSelected('wl-50')).toBe(true);
      expect(state.isSelected('wl-51')).toBe(false);
      expect(state.isSelected('wl-60')).toBe(false);
    });
  });
});
