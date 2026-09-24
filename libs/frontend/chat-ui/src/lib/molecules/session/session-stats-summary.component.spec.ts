import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ModelStateService } from '@ptah-extension/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
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
});
