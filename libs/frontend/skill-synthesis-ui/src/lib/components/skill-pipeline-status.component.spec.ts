/**
 * SkillPipelineStatusComponent — P0-7 part (b).
 *
 * Locks the Activity header's two new bands:
 *
 *  - **Drain runs.** N runs in state render exactly N
 *    `[data-testid="skills-drain-run"]` nodes, each carrying a status word and
 *    a duration. Before this the only signal was a rate-limit chip, which said
 *    nothing at all when the cron tier never fired.
 *  - **Per-stage cost (R3).** Archaeology cost scales with session count, so
 *    the strip must attribute cost to the stage that spent it before anyone
 *    tunes the tiers.
 *
 * B0.8 made the cost figure a MEASUREMENT instead of a proxy, and the tests
 * below exist to keep the two figures from being conflated again:
 *
 *  - **Tokens** come from `stageSpend`, the `(UTC day, stage)` ledger. They are
 *    the day's real bill. A stage can appear with tokens and NO rows, and `''`
 *    is the real bucket for spend no queue stage owned — dropping either would
 *    make the strip total less than the daily cap is counting.
 *  - **Dispatches** stay, and stay separately labelled. They are summed over
 *    the rows currently queued, a different window answering a different
 *    question (which stage is retrying).
 *
 * The bar scales on tokens whenever the day has any and falls back to
 * dispatches otherwise; both directions are asserted, because a fallback that
 * silently won would relabel the proxy as a measurement all over again.
 *
 * `now` is pinned so the relative labels are assertable rather than
 * wall-clock-dependent.
 */
import { TestBed } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import type {
  EligibilityHistogramDto,
  SkillSynthesisDrainRun,
  SkillSynthesisEventWire,
  SkillSynthesisQueueItem,
  SkillSynthesisQueueStage,
  SkillSynthesisQueueStatus,
  SkillSynthesisStageSpend,
} from '@ptah-extension/shared';

import { SkillPipelineStatusComponent } from './skill-pipeline-status.component';

const NOW = 1_700_000_000_000;

function run(
  overrides: Partial<SkillSynthesisDrainRun> = {},
): SkillSynthesisDrainRun {
  return {
    id: 'run-1',
    jobId: '@ptah/skills-drain-frequent',
    tier: 'frequent',
    scheduledFor: NOW - 60_000,
    startedAt: NOW - 60_000,
    endedAt: NOW - 58_000,
    status: 'succeeded',
    durationMs: 2_000,
    summary: null,
    ...overrides,
  };
}

function item(
  stage: SkillSynthesisQueueStage,
  overrides: Partial<SkillSynthesisQueueItem> = {},
): SkillSynthesisQueueItem {
  return {
    id: 'q-' + stage + '-' + (overrides.id ?? '1'),
    sessionId: 'sess-1',
    workspaceRoot: '/w',
    stage,
    status: 'queued' as SkillSynthesisQueueStatus,
    attemptCount: 1,
    enqueuedAt: NOW - 10_000,
    notBefore: 0,
    finishedAt: null,
    lane: null,
    reason: null,
    candidateId: null,
    ...overrides,
  };
}

/** One `(UTC day, stage)` ledger entry as `skillSynthesis:queue` returns it. */
function spend(
  stage: SkillSynthesisStageSpend['stage'],
  totalTokens: number,
  costUsd = 0,
): SkillSynthesisStageSpend {
  return {
    stage,
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
    costUsd,
  };
}

@Component({
  selector: 'ptah-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillPipelineStatusComponent],
  template: `<ptah-skill-pipeline-status
    [lastAnalyzeRunAt]="lastAnalyzeRunAt()"
    [histogram]="histogram()"
    [recentEvents]="recentEvents()"
    [drainRuns]="drainRuns()"
    [queueItems]="queueItems()"
    [stageSpend]="stageSpend()"
    [now]="now()"
  />`,
})
class HostComponent {
  public readonly lastAnalyzeRunAt = signal<number | null>(null);
  public readonly histogram = signal<EligibilityHistogramDto>({
    prefilterTooThin: 0,
    prefilterRejected: 0,
    accepted: 0,
  });
  public readonly recentEvents = signal<readonly SkillSynthesisEventWire[]>([]);
  public readonly drainRuns = signal<readonly SkillSynthesisDrainRun[]>([]);
  public readonly queueItems = signal<readonly SkillSynthesisQueueItem[]>([]);
  public readonly stageSpend = signal<readonly SkillSynthesisStageSpend[]>([]);
  public readonly now = signal<number | null>(NOW);
}

