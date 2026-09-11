/**
 * AnalyticsCardComponent — rendered states over the REAL state service with a
 * fake RPC client: progressive paint in the DOM, the session cap, the
 * current-rate-card estimate label, unknown cost, partial coverage, and
 * cancel-on-destroy.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  ModelStateService,
  RpcResult,
} from '@ptah-extension/core';

import { AnalyticsCardComponent } from './analytics-card.component';
import {
  analyticsTestDoubles,
  answerList,
  answerStats,
  flush,
  sessionId,
  sessions,
  type AnalyticsTestDoubles,
} from '../../services/session-analytics-state.testing';

describe('AnalyticsCardComponent', () => {
  let doubles: AnalyticsTestDoubles;
  let fixture: ComponentFixture<AnalyticsCardComponent>;

  beforeEach(() => {
    doubles = analyticsTestDoubles();
    TestBed.configureTestingModule({
      imports: [AnalyticsCardComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: doubles.rpc },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: doubles.workspaceInfo },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: doubles.availableModels },
        },
      ],
    });
    fixture = TestBed.createComponent(AnalyticsCardComponent);
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (testId: string): string | null =>
    el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
    null;
  const count = (selector: string): number =>
    el().querySelectorAll(selector).length;
  const listCall = (i = 0) => doubles.rpc.of('session:list')[i];
  const statsCall = (i: number) => doubles.rpc.of('session:stats-batch')[i];

  async function settle(): Promise<void> {
    await flush();
    fixture.detectChanges();
  }

  it('loads on mount and labels cost as a current-rate-card estimate', () => {
    expect(doubles.rpc.of('session:list')).toHaveLength(1);
    expect(text('analytics-estimate-label')).toBe(
      'Estimated from recorded usage and current rate card',
    );
    expect(el().textContent).not.toContain('Real costs');
  });

  it('renders the first page of cards before the last page arrives', async () => {
    answerList(listCall(), sessions(25));
    await settle();

    expect(count('ptah-session-stats-card')).toBe(25);
    expect(count('[data-testid="session-card-pending"]')).toBe(25);
    expect(text('analytics-progress')).toMatch(/0 of\s+25 sessions/);

    answerStats(statsCall(0));
    await settle();

    expect(count('[data-testid="session-card-pending"]')).toBe(5);
    expect(text('analytics-progress')).toMatch(/20 of\s+25 sessions/);
    expect(
      el().querySelectorAll('[data-testid="session-card-cost"]')[0].textContent,
    ).toContain('$0.50');

    answerStats(statsCall(1));
    await settle();

    expect(count('[data-testid="session-card-pending"]')).toBe(0);
    expect(text('analytics-progress')).toBeNull();
  });

  it('keeps the range selector mounted while a new range loads', async () => {
    answerList(listCall(), sessions(2));
    await settle();

    const oneDay = Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '1 day',
    );
    oneDay?.click();
    fixture.detectChanges();

    expect(doubles.rpc.of('session:list')).toHaveLength(2);
    expect(
      Array.from(el().querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === '1 day',
      ),
    ).toBe(true);
  });

  it('shows the 200-session cap', async () => {
    answerList(listCall(), sessions(200), true);
    await settle();

    expect(text('analytics-cap')).toMatch(/200 most recent sessions/);
  });

  it('shows an unknown cost as Unknown, never $0, and flags partial coverage', async () => {
    answerList(listCall(), sessions(2));
    await settle();
    answerStats(statsCall(0), (id) =>
      id === sessionId(0)
        ? { totalCost: null, pricingCoverage: 'none' }
        : { totalCost: null, pricingCoverage: 'none', untimestampedCount: 3, coverage: 'partial' },
    );
    await settle();

    const costs = Array.from(
      el().querySelectorAll('[data-testid="session-card-cost"]'),
    ).map((c) => c.textContent?.trim());
    expect(costs).toEqual(['Unknown', 'Unknown']);
    expect(text('metrics-total-cost')).toBe('Unknown');
    expect(el().textContent).not.toContain('$0.00');
    expect(text('analytics-unknown-cost')).toMatch(/Cost unknown for 2/);
    expect(text('analytics-partial')).toMatch(
      /Partial coverage in 1\s+session/,
    );
    expect(count('[data-testid="session-card-partial"]')).toBe(1);
  });

  it('shows failed sessions with a retry once the load settles', async () => {
    answerList(listCall(), sessions(1));
    await settle();
    statsCall(0).reply.resolve(
      new RpcResult(false, undefined, 'RPC timeout: session:stats-batch'),
    );
    await settle();

    expect(text('analytics-errors')).toMatch(/Stats unavailable for 1\s+session/);
    expect(
      el().querySelector('button[aria-label="Retry loading session stats"]'),
    ).not.toBeNull();
  });

  it('cancels the load in flight when destroyed', async () => {
    answerList(listCall(), sessions(25));
    await settle();
    const page = statsCall(0);

    fixture.destroy();

    expect(page.signal?.aborted).toBe(true);
  });
});
