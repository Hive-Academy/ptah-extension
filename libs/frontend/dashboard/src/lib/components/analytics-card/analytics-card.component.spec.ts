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

  describe('partially priced sessions (scope 6c)', () => {
    const cardCosts = (): (string | undefined)[] =>
      Array.from(el().querySelectorAll('[data-testid="session-card-cost"]')).map(
        (c) => c.textContent?.replace(/\s+/g, ' ').trim(),
      );

    it('renders the known spend of a partial session and adds it to the total', async () => {
      answerList(listCall(), sessions(3));
      await settle();
      answerStats(statsCall(0), (id) => {
        if (id === sessionId(0)) {
          return { totalCost: 2, knownCost: 2, pricingCoverage: 'full' };
        }
        if (id === sessionId(1)) {
          return { totalCost: null, knownCost: 3, pricingCoverage: 'partial' };
        }
        return { totalCost: null, knownCost: null, pricingCoverage: 'none' };
      });
      await settle();

      const costs = cardCosts();
      expect(costs[0]).toBe('$2.00');
      expect(costs[1]).toContain('$3.00');
      expect(costs[2]).toBe('Unknown');
      expect(text('metrics-total-cost')).toContain('$5.00');

      // R8: the lower bound is always labeled — on the partial card and the total.
      const cards = el().querySelectorAll('ptah-session-stats-card');
      const marker = (i: number) =>
        cards[i].querySelector('[data-testid="session-card-lower-bound"]');
      expect(marker(0)).toBeNull();
      expect(marker(1)?.textContent?.trim()).toBe('≥');
      expect(marker(2)).toBeNull();
      expect(costs[1]).toMatch(/At least \$3\.00/);
      expect(
        el().querySelector('[data-testid="metrics-total-lower-bound"]'),
      ).not.toBeNull();
      expect(text('metrics-total-cost')).toMatch(/At least \$5\.00/);
      expect(text('analytics-partial-pricing')).toMatch(
        /priced part is included[\s\S]*lower bound/,
      );
      expect(text('analytics-unknown-cost')).toMatch(/Cost unknown for 1\s+session/);
    });

    it('renders an unknown cost in a neutral colour, never the success colour', async () => {
      answerList(listCall(), sessions(2));
      await settle();
      answerStats(statsCall(0), (id) =>
        id === sessionId(0)
          ? { totalCost: 2, knownCost: 2, pricingCoverage: 'full' }
          : { totalCost: null, knownCost: null, pricingCoverage: 'none' },
      );
      await settle();

      const costEls = el().querySelectorAll('[data-testid="session-card-cost"]');
      expect(costEls[0].classList).toContain('text-success');
      expect(costEls[1].textContent?.trim()).toBe('Unknown');
      expect(costEls[1].classList).not.toContain('text-success');
      expect(costEls[1].classList).toContain('text-base-content-muted');
    });

    it('calls the total unknown, not a lower bound, when no session has a price', async () => {
      answerList(listCall(), sessions(2));
      await settle();
      answerStats(statsCall(0), () => ({
        totalCost: null,
        knownCost: null,
        pricingCoverage: 'none',
      }));
      await settle();

      expect(text('metrics-total-cost')).toBe('Unknown');
      const line = text('analytics-unknown-cost') ?? '';
      expect(line).toMatch(/Cost unknown for 2\s+sessions/);
      expect(line).toMatch(/the total is unknown/);
      expect(line).not.toMatch(/lower bound/);
    });

    it('calls the total a lower bound when priced sessions remain beside unpriced ones', async () => {
      answerList(listCall(), sessions(2));
      await settle();
      answerStats(statsCall(0), (id) =>
        id === sessionId(0)
          ? { totalCost: 2, knownCost: 2, pricingCoverage: 'full' }
          : { totalCost: null, knownCost: null, pricingCoverage: 'none' },
      );
      await settle();

      expect(text('analytics-unknown-cost')).toMatch(
        /the total leaves it out, so it is a\s+lower bound/,
      );
    });

    it('explains that CLI agent spend is not recorded or totalled', async () => {
      answerList(listCall(), sessions(2));
      await settle();
      answerStats(statsCall(0), (id) =>
        id === sessionId(0)
          ? { totalCost: 2, knownCost: 2, pricingCoverage: 'full', cliAgents: ['codex'] }
          : {
              status: 'empty',
              totalCost: null,
              knownCost: null,
              pricingCoverage: 'none',
              cliAgents: ['opencode'],
              tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
              messageCount: 0,
            },
      );
      await settle();

      expect(text('analytics-cli-agents')).toMatch(
        /CLI agent runs in 2\s+sessions record no cost and are not in the total/,
      );
      expect(text('metrics-total-cost')).toBe('$2.00');
    });

    it('shows no marker when every session in range is fully priced', async () => {
      answerList(listCall(), sessions(2));
      await settle();
      answerStats(statsCall(0), () => ({
        totalCost: 1.5,
        knownCost: 1.5,
        pricingCoverage: 'full',
      }));
      await settle();

      expect(text('metrics-total-cost')).toBe('$3.00');
      expect(count('[data-testid="metrics-total-lower-bound"]')).toBe(0);
      expect(count('[data-testid="session-card-lower-bound"]')).toBe(0);
      expect(text('analytics-partial-pricing')).toBeNull();
      expect(text('analytics-unknown-cost')).toBeNull();
      expect(text('analytics-cli-agents')).toBeNull();
    });

    it('never renders $0.00 for a CLI-lane-only session (A6)', async () => {
      answerList(listCall(), sessions(1));
      await settle();
      answerStats(statsCall(0), () => ({
        status: 'empty',
        totalCost: null,
        knownCost: null,
        pricingCoverage: 'none',
        cliAgents: ['codex'],
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        messageCount: 0,
      }));
      await settle();

      expect(cardCosts()).toEqual(['Unknown']);
      expect(text('metrics-total-cost')).toBe('Unknown');
      expect(el().textContent).not.toContain('$0.00');
      expect(
        el().querySelector('[data-testid="session-card-cost"]')?.classList,
      ).not.toContain('text-success');
    });
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