function mount() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    root: fixture.nativeElement as HTMLElement,
  };
}

function runNodes(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-testid="skills-drain-run"]'),
  );
}

function stageNodes(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-testid="skills-stage-cost"]'),
  );
}

/** Whitespace-collapsed text, so template line-wrapping cannot break a match. */
function text(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function tokensOf(node: HTMLElement): string {
  return text(node.querySelector('[data-testid="skills-stage-cost-tokens"]'));
}

describe('SkillPipelineStatusComponent — drain runs', () => {
  it('renders one node per run, each carrying status and duration', () => {
    const { fixture, host, root } = mount();
    host.drainRuns.set([
      run({
        id: 'r-1',
        tier: 'frequent',
        status: 'succeeded',
        durationMs: 900,
      }),
      run({ id: 'r-2', tier: 'nightly', status: 'failed', durationMs: 12_500 }),
      run({
        id: 'r-3',
        tier: 'weekly',
        status: 'skipped',
        durationMs: 125_000,
      }),
    ]);
    fixture.detectChanges();

    const nodes = runNodes(root);
    expect(nodes.length).toBe(3);

    const statuses = nodes.map((n) =>
      n
        .querySelector('[data-testid="skills-drain-run-status"]')
        ?.textContent?.trim(),
    );
    expect(statuses).toEqual(['succeeded', 'failed', 'skipped']);

    const durations = nodes.map((n) =>
      n
        .querySelector('[data-testid="skills-drain-run-duration"]')
        ?.textContent?.trim(),
    );
    expect(durations).toEqual(['900ms', '12.5s', '2m 5s']);

    expect(nodes[0].textContent).toContain('frequent');
    expect(nodes[1].textContent).toContain('nightly');
    expect(nodes[2].textContent).toContain('weekly');
  });

  it('renders exactly as many nodes as there are seeded runs', () => {
    const { fixture, host, root } = mount();
    for (const count of [1, 5, 12]) {
      host.drainRuns.set(
        Array.from({ length: count }, (_, i) => run({ id: 'r-' + i })),
      );
      fixture.detectChanges();
      expect(runNodes(root).length).toBe(count);
    }
  });

  it('says the drain has not run rather than rendering an empty list', () => {
    const { root } = mount();
    expect(runNodes(root).length).toBe(0);
    expect(
      root.querySelector('[data-testid="skills-drain-runs-empty"]')
        ?.textContent,
    ).toContain('The drain has not run yet.');
  });

  it('distinguishes an unfinished run from a zero-length one', () => {
    const { fixture, host, root } = mount();
    host.drainRuns.set([
      run({ id: 'r-live', status: 'running', endedAt: null, durationMs: null }),
      run({
        id: 'r-pending',
        status: 'pending',
        startedAt: null,
        endedAt: null,
        durationMs: null,
        scheduledFor: NOW + 30_000,
      }),
    ]);
    fixture.detectChanges();

    const durations = runNodes(root).map((n) =>
      n
        .querySelector('[data-testid="skills-drain-run-duration"]')
        ?.textContent?.trim(),
    );
    expect(durations).toEqual(['in progress', 'no duration']);
    // A slot in the future must not read as "never".
    expect(runNodes(root)[1].textContent).toContain('scheduled');
  });

  it('renders the drain summary when one is present and omits it otherwise', () => {
    const { fixture, host, root } = mount();
    host.drainRuns.set([
      run({ id: 'r-1', summary: 'drained 4 items, 1 skipped' }),
      run({ id: 'r-2', summary: null }),
    ]);
    fixture.detectChanges();

    const nodes = runNodes(root);
    expect(nodes[0].textContent).toContain('drained 4 items, 1 skipped');
    expect(nodes[1].textContent).not.toContain('drained');
  });

  it('keeps the pre-existing rate-limit chip alongside the run feed', () => {
    const { fixture, host, root } = mount();
    host.recentEvents.set([
      { kind: 'rate-limited', timestamp: NOW, sessionId: 'a' },
    ]);
    host.drainRuns.set([run()]);
    fixture.detectChanges();

    expect(
      root.querySelector('[data-testid="skills-pipeline-reason"]')?.textContent,
    ).toContain('rate-limited');
    expect(runNodes(root).length).toBe(1);
  });
});

describe('SkillPipelineStatusComponent — per-stage cost (R3)', () => {
  it('attributes dispatches to the stage that spent them, heaviest first', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([
      item('archaeology', { id: 'a1', attemptCount: 3 }),
      item('archaeology', { id: 'a2', attemptCount: 4 }),
      item('prefilter', { id: 'p1', attemptCount: 1 }),
      item('judge', { id: 'j1', attemptCount: 2 }),
    ]);
    fixture.detectChanges();

    const nodes = stageNodes(root);
    expect(nodes.length).toBe(3);

    const labels = nodes.map((n) =>
      n.querySelector('span')?.textContent?.trim(),
    );
    expect(labels).toEqual(['archaeology', 'judge', 'prefilter']);

    expect(nodes[0].textContent).toContain('7 dispatches');
    expect(nodes[0].textContent).toContain('2 queued');
    expect(nodes[1].textContent).toContain('2 dispatches');
    expect(nodes[2].textContent).toContain('1 dispatches');
  });

  it('shows the workspace-wide dispatch total beside the queued row count', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([
      item('archaeology', { id: 'a1', attemptCount: 3 }),
      item('synthesis', { id: 's1', attemptCount: 2 }),
    ]);
    fixture.detectChanges();

    expect(
      text(
        root.querySelector('[data-testid="skills-stage-cost-dispatch-total"]'),
      ),
    ).toBe('5 dispatches / 2 queued');
  });

  it('separates in-flight rows from failed ones', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([
      item('embedding', { id: 'e1', status: 'running', attemptCount: 1 }),
      item('embedding', { id: 'e2', status: 'claimed', attemptCount: 1 }),
      item('embedding', { id: 'e3', status: 'failed', attemptCount: 3 }),
      item('embedding', { id: 'e4', status: 'done', attemptCount: 1 }),
    ]);
    fixture.detectChanges();

    const [node] = stageNodes(root);
    expect(node.textContent).toContain('6 dispatches');
    expect(node.textContent).toContain('4 queued');
    expect(node.textContent).toContain('2 in flight');
    expect(node.textContent).toContain('1 failed');
  });

  it('scales each bar against the heaviest stage, not the total', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([
      item('archaeology', { id: 'a1', attemptCount: 10 }),
      item('judge', { id: 'j1', attemptCount: 5 }),
      item('digest', { id: 'd1', attemptCount: 1 }),
    ]);
    fixture.detectChanges();

    const widths = stageNodes(root).map(
      (n) => n.querySelector<HTMLElement>('div > div')?.style.width,
    );
    expect(widths).toEqual(['100%', '50%', '10%']);
  });

  it('renames hyphenated stage ids for display without losing the row', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([item('cluster-synthesis', { attemptCount: 1 })]);
    fixture.detectChanges();

    const [node] = stageNodes(root);
    expect(node.querySelector('span')?.textContent?.trim()).toBe(
      'cluster synthesis',
    );
  });

  it('says nothing is queued OR spent rather than rendering an empty strip', () => {
    // The empty state has to cover both halves now: an empty queue with a
    // non-empty ledger is a live state (the drain finished what it paid for),
    // so "nothing queued" alone would be a false statement of the other half.
    const { root } = mount();
    expect(stageNodes(root).length).toBe(0);
    expect(
      text(root.querySelector('[data-testid="skills-stage-cost-empty"]')),
    ).toBe('Nothing queued, and nothing spent today.');
  });

  it('survives a stage whose rows have never been dispatched', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([item('replay', { attemptCount: 0 })]);
    fixture.detectChanges();

    const [node] = stageNodes(root);
    expect(node.textContent).toContain('0 dispatches');
    expect(node.querySelector<HTMLElement>('div > div')?.style.width).toBe(
      '0%',
    );
  });
});

