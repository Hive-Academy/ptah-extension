/**
 * UsageDashboardComponent, StackedBarChartComponent and AnalyticsUsageStore
 * — the Usage tab over a fake RPC client: the default 30-day mount request,
 * the rendered fold (total, provider shares, KPIs, breakdown, quality),
 * honest rendering of unpriced and partial data, range switching with a
 * stale-response guard, error/empty states, the cost/tokens chart toggle and
 * the chart's keyboard-accessible day columns.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  ModelStateService,
  RpcResult,
} from '@ptah-extension/core';
import type { UsageFact } from '@ptah-extension/shared';

import { UsageDashboardComponent } from './usage-dashboard.component';
import { StackedBarChartComponent } from './stacked-bar-chart.component';
import { AnalyticsUsageStore } from '../../services/analytics-usage.store';
import {
  FakeRpc,
  answerUsage,
  flush,
  usageFact,
  usageSummary,
} from '../../services/session-analytics-state.testing';

const factSonnetDay18: UsageFact = usageFact({
  inputUncachedTokens: 1000,
  cacheReadTokens: 500,
  cacheWriteTokens: 200,
  outputTokens: 300,
  costUsd: 2,
  cacheSavingsUsd: 1.5,
});
const factOpusDay19: UsageFact = usageFact({
  day: '2026-10-19',
  modelId: 'claude-opus-4-6',
  inputUncachedTokens: 100,
  outputTokens: 100,
  costUsd: 3,
  cacheSavingsUsd: 0.5,
});
const factQwenDay19: UsageFact = usageFact({
  day: '2026-10-19',
  providerId: 'opencode',
  modelId: 'qwen3-coder',
  sourceId: 'opencode-ledger',
  inputUncachedTokens: 700,
  outputTokens: 300,
  costUsd: null,
  costSource: 'unpriced',
});

describe('UsageDashboardComponent', () => {
  let rpc: FakeRpc;
  let fixture: ComponentFixture<UsageDashboardComponent>;

  beforeEach(() => {
    rpc = new FakeRpc();
    TestBed.configureTestingModule({
      imports: [UsageDashboardComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: signal({ path: '/ws/a' }) },
        },
        {
          provide: ModelStateService,
          useValue: {
            availableModels: signal([
              { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
            ]),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(UsageDashboardComponent);
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (testId: string): string | null =>
    el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
    null;
  const count = (selector: string): number =>
    el().querySelectorAll(selector).length;
  const usageCall = (i = 0) => rpc.of('analytics:spendSummary')[i]!;

  async function settle(): Promise<void> {
    await flush();
    fixture.detectChanges();
  }

  function clickButton(label: string): void {
    const button = Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    );
    (button as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  it('requests the default 30-day summary for the open workspace on mount', () => {
    expect(usageCall(0).params).toEqual({ range: 30, workspace: '/ws/a' });
    expect(
      el().querySelector('[aria-label="Loading usage"]'),
    ).not.toBeNull();
  });

  it('renders the folded summary: total, provider shares, KPIs, breakdown and quality', async () => {
    answerUsage(usageCall(0), usageSummary([
      factSonnetDay18,
      factOpusDay19,
      factQwenDay19,
    ]));
    await settle();

    expect(text('usage-date-span')).toBe('Oct 18 – Oct 20, 2026');
    // One fact is unpriced: the total is a known lower bound, never a
    // complete-looking total, and the tooltip names the unpriced facts.
    expect(text('usage-total-cost')).toBe('≥ $5.00');
    expect(
      el().querySelector('[data-testid="usage-total-cost"]')?.getAttribute(
        'data-tip',
      ),
    ).toBe('1 fact unpriced, 1K tokens');
    expect(el().textContent).not.toContain('$9.00');

    const rows = Array.from(
      el().querySelectorAll('[data-testid="usage-provider-row"]'),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-provider')).toBe('anthropic');
    expect(rows[0].textContent).toContain('$5.00');
    // The denominator is the known priced cost only — the label says so.
    expect(rows[0].textContent).toContain('100% of known cost');
    expect(rows[1].getAttribute('data-provider')).toBe('opencode');
    // Unpriced spend renders as an em dash, never as $0.
    expect(rows[1].textContent).toContain('—');
    expect(rows[1].textContent).not.toContain('$0');

    expect(text('usage-kpi-processed')).toContain('3.2K');
    // Mixed savings: the known sum renders as a lower bound, never zero.
    expect(text('usage-kpi-savings')).toContain('≥ $2.00');
    expect(text('usage-kpi-savings')).toContain('a lower bound');
    expect(
      el()
        .querySelector('[data-testid="usage-kpi-savings"]')
        ?.getAttribute('data-tip'),
    ).toBe('1 fact without savings data');
    expect(text('usage-quality-savings')).toContain('≥ $2.00');
    expect(text('usage-quality-unpriced')).toContain('31.3%');
    expect(text('usage-quality-reported')).toContain('68.8%');

    const modelRows = Array.from(
      el().querySelectorAll('[data-testid="usage-model-row"]'),
    );
    expect(modelRows).toHaveLength(3);
    expect(modelRows[0].textContent).toContain('Claude Opus 4.6');
    expect(modelRows[0].textContent).toContain('$3.00');
    expect(rows[0].querySelector('ptah-provider-mark')?.getAttribute('size')).toBe('sm');
    expect(el().querySelector('[data-testid="usage-donut-svg"]')?.getAttribute('aria-label'))
      .toContain('Unpriced usage excluded from arcs');
    expect(el().querySelectorAll('[data-testid="usage-donut-arc"]')).toHaveLength(1);
    expect(text('usage-cost-donut')).toContain('unpriced');
    clickButton('Model');
    expect(el().querySelectorAll('[data-testid="usage-donut-arc"]')).toHaveLength(2);
    expect(el().querySelector('[aria-label="Cost share view"] .btn-active')?.textContent).toContain('Model');
  });

  it('shows the savings multiple when cost and savings are both fully known', async () => {
    answerUsage(
      usageCall(0),
      usageSummary([
        { ...factSonnetDay18, cacheSavingsUsd: 1.5 },
        { ...factOpusDay19, cacheSavingsUsd: 0.5 },
        {
          ...factQwenDay19,
          costUsd: 1,
          costSource: 'model-priced',
          cacheSavingsUsd: 0.4,
        },
      ]),
    );
    await settle();

    // Every fact is priced and reports savings: 6 raw + 2.4 saved → 1.4x.
    expect(text('usage-total-cost')).toBe('$6.00');
    expect(text('usage-kpi-savings')).toContain('$2.40');
    expect(text('usage-kpi-savings')).toContain('Cost before cache savings: 1.4x raw cost');
  });

  it('marks the total partial and lists incomplete sources quietly', async () => {
    answerUsage(
      usageCall(0),
      usageSummary([factSonnetDay18], {
        sources: [
          {
            sourceId: 'claude-ledger',
            status: 'partial',
            reason: 'one malformed line',
          },
          {
            sourceId: 'antigravity',
            status: 'unavailable',
            reason: 'no dated history',
          },
        ],
      }),
    );
    await settle();

    expect(count('[data-testid="usage-partial-badge"]')).toBe(1);
    const notes = text('usage-source-notes') ?? '';
    expect(notes).toContain('Antigravity: no dated history');
    expect(notes).toContain('Claude Ledger: one malformed line');
    // An unavailable source is a quiet note, never an error.
    expect(el().querySelector('[data-testid="usage-error"]')).toBeNull();
  });

  it('switches the range, clears the old summary and renders the new window', async () => {
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await settle();
    expect(text('usage-total-cost')).toBe('$2.00');

    clickButton('7d');

    expect(rpc.of('analytics:spendSummary')).toHaveLength(2);
    expect(usageCall(1).params).toEqual({ range: 7, workspace: '/ws/a' });
    expect(usageCall(0).signal?.aborted).toBe(true);
    // The old 30-day answer is never shown under the 7-day selection: the
    // summary is cleared and the loading state owns the screen.
    expect(
      el().querySelector('[aria-label="Loading usage"]'),
    ).not.toBeNull();
    expect(el().querySelector('[data-testid="usage-total-cost"]')).toBeNull();

    answerUsage(usageCall(1), usageSummary([factSonnetDay18], { range: 7 }));
    await settle();

    expect(text('usage-date-span')).toBe('Oct 14 – Oct 20, 2026');
    expect(text('usage-total-cost')).toBe('$2.00');
  });

  it('shows an error and no old data when the new range fails', async () => {
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await settle();

    clickButton('7d');
    usageCall(1).reply.resolve(
      new RpcResult(
        false,
        undefined,
        'RPC timeout: analytics:spendSummary (token=SECRET)',
      ),
    );
    await settle();

    // A failed reload for a different range keeps no result of that range.
    expect(text('usage-error')).toContain('Could not load usage data.');
    expect(el().textContent).not.toContain('SECRET');
    expect(el().querySelector('[data-testid="usage-total-cost"]')).toBeNull();

    clickButton('Retry');
    expect(rpc.of('analytics:spendSummary')).toHaveLength(3);
  });

  it('keeps the last data but marks it updating during a refresh', async () => {
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await settle();

    clickButton('Refresh');

    // Same scope: the old summary stays visible, dimmed and labelled.
    expect(text('usage-total-cost')).toBe('$2.00');
    expect(text('usage-updating')).toContain('Updating usage');
    expect(
      el().querySelector('[data-testid="usage-content"]')?.classList,
    ).toContain('opacity-60');

    answerUsage(usageCall(1), usageSummary([factOpusDay19]));
    await settle();
    expect(el().querySelector('[data-testid="usage-updating"]')).toBeNull();
    expect(text('usage-total-cost')).toBe('$3.00');
  });

  it('keeps the last data with a note when a refresh fails', async () => {
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await settle();

    clickButton('Refresh');
    usageCall(1).reply.resolve(
      new RpcResult(false, undefined, 'transport reset: C:\\Users\\me\\secret'),
    );
    await settle();

    // Same scope, so the old summary stays — but no raw error text leaks.
    expect(text('usage-refresh-failed')).toContain(
      'Refresh failed; showing the last loaded data.',
    );
    expect(el().textContent).not.toContain('secret');
    expect(text('usage-total-cost')).toBe('$2.00');
  });

  it('shows an error with a retry when the load fails', async () => {
    usageCall(0).reply.resolve(
      new RpcResult(
        false,
        undefined,
        'RPC timeout: analytics:spendSummary (token=SECRET)',
      ),
    );
    await settle();

    // The UI shows the fixed message; the raw RPC detail never renders.
    expect(text('usage-error')).toContain('Could not load usage data.');
    expect(el().textContent).not.toContain('RPC timeout');
    expect(el().textContent).not.toContain('SECRET');

    clickButton('Retry');
    expect(rpc.of('analytics:spendSummary')).toHaveLength(2);
  });

  it('shows the empty state when the range has no usage', async () => {
    answerUsage(usageCall(0), usageSummary([]));
    await settle();

    expect(count('[data-testid="usage-empty"]')).toBe(1);
    expect(text('usage-empty')).toContain('No usage in this range');
    expect(count('[data-testid="usage-total-cost"]')).toBe(0);
  });

  it('toggles the daily chart between cost and tokens', async () => {
    answerUsage(usageCall(0), usageSummary([
      factSonnetDay18,
      factOpusDay19,
      factQwenDay19,
    ]));
    await settle();

    const firstDay = (): SVGElement =>
      el().querySelectorAll('svg rect[role="img"]')[0] as SVGElement;
    expect(firstDay().getAttribute('aria-label')).toContain('total $2');

    clickButton('Tokens');
    expect(firstDay().getAttribute('aria-label')).toContain('total 2K');
  });

  it('marks days with unpriced usage in cost mode only', async () => {
    answerUsage(usageCall(0), usageSummary([
      factSonnetDay18,
      factOpusDay19,
      factQwenDay19,
    ]));
    await settle();

    const day19 = (): SVGElement =>
      el().querySelectorAll('svg rect[role="img"]')[1] as SVGElement;
    // Day 19 has an unpriced fact: cost mode shows a lower bound, hatched.
    expect(day19().getAttribute('aria-label')).toBe(
      'Oct 19: at least $3; some usage unpriced',
    );
    expect(count('[data-testid="usage-chart-unknown-day"]')).toBe(1);
    expect(count('[data-testid="usage-chart-unknown-legend"]')).toBe(1);

    // The focused readout reads each provider honestly: the fully priced
    // provider keeps its exact value, and the unpriced provider never reads
    // as a plain "$0".
    day19().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    const costReadout = text('usage-chart-readout') ?? '';
    expect(costReadout).toContain('at least $3 (some usage unpriced)');
    expect(costReadout).toContain('Anthropic: $3');
    expect(costReadout).toContain('OpenCode: unpriced');
    expect(costReadout).not.toContain('OpenCode: $0');

    clickButton('Tokens');
    // Token counts are always known: no hatch, no lower-bound wording, and
    // the focused readout shows plain token values again.
    expect(day19().getAttribute('aria-label')).toBe(
      'Oct 19: total 1.2K; Anthropic: 200; OpenCode: 1K',
    );
    expect(count('[data-testid="usage-chart-unknown-day"]')).toBe(0);
    expect(count('[data-testid="usage-chart-unknown-legend"]')).toBe(0);
    const tokenReadout = text('usage-chart-readout') ?? '';
    expect(tokenReadout).toContain('OpenCode: 1K');
    expect(tokenReadout).not.toContain('unpriced');
  });

  it('labels breakdown shares as of known cost when some usage is unpriced', async () => {
    answerUsage(usageCall(0), usageSummary([
      factSonnetDay18,
      factOpusDay19,
      factQwenDay19,
    ]));
    await settle();

    // One unpriced fact: every share divides by the known priced cost
    // only, and the heading states that denominator in both views.
    const modelHeadings = Array.from(
      el().querySelectorAll('[data-testid="usage-breakdown-model"] th'),
    ).map((th) => th.textContent?.trim());
    expect(modelHeadings).toContain('Share of known cost');
    expect(
      el()
        .querySelector('[data-testid="usage-breakdown-model"] th[title]')
        ?.getAttribute('title'),
    ).toBe(
      'Some usage in this range is unpriced; shares are of the known priced cost only',
    );
    const modelRows = Array.from(
      el().querySelectorAll('[data-testid="usage-model-row"]'),
    ).map((row) => row.textContent ?? '');
    // The unpriced model keeps an em-dash share, and no priced model reads
    // as a full 100% of the window.
    expect(modelRows[2]).toContain('—');
    expect(modelRows.join(' ')).not.toContain('100%');

    clickButton('Day');

    const dayHeadings = Array.from(
      el().querySelectorAll('[data-testid="usage-breakdown-day"] th'),
    ).map((th) => th.textContent?.trim());
    expect(dayHeadings).toContain('Share of known cost');
    const dayRows = Array.from(
      el().querySelectorAll('[data-testid="usage-day-row"]'),
    ).map((row) => row.textContent ?? '');
    expect(dayRows.join(' ')).not.toContain('100%');
  });

  it('switches the breakdown table between the model and day views', async () => {
    answerUsage(usageCall(0), usageSummary([
      factSonnetDay18,
      factOpusDay19,
      factQwenDay19,
    ]));
    await settle();

    expect(count('[data-testid="usage-breakdown-model"]')).toBe(1);
    expect(count('[data-testid="usage-breakdown-day"]')).toBe(0);

    clickButton('Day');

    expect(count('[data-testid="usage-breakdown-model"]')).toBe(0);
    expect(count('[data-testid="usage-breakdown-day"]')).toBe(1);
    const dayRows = Array.from(
      el().querySelectorAll('[data-testid="usage-day-row"]'),
    );
    expect(dayRows).toHaveLength(3);
    expect(dayRows[1].textContent).toContain('Claude Opus 4.6');
    expect(dayRows[1].textContent).toContain('$3.00');
  });
});

describe('StackedBarChartComponent', () => {
  let fixture: ComponentFixture<StackedBarChartComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StackedBarChartComponent] });
    fixture = TestBed.createComponent(StackedBarChartComponent);
    fixture.componentRef.setInput('series', [
      { id: 'a', label: 'A', color: '#123456', values: [1, 2] },
      { id: 'b', label: 'B', color: '#654321', values: [3, 4] },
    ]);
    fixture.componentRef.setInput('days', ['2026-10-18', '2026-10-19']);
    fixture.componentRef.setInput('valueFormat', (value: number) => String(value));
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (testId: string): string | null =>
    el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
    null;
  const dayColumns = (): SVGElement[] =>
    Array.from(el().querySelectorAll('svg rect[role="img"]'));

  it('draws one stacked segment per provider per active day', () => {
    expect(count(el(), '[data-testid="usage-chart-bar"]')).toBe(4);
  });

  it('draws no segment on zero days between sparse active days', () => {
    fixture.componentRef.setInput('days', ['2026-10-18', '2026-10-19', '2026-10-20']);
    fixture.componentRef.setInput('series', [
      { id: 'a', label: 'A', color: '#123456', values: [2, 0, 3] },
      { id: 'b', label: 'B', color: '#654321', values: [0, 0, 1] },
    ]);
    fixture.detectChanges();
    expect(count(el(), '[data-testid="usage-chart-bar"]')).toBe(3);
    expect(dayColumns()[1].getAttribute('aria-label')).toBe('Oct 19: no usage');
  });

  it('uses nice gridline ceilings and thinned day labels', () => {
    const labels = Array.from(el().querySelectorAll('svg text')).map(
      (t) => t.textContent?.trim(),
    );
    // Max stack total is 6; a nice 2-unit step covers the scale.
    for (const expected of [
      '0',
      '2',
      '4',
      '6',
      '8',
      'Oct 18',
      'Oct 19',
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it('exposes every day as a focusable column with a full label', () => {
    const columns = dayColumns();
    expect(columns).toHaveLength(2);
    expect(columns[0].getAttribute('tabindex')).toBe('0');
    expect(columns[0].getAttribute('aria-label')).toBe(
      'Oct 18: total 4; A: 1; B: 3',
    );
    expect(columns[1].getAttribute('aria-label')).toBe(
      'Oct 19: total 6; A: 2; B: 4',
    );
  });

  it('moves the readout to the focused day', () => {
    fixture.componentInstance.setFocusedDay(1);
    fixture.detectChanges();

    const readout = text('usage-chart-readout') ?? '';
    expect(readout).toContain('Oct 19 — 6');
    expect(readout).toContain('A: 2');
    expect(readout).toContain('B: 4');
  });

  it('moves focus between day columns with the arrow keys', () => {
    const columns = dayColumns();
    columns[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    expect(document.activeElement?.id).toBe('usage-chart-col-1');

    // The (focus) listener mirrors the newly focused day in the readout.
    columns[1].dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(text('usage-chart-readout')).toContain('Oct 19 — 6');
  });

  it('renders the empty note when there are no days', () => {
    fixture.componentRef.setInput('series', []);
    fixture.componentRef.setInput('days', []);
    fixture.detectChanges();

    expect(text('usage-chart')).toContain('No usage in this range');
  });

  it('drops NaN and negative values instead of corrupting the chart', () => {
    fixture.componentRef.setInput('series', [
      { id: 'a', label: 'A', color: '#123456', values: [Number.NaN, 2] },
      { id: 'b', label: 'B', color: '#654321', values: [-5, 4] },
    ]);
    fixture.detectChanges();

    const columns = dayColumns();
    expect(columns[0].getAttribute('aria-label')).toBe('Oct 18: no usage');
    expect(columns[1].getAttribute('aria-label')).toBe(
      'Oct 19: total 6; A: 2; B: 4',
    );
    const labels = Array.from(el().querySelectorAll('svg text')).map(
      (t) => t.textContent ?? '',
    );
    expect(labels.join(' ')).not.toContain('NaN');
    expect(labels.join(' ')).not.toContain('Infinity');
    expect(count(el(), '[data-testid="usage-chart-bar"]')).toBe(2);
  });

  it('scales very large values without invalid geometry or labels', () => {
    fixture.componentRef.setInput('series', [
      { id: 'a', label: 'A', color: '#123456', values: [1e12, 2e12] },
    ]);
    fixture.detectChanges();

    expect(count(el(), '[data-testid="usage-chart-bar"]')).toBe(2);
    const labels = Array.from(el().querySelectorAll('svg text')).map(
      (t) => t.textContent ?? '',
    );
    expect(labels.join(' ')).not.toContain('NaN');
    expect(labels.join(' ')).not.toContain('Infinity');
    // The top gridline still labels the full 2e12 ceiling.
    expect(labels.join(' ')).toContain('2000000000000');
  });

  it('draws a centered bar, x label and focus marker for one day', () => {
    fixture.componentRef.setInput('series', [
      { id: 'a', label: 'A', color: '#123456', values: [3] },
      { id: 'b', label: 'B', color: '#654321', values: [2] },
    ]);
    fixture.componentRef.setInput('days', ['2026-10-18']);
    fixture.detectChanges();

    // The single day is a centered stacked bar.
    const bars = el().querySelectorAll(
      '[data-testid="usage-chart-bar"]',
    );
    expect(bars).toHaveLength(2);
    // PAD_L 48, PLOT_W 584: a 48px-wide bar centered on the plot.
    expect(bars[0].getAttribute('x')).toBe(String(48 + 584 / 2 - 24));

    fixture.componentInstance.setFocusedDay(0);
    fixture.detectChanges();
    const marker = el().querySelector('svg line.ptah-chart-marker');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('x1')).toBe(String(48 + 584 / 2));
    expect(text('usage-chart-readout')).toContain('Oct 18 — 5');
  });

  it('hatches unknown days and never reads them as zero usage', () => {
    fixture.componentRef.setInput('unknownDays', [false, true]);
    fixture.detectChanges();

    expect(count(el(), '[data-testid="usage-chart-unknown-day"]')).toBe(1);
    expect(count(el(), '[data-testid="usage-chart-unknown-legend"]')).toBe(1);
    const columns = dayColumns();
    expect(columns[1].getAttribute('aria-label')).toBe(
      'Oct 19: at least 6; some usage unpriced',
    );

    fixture.componentInstance.setFocusedDay(1);
    fixture.detectChanges();
    expect(text('usage-chart-readout')).toContain(
      'at least 6 (some usage unpriced)',
    );

    // A day with only unpriced usage never reads as zero either.
    fixture.componentRef.setInput('series', [
      { id: 'a', label: 'A', color: '#123456', values: [0, 1] },
    ]);
    fixture.componentRef.setInput('unknownDays', [true, false]);
    fixture.detectChanges();
    expect(dayColumns()[0].getAttribute('aria-label')).toBe(
      'Oct 18: unpriced usage, cost unknown',
    );
  });
});

function count(root: HTMLElement, selector: string): number {
  return root.querySelectorAll(selector).length;
}

describe('AnalyticsUsageStore', () => {
  let rpc: FakeRpc;
  let workspaceInfo: WritableSignal<{ path: string } | null>;

  beforeEach(() => {
    rpc = new FakeRpc();
    workspaceInfo = signal({ path: '/ws/a' });
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: { workspaceInfo } },
      ],
    });
  });

  const usageCall = (i = 0) => rpc.of('analytics:spendSummary')[i]!;

  it('sends the default range and the open workspace, and stores the summary', async () => {
    const store = TestBed.inject(AnalyticsUsageStore);
    const summary = usageSummary([factSonnetDay18]);

    const done = store.load();
    expect(usageCall(0).params).toEqual({ range: 30, workspace: '/ws/a' });
    answerUsage(usageCall(0), summary);
    await done;

    expect(store.summary()).toBe(summary);
    expect(store.isLoading()).toBe(false);
    expect(store.loadError()).toBeNull();
  });

  it('aborts a superseded range and ignores its late response', async () => {
    const store = TestBed.inject(AnalyticsUsageStore);
    const staleSummary = usageSummary([factSonnetDay18]);
    const freshSummary = usageSummary([factOpusDay19], { range: 7 });

    const stale = store.load(); // range 30, stays pending
    store.setRange(7); // aborts it and requests the new range

    expect(rpc.of('analytics:spendSummary')).toHaveLength(2);
    expect(usageCall(1).params).toEqual({ range: 7, workspace: '/ws/a' });
    expect(usageCall(0).signal?.aborted).toBe(true);

    answerUsage(usageCall(1), freshSummary);
    await flush();
    expect(store.summary()).toBe(freshSummary);

    // The late answer for the range the user left cannot overwrite it.
    answerUsage(usageCall(0), staleSummary);
    await flush();
    expect(store.summary()).toBe(freshSummary);

    await stale;
  });

  it('surfaces a failed load as a fixed user message, never the raw error', async () => {
    const store = TestBed.inject(AnalyticsUsageStore);

    const done = store.load();
    usageCall(0).reply.resolve(
      new RpcResult(
        false,
        undefined,
        'RPC timeout: analytics:spendSummary (token=SECRET)',
      ),
    );
    await done;

    expect(store.loadError()).toBe('Could not load usage data.');
    expect(store.summary()).toBeNull();
  });

  it('reports a failed load without logging to the console', async () => {
    // `console.*` is not allowed in libs: the failure path may surface the
    // fixed user message, but it must not log the raw error or workspace.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = TestBed.inject(AnalyticsUsageStore);

    try {
      const done = store.load();
      usageCall(0).reply.resolve(
        new RpcResult(
          false,
          undefined,
          'RPC timeout: analytics:spendSummary (token=SECRET)',
        ),
      );
      await done;

      expect(store.loadError()).toBe('Could not load usage data.');
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('clears the old summary while a new range is loading', async () => {
    const store = TestBed.inject(AnalyticsUsageStore);
    const done = store.load();
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await done;
    expect(store.summary()).not.toBeNull();

    store.setRange(7);
    // The 30-day answer is gone the moment the 7-day request starts.
    expect(store.summary()).toBeNull();
    expect(store.isLoading()).toBe(true);
    expect(store.isSummaryStale()).toBe(false);

    answerUsage(usageCall(1), usageSummary([factOpusDay19], { range: 7 }));
    await flush();
    expect(store.summary()).not.toBeNull();
  });

  it('clears the old summary while a new workspace is loading', async () => {
    const store = TestBed.inject(AnalyticsUsageStore);
    const done = store.load();
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await done;

    workspaceInfo.set({ path: '/ws/b' });
    const pending = store.load();
    void pending;
    expect(usageCall(1).params).toEqual({ range: 30, workspace: '/ws/b' });
    expect(store.summary()).toBeNull();

    answerUsage(usageCall(1), usageSummary([factOpusDay19]));
    await pending;
    expect(store.summary()).not.toBeNull();
  });

  it('keeps the old summary, marked stale, during a same-scope refresh', async () => {
    const store = TestBed.inject(AnalyticsUsageStore);
    const done = store.load();
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await done;

    store.refresh();
    expect(store.summary()).not.toBeNull();
    expect(store.isSummaryStale()).toBe(true);

    answerUsage(usageCall(1), usageSummary([factOpusDay19]));
    await flush();
    expect(store.isSummaryStale()).toBe(false);
  });

  it('omits the workspace parameter when no workspace is open', async () => {
    workspaceInfo.set(null);
    const store = TestBed.inject(AnalyticsUsageStore);

    const done = store.load();
    expect(usageCall(0).params).toEqual({ range: 30 });
    answerUsage(usageCall(0), usageSummary([]));
    await done;

    expect(store.summary()).not.toBeNull();
  });

  it('re-runs the same request on refresh', async () => {
    const store = TestBed.inject(AnalyticsUsageStore);
    const done = store.load();
    answerUsage(usageCall(0), usageSummary([factSonnetDay18]));
    await done;

    store.refresh();

    expect(rpc.of('analytics:spendSummary')).toHaveLength(2);
    expect(usageCall(1).params).toEqual({ range: 30, workspace: '/ws/a' });
  });
});
