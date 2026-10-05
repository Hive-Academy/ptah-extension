import { signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModelStateService } from '@ptah-extension/core';
import type {
  PlanLimitWindow,
  QuotaOwnerRef,
  SessionBudgetState,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { buildStatsLimitViewModel } from './plan-limits/stats-limit-view-model';
import type { StatsLimitViewModel } from './plan-limits/stats-limit-view-model.types';
import { StatsTileExpansionState } from './plan-limits/stats-tile-expansion.state';
import {
  SessionStatsSummaryComponent,
  type LiveModelStats,
} from './session-stats-summary.component';

/**
 * TASK_2026_533: the panel displays ONE backend snapshot. Every accounting
 * number (cost chip, tokens chip, agents chip, table rows, table totals) comes
 * from it; nothing is derived from messages, execution trees or row sums.
 */

type ModelRow = NonNullable<SessionStatsEntry['modelUsageList']>[number];

/** Two models whose rows add up to the snapshot totals below. */
const OPUS_ROW: ModelRow = {
  model: 'claude-opus-4-7',
  inputTokens: 15_000,
  outputTokens: 396_000,
  cacheRead: 14_000_000,
  cacheCreation: 90_000,
  costUSD: 38,
};
const HAIKU_ROW: ModelRow = {
  model: 'claude-haiku-4-5',
  inputTokens: 200,
  outputTokens: 700,
  cacheRead: 388_100,
  cacheCreation: 10_000,
  costUSD: 0.18,
};

/** The reported session. */
const SNAPSHOT: SessionStatsEntry = {
  sessionId: 'session-1',
  model: 'claude-opus-4-7',
  totalCost: 38.18,
  knownCost: 38.18,
  tokens: {
    input: 15_200,
    output: 396_700,
    cacheRead: 14_388_100,
    cacheCreation: 100_000,
  },
  tokenCount: 14_900_000,
  messageCount: 0,
  agentSessionCount: 9,
  modelUsageList: [OPUS_ROW, HAIKU_ROW],
  status: 'ok',
  pricingCoverage: 'full',
  scope: 'session',
  revision: 4,
};

const LIVE: LiveModelStats = {
  contextKnown: true,
  contextCapacity: {
    tokens: 200_000,
    source: 'sdk-native',
    providerId: null,
    model: 'claude-opus-4-7',
  },
  model: 'claude-opus-4-7',
  contextUsed: 50_000,
  contextWindow: 200_000,
  contextPercent: 25,
};

describe('SessionStatsSummaryComponent', () => {
  let fixture: ComponentFixture<SessionStatsSummaryComponent>;

  function render(
    snapshot: SessionStatsEntry | null,
    live: LiveModelStats | null = null,
  ): HTMLElement {
    TestBed.configureTestingModule({
      imports: [SessionStatsSummaryComponent],
      providers: [
        {
          provide: ModelStateService,
          useValue: {
            availableModels: signal([
              { id: 'claude-opus-4-7', name: 'Opus 4.7' },
              { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
            ]),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SessionStatsSummaryComponent);
    fixture.componentRef.setInput('snapshot', snapshot);
    fixture.componentRef.setInput('liveModelStats', live);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function text(root: HTMLElement, testId: string): string {
    return (
      root.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''
    ).trim();
  }

  function required(root: ParentNode, selector: string): Element {
    const found = root.querySelector(selector);
    if (!found) throw new Error(`No element for ${selector}`);
    return found;
  }

  function click(root: HTMLElement, selector: string): void {
    const button = root.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`No element for ${selector}`);
    button.click();
    fixture.detectChanges();
  }

  function tableText(root: HTMLElement): {
    headers: string[];
    rows: string[][];
    total: string[];
  } {
    const table = required(root, '[data-testid="model-usage-table"]');
    const cells = (row: Element): string[] =>
      Array.from(
        row.querySelectorAll('[role="cell"],[role="columnheader"]'),
      ).map((cell) => (cell.textContent ?? '').trim());
    return {
      headers: cells(required(table, '[data-testid="model-usage-header"]')),
      rows: Array.from(
        table.querySelectorAll('[data-testid="model-usage-row"]'),
      ).map(cells),
      total: cells(required(table, '[data-testid="model-usage-total"]')),
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it.each([
    { contextKnown: false },
    { contextCapacity: undefined },
    {
      contextCapacity: {
        tokens: null,
        source: 'unknown' as const,
        providerId: 'openai-codex',
        model: LIVE.model,
      },
    },
  ])(
    'renders unknown main context as an em dash without changing tree totals: %j',
    (unknown) => {
      const root = render(SNAPSHOT, {
        ...LIVE,
        contextKnown: true,
        contextCapacity: {
          tokens: 200_000,
          source: 'provider-catalog',
          providerId: 'openai-codex',
          model: LIVE.model,
        },
        ...unknown,
      });
      expect(text(root, 'stats-context')).toBe('\u2014');
      expect(root.querySelector('.context-bar-track')).toBeNull();
      click(root, '[data-testid="stats-expand"]');
      expect(text(root, 'stats-context')).toBe('\u2014');
      const card = required(
        root,
        '[data-testid="stats-context"]',
      ).parentElement;
      expect(card?.textContent).not.toContain('(0)');
      expect(card?.textContent).not.toContain('(50.0k)');
      expect(root.textContent).toContain('Context');
      expect(root.textContent).not.toContain('Main context');
      expect(text(root, 'stats-cost')).toBe('$38.18');
      expect(text(root, 'stats-tokens')).toBe('14.9M');
      expect(fixture.componentInstance.snapshot()).toBe(SNAPSHOT);
    },
  );

  it('displays one backend snapshot in both layouts without message-derived totals', () => {
    const root = render(SNAPSHOT, LIVE);

    // Collapsed bar chips — all from the snapshot.
    expect(text(root, 'stats-tokens')).toBe('14.9M');
    expect(text(root, 'stats-cost')).toBe('$38.18');
    expect(text(root, 'stats-agents')).toBe('9');
    // The context badge stays the independent live input.
    expect(text(root, 'stats-context')).toBe('25%');

    const expectedHeaders = [
      'Model',
      'In',
      'Out',
      'Cache Read',
      'Cache Creation',
      'Cost',
    ];
    const expectedTotal = [
      'Total',
      '15.2k',
      '396.7k',
      '14.4M',
      '100.0k',
      '$38.18',
    ];

    // Collapsed layout table.
    click(root, '[data-testid="stats-models-toggle"]');
    const collapsed = tableText(root);
    expect(collapsed.headers).toEqual(expectedHeaders);
    expect(collapsed.rows).toEqual([
      ['Opus 4.7', '15.0k', '396.0k', '14.0M', '90.0k', '$38.00'],
      ['Haiku 4.5', '200', '700', '388.1k', '10.0k', '$0.18'],
    ]);
    expect(collapsed.total).toEqual(expectedTotal);

    // Expanded layout: same chips, same table.
    click(root, '[data-testid="stats-expand"]');
    expect(text(root, 'stats-tokens')).toBe('14.9M');
    expect(text(root, 'stats-cost')).toBe('$38.18');
    expect(text(root, 'stats-agents')).toBe('9');
    const expanded = tableText(root);
    expect(expanded.headers).toEqual(expectedHeaders);
    expect(expanded.rows).toEqual(collapsed.rows);
    expect(expanded.total).toEqual(expectedTotal);
  });

  it('reads table totals from the snapshot even when the rows do not add up to it', () => {
    // A partial row attribution (coverage 'partial'): the rows cover less than
    // the session. The footer must still show the backend totals.
    const root = render({
      ...SNAPSHOT,
      coverage: 'partial',
      modelUsageList: [
        { ...OPUS_ROW, inputTokens: 1, costUSD: 1 },
        { ...HAIKU_ROW, inputTokens: 1, costUSD: 1 },
      ],
    });
    click(root, '[data-testid="stats-models-toggle"]');

    expect(tableText(root).total).toEqual([
      'Total',
      '15.2k',
      '396.7k',
      '14.4M',
      '100.0k',
      '$38.18',
    ]);
  });

  it('shows "cost unavailable" for a null total and never a row sum', () => {
    const root = render({
      ...SNAPSHOT,
      totalCost: null,
      knownCost: null,
      pricingCoverage: 'none',
    });

    expect(text(root, 'stats-cost')).toBe('cost unavailable');
    expect(
      root.querySelector('[data-testid="stats-known-subtotal"]'),
    ).toBeNull();
    click(root, '[data-testid="stats-models-toggle"]');
    expect(tableText(root).total[5]).toBe('—');
  });

  it('shows a known zero as $0.0000', () => {
    const root = render({ ...SNAPSHOT, totalCost: 0, knownCost: 0 });

    expect(text(root, 'stats-cost')).toBe('$0.0000');
  });

  it('labels a partial-pricing subtotal explicitly and keeps the total unavailable', () => {
    const root = render({
      ...SNAPSHOT,
      totalCost: null,
      knownCost: 2,
      pricingCoverage: 'partial',
    });

    expect(text(root, 'stats-cost')).toBe('cost unavailable');
    expect(text(root, 'stats-known-subtotal')).toBe('known subtotal $2.00');
  });

  it('renders the unavailable state for an absent snapshot, never zeros', () => {
    const root = render(null, LIVE);

    expect(text(root, 'stats-tokens')).toBe('—');
    expect(text(root, 'stats-cost')).toBe('cost unavailable');
    expect(root.querySelector('[data-testid="stats-agents"]')).toBeNull();
    expect(root.querySelector('[data-testid="stats-duration"]')).toBeNull();
    expect(
      root.querySelector('[data-testid="stats-models-toggle"]'),
    ).toBeNull();
  });

  it('renders an absent optional aggregate as unavailable, with no fallback arithmetic', () => {
    // An older producer: four token classes but no tokenCount / agent count.
    const { tokenCount, agentSessionCount, ...older } = SNAPSHOT;
    void tokenCount;
    void agentSessionCount;
    const root = render(older);

    expect(text(root, 'stats-tokens')).toBe('—');
    expect(root.querySelector('[data-testid="stats-agents"]')).toBeNull();
  });

  it('shows the backend duration only when the snapshot carries one', () => {
    expect(
      render(SNAPSHOT).querySelector('[data-testid="stats-duration"]'),
    ).toBeNull();
    TestBed.resetTestingModule();

    // A resumed session's backend duration is `null` (unknown): still hidden.
    expect(
      render({ ...SNAPSHOT, durationMs: null }).querySelector(
        '[data-testid="stats-duration"]',
      ),
    ).toBeNull();
    TestBed.resetTestingModule();

    const root = render({ ...SNAPSHOT, durationMs: 125_000 });
    expect(text(root, 'stats-duration')).toBe('2m 5s');
    click(root, '[data-testid="stats-expand"]');
    expect(text(root, 'stats-duration')).toBe('2m 5s');
  });

  describe('session budget (TASK_2026_597 N7)', () => {
    const BUDGET: SessionBudgetState = {
      sessionId: 'session-1',
      stage: 'normal',
      unit: 'tokens',
      measure: 'tokens',
      used: 14_900_000,
      limit: 50_000_000,
      percent: 29.8,
      lowerBound: false,
      revision: 4,
      compactions: 0,
      extensions: 0,
      blocked: false,
    };

    function renderWithBudget(
      snapshot: SessionStatsEntry | null,
      budget: SessionBudgetState | null,
    ): HTMLElement {
      const root = render(snapshot);
      fixture.componentRef.setInput('budget', budget);
      fixture.detectChanges();
      return root;
    }

    function tokensTitle(root: HTMLElement): string {
      return (
        root
          .querySelector('[data-testid="stats-tokens"]')
          ?.parentElement?.getAttribute('title') ?? ''
      );
    }

    it('changes nothing without a budget', () => {
      const root = renderWithBudget(SNAPSHOT, null);

      expect(text(root, 'stats-tokens')).toBe('14.9M');
      expect(text(root, 'stats-cost')).toBe('$38.18');
      expect(
        root.querySelector('[data-testid="stats-tokens-budget"]'),
      ).toBeNull();
      expect(root.querySelector('[data-testid="stats-cost-limit"]')).toBeNull();
      expect(
        root.querySelector('[data-testid="stats-cost-budget"]'),
      ).toBeNull();
      expect(tokensTitle(root)).not.toContain('Session budget');
      const costChip = root.querySelector('[data-testid="stats-cost"]')
        ?.parentElement as HTMLElement;
      expect(costChip.hasAttribute('title')).toBe(false);
    });

    it('tokens: keeps the snapshot numerator and adds the limit in both layouts', () => {
      // The budget's own `used` differs on purpose: the chip must not read it.
      const root = renderWithBudget(SNAPSHOT, { ...BUDGET, used: 1 });

      expect(text(root, 'stats-tokens')).toBe('14.9M');
      expect(text(root, 'stats-tokens-budget')).toBe('/ 50.0M');
      expect(tokensTitle(root)).toContain(
        'Session budget: 29% used (14.9M of 50.0M).',
      );
      expect(root.querySelector('[data-testid="stats-cost-limit"]')).toBeNull();

      click(root, '[data-testid="stats-expand"]');
      expect(text(root, 'stats-tokens')).toBe('14.9M');
      expect(text(root, 'stats-tokens-budget')).toBe('/ 50.0M');
    });

    it('cost: keeps the snapshot total and adds the dollar limit', () => {
      const root = renderWithBudget(SNAPSHOT, {
        ...BUDGET,
        unit: 'cost',
        measure: 'cost',
        used: 1,
        limit: 30,
      });

      expect(text(root, 'stats-cost')).toBe('$38.18');
      expect(text(root, 'stats-cost-limit')).toBe('/ $30');
      expect(
        root.querySelector('[data-testid="stats-tokens-budget"]'),
      ).toBeNull();
    });

    it('cost-lower-bound: shows the budget lower bound against the limit', () => {
      const root = renderWithBudget(
        {
          ...SNAPSHOT,
          totalCost: null,
          knownCost: 8.96,
          pricingCoverage: 'partial',
        },
        {
          ...BUDGET,
          unit: 'cost',
          measure: 'cost-lower-bound',
          used: 8.96,
          limit: 30,
          lowerBound: true,
        },
      );

      expect(text(root, 'stats-cost-budget')).toBe(
        '≥ $8.96 / $30 (some models have no price)',
      );
      expect(root.querySelector('[data-testid="stats-cost"]')).toBeNull();
      expect(
        root.querySelector('[data-testid="stats-known-subtotal"]'),
      ).toBeNull();
      click(root, '[data-testid="stats-expand"]');
      expect(text(root, 'stats-cost-budget')).toBe(
        '≥ $8.96 / $30 (some models have no price)',
      );
    });

    it('weighted-fallback: shows the weighted estimate against its own limit', () => {
      const root = renderWithBudget(
        {
          ...SNAPSHOT,
          totalCost: null,
          knownCost: null,
          pricingCoverage: 'none',
        },
        {
          ...BUDGET,
          unit: 'cost',
          measure: 'weighted-fallback',
          used: 6_200_000,
          limit: 9_000_000,
        },
      );

      expect(text(root, 'stats-cost-budget')).toBe(
        'est. 6.2M / 9.0M weighted tokens (no price for this model)',
      );
      expect(root.querySelector('[data-testid="stats-cost"]')).toBeNull();
    });
  });
});

/**
 * TASK_2026_596: plan-limit and lane tiles in the same card grid (design
 * §3.1-3.3, A1-A3). `limits` null keeps today's output.
 */
describe('SessionStatsSummaryComponent limits', () => {
  const NOW = Date.UTC(2026, 9, 5, 12, 0);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const UTC = { timeZone: 'UTC', zoneNameLocale: 'en-GB' } as const;
  const OWNER: QuotaOwnerRef = {
    key: 'claude-cli#account:aaa',
    providerId: 'claude-cli',
    identityKind: 'account',
    label: 'Claude account',
  };
  const FIVE_HOUR_TILE = `plan:${OWNER.key}:five_hour`;

  function fiveHour(percent: number): PlanLimitWindow {
    return {
      key: 'five_hour',
      kind: 'five_hour',
      label: '5-hour',
      used: { kind: 'percent', percent },
      usedSource: 'provider-api',
      resetsAt: NOW + 3 * HOUR + 10 * MIN,
      resetSource: 'provider-api',
      lastResetAt: NOW - 2 * HOUR,
      observedAt: NOW - MIN,
    };
  }

  function limitsFor(percent: number, withLane = true): StatsLimitViewModel {
    return buildStatsLimitViewModel({
      sessionId: 'session-1',
      sessionOwnerKey: OWNER.key,
      sessionModelScope: 'sonnet',
      owners: [
        {
          owner: OWNER,
          status: 'available',
          windowSetEstablished: true,
          windows: [fiveHour(percent)],
          ownerEvidence: [],
        },
      ],
      laneRuns: withLane
        ? [
            {
              runId: 'run-1',
              cli: 'codex',
              cliLabel: 'Codex',
              role: 'review',
              model: 'gpt-5',
              modelScope: null,
              status: 'completed',
              restored: false,
              startedAt: NOW - HOUR,
              quotaOwner: OWNER,
              usageTotals: { inputTokens: 1000, outputTokens: 500 },
            },
          ]
        : [],
      now: NOW,
      time: UTC,
    });
  }

  let fixture: ComponentFixture<SessionStatsSummaryComponent>;

  function render(
    limits: StatsLimitViewModel | null,
    options: { sessionId?: string | null; providers?: Provider[] } = {},
  ): HTMLElement {
    TestBed.configureTestingModule({
      imports: [SessionStatsSummaryComponent],
      providers: [
        {
          provide: ModelStateService,
          useValue: {
            availableModels: signal([
              { id: 'claude-opus-4-7', name: 'Opus 4.7' },
              { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
            ]),
          },
        },
        ...(options.providers ?? []),
      ],
    });
    fixture = TestBed.createComponent(SessionStatsSummaryComponent);
    fixture.componentRef.setInput('snapshot', SNAPSHOT);
    fixture.componentRef.setInput('liveModelStats', LIVE);
    if (limits !== null) fixture.componentRef.setInput('limits', limits);
    if (options.sessionId !== undefined) {
      fixture.componentRef.setInput('sessionId', options.sessionId);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function click(root: HTMLElement, selector: string): void {
    const button = root.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`No element for ${selector}`);
    button.click();
    fixture.detectChanges();
  }

  function tileButton(root: HTMLElement, tileId: string): HTMLButtonElement {
    const found = root.querySelector<HTMLButtonElement>(
      `[data-tile-id="${tileId}"] > button`,
    );
    if (!found) throw new Error(`No tile ${tileId}`);
    return found;
  }

  /** Expanded-grid children as short names, in DOM order. */
  function gridOrder(root: HTMLElement): string[] {
    const grid = root.querySelector('.stats-cards');
    if (!grid) throw new Error('grid not expanded');
    return Array.from(grid.children).map((child) => {
      const tag = child.tagName.toLowerCase();
      if (tag.startsWith('ptah-')) return tag.replace('ptah-', '');
      const testId = child.getAttribute('data-testid');
      if (testId) return testId;
      return (child.firstElementChild?.textContent ?? '').trim();
    });
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders exactly the pre-limits output when limits is null (harness host)', () => {
    const withoutInput = render(null);
    const collapsedHtml = withoutInput.innerHTML;
    click(withoutInput, '[data-testid="stats-expand"]');
    const expandedOrder = gridOrder(withoutInput);
    TestBed.resetTestingModule();

    const explicitNull = render(null, { sessionId: null });
    fixture.componentRef.setInput('limits', null);
    fixture.detectChanges();

    expect(explicitNull.innerHTML).toBe(collapsedHtml);
    expect(explicitNull.querySelector('ptah-limits-alert')).toBeNull();
    expect(
      explicitNull.querySelector('[data-testid="stats-lanes"]'),
    ).toBeNull();
    expect(expandedOrder).toEqual([
      'Context',
      'Tokens',
      'Cost',
      'Agents',
      'stats-models-toggle',
      'stats-collapse',
    ]);
  });

  it('shows the limits alert as a status line above the chip strip (variant A)', () => {
    const root = render(limitsFor(94), { sessionId: 'session-1' });
    const alertHost = root.querySelector('ptah-limits-alert');
    const status = root.querySelector('[role="status"]');

    expect(status?.textContent?.replace(/\s+/g, ' ').trim()).toMatch(
      /^Limits Near · 5-hour 94% · resets today 15:10 UTC$/,
    );
    expect(alertHost?.closest('.overflow-x-auto')).toBeNull();
    expect(
      alertHost?.nextElementSibling?.querySelector('.overflow-x-auto'),
    ).not.toBeNull();
  });

  it('shows no alert when the session is not at or near the limit', () => {
    const root = render(limitsFor(40), { sessionId: 'session-1' });

    expect(root.querySelector('ptah-limits-alert')).toBeNull();
  });

  it('puts the LANES pill directly after Cost, titled as separate from totals', () => {
    const root = render(limitsFor(40), { sessionId: 'session-1' });
    const pill = root.querySelector('[data-testid="stats-lanes"]')
      ?.parentElement as HTMLElement;

    expect(pill.textContent?.replace(/\s+/g, '')).toBe('Lanes1');
    expect(pill.title).toBe(
      'Lane runs are counted separately from session totals',
    );
    // The pill's face is just the count, so its accessible name states it.
    // aria-label alone is ignored on a generic span (ARIA 1.2 names no
    // generic element), so the pill carries a nameable role (review M3).
    expect(pill.getAttribute('role')).toBe('img');
    expect(pill.getAttribute('aria-label')).toBe(
      '1 lane run, not in session totals',
    );
    expect(
      pill.previousElementSibling?.querySelector('[data-testid="stats-cost"]'),
    ).not.toBeNull();
    // Lane usage never enters the session totals (Req 8).
    expect(
      root.querySelector('[data-testid="stats-tokens"]')?.textContent?.trim(),
    ).toBe('14.9M');
    expect(
      root.querySelector('[data-testid="stats-cost"]')?.textContent?.trim(),
    ).toBe('$38.18');
  });

  it('appends plan, lane and subtotal tiles after the session cards in DOM order', () => {
    const root = render(limitsFor(40), { sessionId: 'session-1' });
    click(root, '[data-testid="stats-expand"]');
    const grid = root.querySelector('.stats-cards') as HTMLElement;

    expect(gridOrder(root)).toEqual([
      'Context',
      'Tokens',
      'Cost',
      'Agents',
      'stats-models-toggle',
      'plan-limit-tile',
      'lane-usage-tile',
      'lane-subtotal-tile',
      'stats-collapse',
    ]);
    expect(grid.className).not.toContain('dense');
    expect(grid.getAttribute('style') ?? '').not.toContain('dense');
    // Every tile starts closed.
    for (const button of Array.from(grid.querySelectorAll('[aria-expanded]'))) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('toggles a tile open and closed', () => {
    const root = render(limitsFor(40), { sessionId: 'session-1' });
    click(root, '[data-testid="stats-expand"]');

    click(root, `[data-tile-id="${FIVE_HOUR_TILE}"] > button`);
    expect(tileButton(root, FIVE_HOUR_TILE).getAttribute('aria-expanded')).toBe(
      'true',
    );

    click(root, `[data-tile-id="${FIVE_HOUR_TILE}"] > button`);
    expect(tileButton(root, FIVE_HOUR_TILE).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('keeps an open tile open across a re-render and a limits push (F57)', () => {
    const root = render(limitsFor(40), { sessionId: 'session-1' });
    click(root, '[data-testid="stats-expand"]');
    click(root, `[data-tile-id="${FIVE_HOUR_TILE}"] > button`);
    click(root, '[data-testid="lane-usage-tile"]');

    // A push: a new view-model object with new usage for the same tiles.
    fixture.componentRef.setInput('limits', limitsFor(94));
    fixture.detectChanges();
    expect(tileButton(root, FIVE_HOUR_TILE).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(
      tileButton(root, 'lane:codex:review').getAttribute('aria-expanded'),
    ).toBe('true');

    // A collapse/expand re-render destroys and recreates every tile.
    click(root, '[data-testid="stats-collapse"]');
    click(root, '[data-testid="stats-expand"]');
    expect(tileButton(root, FIVE_HOUR_TILE).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('keys the open state by session: another session starts closed', () => {
    const root = render(limitsFor(40), { sessionId: 'session-1' });
    click(root, '[data-testid="stats-expand"]');
    click(root, `[data-tile-id="${FIVE_HOUR_TILE}"] > button`);

    fixture.componentRef.setInput('sessionId', 'session-2');
    fixture.detectChanges();
    expect(tileButton(root, FIVE_HOUR_TILE).getAttribute('aria-expanded')).toBe(
      'false',
    );

    fixture.componentRef.setInput('sessionId', 'session-1');
    fixture.detectChanges();
    expect(tileButton(root, FIVE_HOUR_TILE).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('uses the view-provided expansion state when one is provided', () => {
    const state = new StatsTileExpansionState();
    const root = render(limitsFor(40), {
      sessionId: 'session-1',
      providers: [{ provide: StatsTileExpansionState, useValue: state }],
    });
    click(root, '[data-testid="stats-expand"]');
    click(root, `[data-tile-id="${FIVE_HOUR_TILE}"] > button`);

    expect(state.isOpen('session-1', FIVE_HOUR_TILE)).toBe(true);

    // A choice made elsewhere in the same view is reflected here.
    state.setOpen('session-1', 'lane:codex:review', true);
    fixture.detectChanges();
    expect(
      tileButton(root, 'lane:codex:review').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  describe('failed refresh notice', () => {
    const failedLimits = (): StatsLimitViewModel => ({
      ...limitsFor(40),
      refreshNotice:
        'Refresh failed — showing last observed data (observed today 11:59 UTC)',
    });
    const notice = (root: HTMLElement) =>
      root.querySelector<HTMLElement>('[data-testid="limits-refresh-failed"]');

    it('shows a neutral status line beside the held data in both layouts', () => {
      const root = render(failedLimits(), { sessionId: 'session-1' });
      const line = notice(root);

      expect(line?.getAttribute('role')).toBe('status');
      expect(line?.textContent?.trim()).toBe(
        'Refresh failed — showing last observed data (observed today 11:59 UTC)',
      );
      expect(line?.className).toContain('text-base-content-muted');
      expect(line?.className).toContain('border-info');
      expect(line?.className).not.toMatch(/text-(error|warning)/);

      click(root, '[data-testid="stats-expand"]');
      expect(notice(root)).not.toBeNull();
      expect(
        root.querySelector(`[data-tile-id="${FIVE_HOUR_TILE}"]`),
      ).not.toBeNull();
    });

    it('hides the line once the next read succeeds', () => {
      const root = render(failedLimits(), { sessionId: 'session-1' });
      fixture.componentRef.setInput('limits', limitsFor(40));
      fixture.detectChanges();

      expect(notice(root)).toBeNull();
    });

    it('shows no line when no limit data is held', () => {
      expect(notice(render(null))).toBeNull();
    });
  });

  it('keeps the "Context" label', () => {
    const root = render(limitsFor(40), { sessionId: 'session-1' });

    expect(root.textContent).toContain('Context');
    expect(root.textContent).not.toContain('Main context');
  });
});