describe('SkillPipelineStatusComponent — per-stage tokens (R3, B0.8)', () => {
  it('renders the measured token spend beside the dispatch proxy', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([item('archaeology', { id: 'a1', attemptCount: 3 })]);
    host.stageSpend.set([spend('archaeology', 15_000, 0.18)]);
    fixture.detectChanges();

    const [node] = stageNodes(root);
    // Both figures, both labelled. They answer different questions and are a
    // different window — the dispatch count must never be relabelled "tokens".
    expect(tokensOf(node)).toBe('15000 tokens');
    expect(node.textContent).toContain('3 dispatches');
    expect(node.textContent).toContain('1 queued');
  });

  it('shows today s whole bill in the band header', () => {
    const { fixture, host, root } = mount();
    host.stageSpend.set([spend('judge', 400), spend('synthesis', 1_600)]);
    fixture.detectChanges();

    expect(
      text(
        root.querySelector('[data-testid="skills-stage-cost-tokens-total"]'),
      ),
    ).toBe('2000 tokens today');
  });

  it('reports zero tokens on a day nothing has spent', () => {
    // Honest, and different from hiding the figure: an empty ledger beside a
    // busy queue means the drain has not dispatched anything yet today.
    const { fixture, host, root } = mount();
    host.queueItems.set([item('prefilter', { attemptCount: 2 })]);
    fixture.detectChanges();

    expect(
      text(
        root.querySelector('[data-testid="skills-stage-cost-tokens-total"]'),
      ),
    ).toBe('0 tokens today');
    expect(tokensOf(stageNodes(root)[0])).toBe('0 tokens');
  });

  /**
   * The one thing the old dispatch-only strip could not say. Tokens are keyed
   * by `(day, stage)`, not by row, so a stage that spent and then finished has
   * no rows left — and it is exactly the stage a user tuning the tier cadence
   * needs to see.
   */
  it('renders a stage that spent today but has no rows left', () => {
    const { fixture, host, root } = mount();
    host.queueItems.set([item('prefilter', { attemptCount: 1 })]);
    host.stageSpend.set([spend('archaeology', 42_000)]);
    fixture.detectChanges();

    const nodes = stageNodes(root);
    expect(
      nodes.map((n) => n.querySelector('span')?.textContent?.trim()),
    ).toEqual(['archaeology', 'prefilter']);
    expect(nodes[0].textContent).toContain('0 queued');
    expect(tokensOf(nodes[0])).toBe('42000 tokens');
  });

  it('names the unattributed bucket rather than rendering a blank label', () => {
    // `''` is spend no queue stage owned — the foreground promotion gate's
    // judge call. It rides the wire so the strip totals to what the daily cap
    // counts, so it must also be legible.
    const { fixture, host, root } = mount();
    host.stageSpend.set([spend('', 900)]);
    fixture.detectChanges();

    const [node] = stageNodes(root);
    expect(node.querySelector('span')?.textContent?.trim()).toBe(
      'unattributed',
    );
    expect(tokensOf(node)).toBe('900 tokens');
  });

  it('orders and scales on tokens once the day has any', () => {
    const { fixture, host, root } = mount();
    // Dispatches would put `judge` first; tokens put `synthesis` first, and
    // tokens are the measurement.
    host.queueItems.set([
      item('judge', { id: 'j1', attemptCount: 9 }),
      item('synthesis', { id: 's1', attemptCount: 1 }),
    ]);
    host.stageSpend.set([spend('synthesis', 10_000), spend('judge', 2_500)]);
    fixture.detectChanges();

    const nodes = stageNodes(root);
    expect(
      nodes.map((n) => n.querySelector('span')?.textContent?.trim()),
    ).toEqual(['synthesis', 'judge']);
    expect(
      nodes.map((n) => n.querySelector<HTMLElement>('div > div')?.style.width),
    ).toEqual(['100%', '25%']);
  });

  it('falls back to scaling on dispatches when the day has spent nothing', () => {
    // A strip of flat zero bars would hide the retry signal, which is the only
    // thing left to see on a day with no spend.
    const { fixture, host, root } = mount();
    host.queueItems.set([
      item('archaeology', { id: 'a1', attemptCount: 10 }),
      item('judge', { id: 'j1', attemptCount: 5 }),
    ]);
    fixture.detectChanges();

    expect(
      stageNodes(root).map(
        (n) => n.querySelector<HTMLElement>('div > div')?.style.width,
      ),
    ).toEqual(['100%', '50%']);
  });

  it('sums the strip to the same figure the daily cap counts', () => {
    // The property the unattributed bucket exists for: per-stage entries must
    // add up to the day total, or the header reads as headroom nobody has.
    const { fixture, host, root } = mount();
    host.stageSpend.set([
      spend('archaeology', 12_000),
      spend('judge', 3_000),
      spend('', 500),
    ]);
    fixture.detectChanges();

    const perStage = stageNodes(root)
      .map((n) => Number(tokensOf(n).replace(' tokens', '')))
      .reduce((sum, n) => sum + n, 0);
    expect(perStage).toBe(15_500);
    expect(
      text(
        root.querySelector('[data-testid="skills-stage-cost-tokens-total"]'),
      ),
    ).toBe('15500 tokens today');
  });
});
