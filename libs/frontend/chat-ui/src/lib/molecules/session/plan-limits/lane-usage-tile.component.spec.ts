import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { QuotaOwnerRef } from '@ptah-extension/shared';
import { LaneUsageTileComponent } from './lane-usage-tile.component';
import { buildStatsLimitViewModel } from './stats-limit-view-model';
import { LANE_ROW_GRID } from './stats-tile.styles';
import {
  LANE_CAPTION,
  type LaneSubgroupModel,
  type LaneUsageTileModel,
  type StatsLimitLaneRun,
} from './stats-limit-view-model.types';

const NOW = Date.UTC(2026, 9, 5, 12, 0);
const UTC = { timeZone: 'UTC', zoneNameLocale: 'en-GB' } as const;
const CLAUDE_A: QuotaOwnerRef = {
  key: 'claude-cli#account:aaaaaaaaaaaaaaaa',
  providerId: 'claude-cli',
  identityKind: 'account',
  label: 'Claude account',
};

const SAME_SUBGROUP: LaneSubgroupModel = {
  key: 'claude-cli#account:aaaaaaaaaaaaaaaa|sonnet',
  heading: 'sonnet',
  ownerStatus: 'same',
  ownerLabel: 'Same account',
  ownerText: 'Same account as this session · see plan tiles',
  state: 'near-limit',
  stateChip: { tone: 'warning', glyph: '▲', text: 'Near limit' },
  runs: [
    {
      runId: 'run-1',
      index: 1,
      model: 'sonnet',
      tokensText: '31.4k',
      costText: '$0.18',
      status: { tone: 'live', text: 'Running' },
      started: { short: '5 Oct 11:00', full: 'Mon 5 Oct 2026 11:00 UTC' },
    },
  ],
  columns: { model: true, tokens: true, cost: true, started: true },
  planTileChips: [
    {
      planTileId: 'plan:claude-cli#account:aaaaaaaaaaaaaaaa:five_hour',
      chip: { tone: 'warning', glyph: '▲', text: '5-hour · Near limit' },
    },
  ],
  windows: [],
  evidenceLines: [],
  notes: [
    {
      tone: 'info',
      text: 'Model scope unknown · model-scoped windows are not applied',
    },
  ],
  footnote:
    'Same account as this session · see plan tiles · Model scope unknown · model-scoped windows are not applied',
};

const DIFFERENT_SUBGROUP: LaneSubgroupModel = {
  ...SAME_SUBGROUP,
  key: 'openai-codex#cli-store:cccccccccccccccc|',
  heading: 'gpt-5',
  ownerStatus: 'different',
  ownerLabel: 'Different owner',
  ownerText: 'Different owner · Codex account · cccc',
  state: 'unknown',
  stateChip: { tone: 'neutral', text: 'Limit unavailable' },
  planTileChips: [],
  windows: [
    {
      windowKey: 'weekly',
      label: 'Weekly',
      state: 'aged',
      chip: { tone: 'neutral', glyph: '◷', text: 'Aged' },
      usedText: '12% used',
      percent: 12,
      resetFacts: ['Resets Fri 9 Oct 07:30 UTC · in 3d 19h'],
      note: 'observed 47m ago',
      sourceChips: ['Provider API'],
    },
  ],
  notes: [{ tone: 'neutral', text: 'aged value' }],
  footnote: 'Different owner · Codex account · cccc · aged value',
};

function laneTile(
  overrides: Partial<LaneUsageTileModel> = {},
): LaneUsageTileModel {
  return {
    id: 'lane:ptah-cli:docs',
    label: 'Claude · docs',
    caption: LANE_CAPTION,
    tokensText: '43.4k tokens',
    costLine: 'cost $0.32',
    tokensValue: '43.4k',
    costValue: '$0.32',
    summary: '43.4k tokens · cost $0.32 · Near limit · 1 of 2 runs (sonnet)',
    runChip: { tone: 'live', text: 'Live · 1 of 2 running' },
    runStatusText: 'Running',
    limitChips: [
      {
        chip: {
          tone: 'warning',
          glyph: '▲',
          text: 'Near limit · 1 of 2 runs (sonnet)',
        },
        sourceChips: ['Provider API'],
      },
    ],
    tone: 'warning',
    runCount: 2,
    subgroups: [SAME_SUBGROUP, DIFFERENT_SUBGROUP],
    ...overrides,
  };
}

function laneRun(overrides: Partial<StatsLimitLaneRun> = {}): StatsLimitLaneRun {
  return {
    runId: 'run-x',
    cli: 'codex',
    cliLabel: 'Codex',
    role: 'review',
    model: null,
    modelScope: null,
    status: 'completed',
    restored: true,
    startedAt: NOW - 3_600_000,
    quotaOwner: CLAUDE_A,
    usageTotals: null,
    ...overrides,
  };
}

function buildTile(runs: StatsLimitLaneRun[]): LaneUsageTileModel {
  return buildStatsLimitViewModel({
    sessionId: 'session-1',
    sessionOwnerKey: CLAUDE_A.key,
    sessionModelScope: null,
    owners: [],
    laneRuns: runs,
    now: NOW,
    time: UTC,
  }).laneTiles[0];
}

describe('LaneUsageTileComponent', () => {
  let fixture: ComponentFixture<LaneUsageTileComponent>;

  function render(tile: LaneUsageTileModel, open = false): HTMLElement {
    TestBed.configureTestingModule({ imports: [LaneUsageTileComponent] });
    fixture = TestBed.createComponent(LaneUsageTileComponent);
    fixture.componentRef.setInput('tile', tile);
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function face(root: HTMLElement): HTMLButtonElement {
    const found = root.querySelector<HTMLButtonElement>(
      '[data-testid="lane-usage-tile"]',
    );
    if (!found) throw new Error('no lane tile');
    return found;
  }

  function collapse(root: HTMLElement): HTMLElement {
    const found = root.querySelector<HTMLElement>(
      '[data-testid="lane-usage-collapse"]',
    );
    if (!found) throw new Error('no lane collapse');
    return found;
  }

  const all = (root: HTMLElement, testId: string): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));

  const text = (root: HTMLElement, testId: string): string =>
    (root.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  const headers = (table: Element): string[] =>
    Array.from(table.querySelectorAll('th')).map((th) =>
      (th.textContent ?? '').trim(),
    );

  afterEach(() => TestBed.resetTestingModule());

  it('is a DaisyUI collapse-arrow whose open state the host owns', () => {
    const root = render(laneTile());
    const panel = root.querySelector<HTMLElement>(
      '[data-testid="lane-usage-panel"]',
    );

    expect(collapse(root).classList).toContain('collapse');
    expect(collapse(root).classList).toContain('collapse-arrow');
    expect(collapse(root).classList).toContain('collapse-close');
    expect(face(root).classList).toContain('collapse-title');
    expect(panel?.classList).toContain('collapse-content');
    expect(face(root).type).toBe('button');
    expect(face(root).getAttribute('aria-expanded')).toBe('false');
    expect(face(root).nextElementSibling).toBe(panel);
    expect(face(root).getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.hidden).toBe(true);
    expect(root.querySelector('[data-testid="lane-subgroup"]')).toBeNull();

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(collapse(root).classList).toContain('collapse-open');
    expect(collapse(root).classList).not.toContain('collapse-close');
    expect(face(root).getAttribute('aria-expanded')).toBe('true');
    expect(panel?.hidden).toBe(false);
  });

  it('reads as outside the session totals: caption, dashed border, own fill', () => {
    const root = render(laneTile());
    const caption = root.querySelector('[data-testid="lane-caption"]');

    expect(text(root, 'lane-caption')).toBe('lane · not in totals');
    expect(collapse(root).className).toContain('border-dashed');
    expect(collapse(root).className).toContain('bg-base-300/40');
    expect(collapse(root).className).toContain('border-warning');

    // The closed caption is one line with the full text in its title.
    expect(caption?.classList.contains('truncate')).toBe(true);
    expect(caption?.getAttribute('title')).toBe('lane · not in totals');

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(caption?.classList.contains('truncate')).toBe(false);
  });

  it('omits the caption when the Lanes section header shows it', () => {
    const root = render(laneTile());
    fixture.componentRef.setInput('captionShared', true);
    fixture.detectChanges();

    expect(root.querySelector('[data-testid="lane-caption"]')).toBeNull();
    expect(collapse(root).className).toContain('border-dashed');
  });

  it('puts name, usage and status on the shared lane grid', () => {
    const root = render(laneTile());
    const grid = root.querySelector<HTMLElement>('[data-testid="lane-row-grid"]');

    for (const token of LANE_ROW_GRID.split(' ')) {
      expect(grid?.classList).toContain(token);
    }
    expect(LANE_ROW_GRID).toContain('grid-cols-[minmax(0,1fr)_5.5rem_7rem]');
    expect(Array.from(grid?.children ?? []).length).toBe(3);
    expect(text(root, 'lane-name')).toBe('Claude · docs');
    expect(text(root, 'lane-tokens')).toBe('43.4k tokens');
    expect(text(root, 'lane-run-chip')).toBe('Live · 1 of 2 running');
    const status = root.querySelector('[data-testid="lane-run-chip"]');
    expect(status?.classList).toContain('badge');
    expect(status?.classList).toContain('badge-xs');
    expect(status?.classList).toContain('badge-ghost');
  });

  it('shows an at- or near-limit alert badge on the closed face only', () => {
    const root = render(laneTile());
    expect(text(root, 'lane-limit-chip')).toBe(
      '▲ Near limit · 1 of 2 runs (sonnet)',
    );
    expect(
      root.querySelector('[data-testid="lane-limit-chip"]')?.className,
    ).toContain('border-warning');

    TestBed.resetTestingModule();
    const calm = render(
      laneTile({
        tone: 'neutral',
        limitChips: [
          {
            chip: { tone: 'success', glyph: '✓', text: 'Room' },
            sourceChips: [],
          },
        ],
      }),
    );
    expect(calm.querySelector('[data-testid="lane-limit-chip"]')).toBeNull();
  });

  it('shows a known cost as usage when no tokens are known', () => {
    const root = render(laneTile({ tokensText: '', costLine: 'cost $0.40' }));
    expect(text(root, 'lane-tokens')).toBe('cost $0.40');
  });

  it('emits toggled on activation', () => {
    const root = render(laneTile());
    const emitted = jest.fn();
    fixture.componentInstance.toggled.subscribe(emitted);

    face(root).click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('when open, shows the summary line once, then each subgroup', () => {
    const root = render(laneTile(), true);
    const groups = all(root, 'lane-subgroup');

    expect(all(root, 'lane-summary')).toHaveLength(1);
    expect(text(root, 'lane-summary')).toContain(
      '43.4k tokens · cost $0.32 · Near limit · 1 of 2 runs (sonnet)',
    );
    expect(text(root, 'lane-summary')).toContain('Provider API');
    expect(
      root.querySelector('[data-testid="lane-summary"]')?.className,
    ).toContain('text-base-content-muted');
    expect(groups.map((group) => group.dataset['ownerStatus'])).toEqual([
      'same',
      'different',
    ]);
    // Several subgroups: each names its models and limit state.
    expect(text(groups[0], 'lane-subgroup-state')).toBe('▲ Near limit');
    // Same account: "see plan tiles" chips, no repeated window detail (A2).
    expect(
      groups[0].querySelector('[data-testid="lane-plan-tile-chip"]')
        ?.textContent,
    ).toContain('5-hour · Near limit');
    expect(groups[0].querySelector('[role="meter"]')).toBeNull();
    // Different owner: the full window detail with its meter.
    expect(
      groups[1].querySelector('[role="meter"]')?.getAttribute('aria-valuenow'),
    ).toBe('12');
  });

  it('states "Limit unavailable" once when no subgroup knows its limit', () => {
    const unknown = { ...DIFFERENT_SUBGROUP, windows: [], notes: [], footnote: '' };
    const root = render(
      laneTile({
        summary: 'Usage unavailable · Limit unavailable',
        limitChips: [],
        subgroups: [
          { ...unknown, key: 'a|sonnet', heading: 'sonnet' },
          { ...unknown, key: 'b|gpt-5', heading: 'gpt-5' },
        ],
      }),
      true,
    );
    const panelText = (
      root.querySelector('[data-testid="lane-usage-panel"]')?.textContent ?? ''
    ).replace(/\s+/g, ' ');

    expect(all(root, 'lane-subgroup')).toHaveLength(2);
    expect(all(root, 'lane-subgroup-state')).toHaveLength(0);
    expect(panelText.match(/Limit unavailable/g)).toHaveLength(1);
  });

  it('lists runs in a table-xs with #, Model, Tokens, Cost, Status, Started', () => {
    const root = render(laneTile(), true);
    const table = root.querySelector('[data-testid="lane-run-table"]');

    expect(table?.classList).toContain('table');
    expect(table?.classList).toContain('table-xs');
    expect(headers(table as Element)).toEqual([
      '#',
      'Model',
      'Tokens',
      'Cost',
      'Status',
      'Started',
    ]);
    const tokens = root.querySelector('[data-testid="lane-run-tokens"]');
    expect(tokens?.textContent?.trim()).toBe('31.4k');
    expect(tokens?.className).toContain('text-right');
    expect(tokens?.className).toContain('tabular-nums');
    expect(text(root, 'lane-run-cost')).toBe('$0.18');
    const status = root.querySelector('[data-testid="lane-run-status"]');
    expect(status?.textContent?.trim()).toBe('Running');
    expect(status?.classList).toContain('badge');
    expect(status?.classList).toContain('badge-xs');
    const started = root.querySelector('[data-testid="lane-run-started"]');
    expect(started?.textContent?.trim()).toBe('5 Oct 11:00');
    expect(started?.getAttribute('title')).toBe('Mon 5 Oct 2026 11:00 UTC');
  });

  it('explains owner and limit in one footnote line with an info icon', () => {
    const root = render(laneTile(), true);
    const notes = all(root, 'lane-footnote');

    expect(notes).toHaveLength(2);
    expect(notes[0].className).toContain('text-xs text-base-content-muted');
    expect(notes[0].querySelector('lucide-angular')?.getAttribute('aria-hidden')).toBe('true');
    expect(notes[0].textContent?.trim()).toBe(SAME_SUBGROUP.footnote);
    expect(notes[1].textContent?.trim()).toBe(DIFFERENT_SUBGROUP.footnote);
    for (const note of notes) {
      expect(note.className).not.toMatch(/warning|error/);
    }
  });

  it('a lane with every value unknown: one summary, dropped columns, one footnote', () => {
    const tile = buildTile([laneRun({ quotaOwner: undefined })]);
    const root = render(tile, true);
    const panel = root.querySelector<HTMLElement>(
      '[data-testid="lane-usage-panel"]',
    );
    const panelText = (panel?.textContent ?? '').replace(/\s+/g, ' ');

    expect(text(root, 'lane-tokens')).toBe('—');
    expect(
      root.querySelector('[data-testid="lane-tokens"]')?.getAttribute('aria-label'),
    ).toBe('Usage unavailable');
    expect(text(root, 'lane-summary')).toBe(
      'Usage unavailable · Limit unavailable',
    );
    // Model, Tokens and Cost are unknown on every run, so they are dropped.
    expect(headers(root.querySelector('[data-testid="lane-run-table"]') as Element)).toEqual([
      '#',
      'Status',
      'Started',
    ]);
    expect(panelText).not.toMatch(/Model unknown|Tokens —|Cost —/);
    // "Limit unavailable" once: the summary states it, the footnote does not.
    expect(panelText.match(/Limit unavailable/g)).toHaveLength(1);
    expect(all(root, 'lane-footnote')).toHaveLength(1);
    expect(text(root, 'lane-footnote')).toBe(
      "owner not recorded; no other account's windows are borrowed",
    );
    expect(root.textContent).not.toMatch(/\b0 tokens|\$0\.00/);
  });

  it('keeps a column when some runs know it; unknown cells read —', () => {
    const tile = buildTile([
      laneRun({
        runId: 'a',
        model: 'gpt-5',
        usageTotals: { totalTokens: 1500, costUsd: 0.25 },
      }),
      laneRun({ runId: 'b', startedAt: NOW - 1_800_000 }),
    ]);
    const root = render(tile, true);
    const rows = all(root, 'lane-run-row');

    expect(headers(root.querySelector('[data-testid="lane-run-table"]') as Element)).toEqual([
      '#',
      'Model',
      'Tokens',
      'Cost',
      'Status',
      'Started',
    ]);
    expect(rows.map((row) => text(row, 'lane-run-tokens'))).toEqual(['1.5k', '—']);
    const unknownCost = rows[1].querySelector('[data-testid="lane-run-cost"]');
    expect(unknownCost?.getAttribute('aria-label')).toBeTruthy();
    expect(unknownCost?.className).toContain('text-base-content-muted');
    expect(rows.map((row) => text(row, 'lane-run-model'))).toEqual(['gpt-5', '—']);
  });

  it('shows status as a badge, never a "Restored · completed" sentence per run', () => {
    const tile = buildTile([
      laneRun({ runId: 'a' }),
      laneRun({ runId: 'b', status: 'failed', failureKind: 'quota' }),
    ]);
    const root = render(tile, true);
    const panel = root.querySelector('[data-testid="lane-usage-panel"]');

    expect(all(root, 'lane-run-status').map((badge) => badge.textContent?.trim())).toEqual([
      'Completed',
      'Quota failure',
    ]);
    expect(panel?.textContent).not.toContain('Restored');
    expect(
      all(root, 'lane-run-status')[1].className,
    ).toContain('border-error');
  });

  it('a restored lane of a last-known owner: the summary agrees with its panel', () => {
    const CLAUDE_B: QuotaOwnerRef = { ...CLAUDE_A, key: 'claude-cli#account:bbbbbbbbbbbbbbbb' };
    const vm = buildStatsLimitViewModel({
      sessionId: 'session-1',
      sessionOwnerKey: CLAUDE_A.key,
      sessionModelScope: null,
      owners: [
        {
          owner: CLAUDE_A,
          status: 'available',
          windowSetEstablished: true,
          windows: [],
          ownerEvidence: [],
        },
        {
          owner: CLAUDE_B,
          status: 'service-unavailable',
          windowSetEstablished: false,
          windows: [
            {
              key: 'weekly',
              kind: 'weekly',
              label: 'Weekly',
              used: { kind: 'percent', percent: 60 },
              usedSource: 'provider-api',
              resetsAt: NOW + 3 * 86_400_000,
              resetSource: 'provider-api',
              lastResetAt: NOW - 4 * 86_400_000,
              observedAt: NOW - 60_000,
            },
          ],
          ownerEvidence: [],
        },
      ],
      laneRuns: [
        laneRun({ runId: 'run-r', cli: 'ptah-cli', cliLabel: 'Ptah CLI', role: null, quotaOwner: CLAUDE_B }),
      ],
      now: NOW,
      time: UTC,
    });
    const root = render(vm.laneTiles[0], true);

    expect(face(root).textContent).toContain('Ptah CLI');
    expect(text(root, 'lane-summary')).toContain('Last known · Weekly 60% used');
    expect(root.textContent).not.toContain('Limit unknown');
    expect(text(root, 'lane-footnote')).toContain(
      'Different owner · Claude account · bbbb',
    );
    expect(text(root, 'lane-footnote')).toContain('showing its last-known evidence');
  });

  it('draws the focus ring through the DaisyUI collapse, never in info', () => {
    const root = render(laneTile());

    // `.collapse:has(.collapse-title:focus-visible)` outlines the row in
    // base-content (3:1 in both themes); the title adds no second ring.
    expect(face(root).className).toContain('focus-visible:outline-none');
    expect(collapse(root).className).not.toContain('outline-info');
  });

  it('marks the live run chip with a reduced-motion-safe dot', () => {
    const root = render(laneTile());
    const dot = root.querySelector(
      '[data-testid="lane-run-chip"] .motion-safe\\:animate-pulse',
    );

    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });

  describe('inspector variant (compact icons + numbers)', () => {
    function renderCompact(tile: LaneUsageTileModel, open = false): HTMLElement {
      TestBed.configureTestingModule({ imports: [LaneUsageTileComponent] });
      fixture = TestBed.createComponent(LaneUsageTileComponent);
      fixture.componentRef.setInput('tile', tile);
      fixture.componentRef.setInput('open', open);
      fixture.componentRef.setInput('variant', 'inspector');
      fixture.componentRef.setInput('captionShared', true);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    /** Text a sighted user sees: screen-reader-only text removed. */
    function visible(el: Element | null): string {
      if (!el) return '';
      const copy = el.cloneNode(true) as Element;
      copy.querySelectorAll('.sr-only').forEach((node) => node.remove());
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    }

    function srOnly(el: Element | null): string {
      return Array.from(el?.querySelectorAll('.sr-only') ?? [])
        .map((node) => (node.textContent ?? '').trim())
        .join(' ');
    }

    const by = (root: HTMLElement, testId: string): HTMLElement | null =>
      root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

    // The screenshot's lane: one restored, completed Claude run with partial
    // usage and an unresolved session owner.
    const restoredClaude = (): LaneUsageTileModel =>
      buildTile([
        laneRun({
          cli: 'ptah-cli',
          cliLabel: 'Claude',
          role: null,
          quotaOwner: undefined,
          usageTotals: { totalTokens: 2600, costUsd: 0.02, partial: true },
        }),
      ]);

    it('shows name, # tokens, coins cost and a status dot with one word', () => {
      const root = renderCompact(restoredClaude());
      const row = by(root, 'lane-row-grid');

      expect(visible(by(root, 'lane-name'))).toBe('Claude');
      expect(by(root, 'lane-name')?.className).toContain('text-[11.5px]');
      expect(visible(by(root, 'lane-tokens'))).toBe('≥2.6k');
      expect(visible(by(root, 'lane-cost'))).toBe('≥$0.02');
      expect(visible(by(root, 'lane-run-chip'))).toBe('Completed');
      expect(by(root, 'lane-tokens')?.className).toContain('text-[10.5px]');
      expect(row?.querySelectorAll('lucide-angular[aria-hidden="true"]')).toHaveLength(2);
      // The chevron keeps its own right slot; the status word truncates before it.
      expect(face(root).className).toContain('!pr-8');
      const status = by(root, 'lane-run-chip');
      expect(status?.className).toContain('min-w-0');
      expect(status?.className).not.toContain('shrink-0');
      expect(status?.querySelector('span.truncate')?.textContent?.trim()).toBe('Completed');
      // No sentence on the face.
      expect(visible(face(root))).not.toMatch(/tokens|cost|Restored|Limit unavailable|not in totals/);
    });

    it('keeps the lower bound: visible ≥, "at least" for screen readers, "lower bound" in the tooltip', () => {
      const root = renderCompact(restoredClaude());
      const tokens = by(root, 'lane-tokens');
      const marker = tokens?.querySelector('ptah-lane-bound-value span[aria-hidden="true"]');

      expect(marker?.textContent).toBe('≥');
      expect(srOnly(tokens)).toContain('Tokens');
      expect(srOnly(tokens)).toContain('at least');
      expect(tokens?.getAttribute('title')).toBe('≥2.6k tokens · lower bound');
      expect(srOnly(by(root, 'lane-cost'))).toContain('at least');
      expect(by(root, 'lane-cost')?.getAttribute('title')).toBe('cost ≥$0.02');
    });

    it('moves "Restored · completed" and the usage/limit summary into tooltip and accessible text', () => {
      const tile = restoredClaude();
      const root = renderCompact(tile);
      const status = by(root, 'lane-run-chip');

      expect(status?.getAttribute('title')).toBe('Restored · completed');
      expect(by(root, 'lane-name')?.getAttribute('title')).toBe(
        `Claude\n${tile.summary}\nRestored · completed`,
      );
      expect(tile.summary).toBe('≥2.6k tokens · cost ≥$0.02 · Limit unavailable');
      // The summary is part of the button's name, read once: no description repeats it.
      expect(face(root).getAttribute('aria-label')).toBe(
        'Claude, at least 2.6k tokens, cost at least $0.02, Limit unavailable, Restored · completed',
      );
      expect(face(root).hasAttribute('aria-describedby')).toBe(false);
      expect(root.querySelector('[data-testid="lane-description"]')).toBeNull();
    });

    it('names unknown usage and an unshared caption in the button name', () => {
      TestBed.configureTestingModule({ imports: [LaneUsageTileComponent] });
      fixture = TestBed.createComponent(LaneUsageTileComponent);
      fixture.componentRef.setInput('tile', buildTile([laneRun({ quotaOwner: undefined })]));
      fixture.componentRef.setInput('variant', 'inspector');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;

      expect(face(root).getAttribute('aria-label')).toBe(
        'Codex · review, Usage unavailable, Cost unavailable, Limit unavailable, Restored · completed, lane · not in totals',
      );
    });

    it('shows an unknown value as a muted — that reads as unavailable', () => {
      const root = renderCompact(buildTile([laneRun()]));
      const tokens = by(root, 'lane-tokens');

      expect(visible(tokens)).toBe('—');
      expect(srOnly(tokens)).toContain('Usage unavailable');
      expect(tokens?.getAttribute('title')).toBe('Usage unavailable');
      expect(srOnly(by(root, 'lane-cost'))).toContain('Cost unavailable');
    });

    it('marks an alert with its glyph only, the text in tooltip and screen-reader text', () => {
      const root = renderCompact(laneTile());
      const alert = by(root, 'lane-limit-chip');

      expect(visible(alert)).toBe('▲');
      expect(alert?.getAttribute('title')).toBe('Near limit · 1 of 2 runs (sonnet)');
      expect(srOnly(alert)).toBe('Near limit · 1 of 2 runs (sonnet)');
      const dot = by(root, 'lane-run-chip')?.querySelector('.motion-safe\\:animate-pulse');
      expect(dot?.getAttribute('aria-hidden')).toBe('true');
    });

    it('open: icon table headers, owner label with the footnote in tooltip, no visible summary', () => {
      const tile = restoredClaude();
      const root = renderCompact(tile, true);
      const panel = by(root, 'lane-usage-panel');
      const table = by(root, 'lane-run-table');
      const note = by(root, 'lane-footnote');

      expect(panel?.className).toContain('text-[10.5px]');
      expect(by(root, 'lane-summary')).toBeNull();
      expect(table?.className).toContain('text-[10.5px]');
      // Sized to its content, so the status and Started columns sit together.
      expect(table?.className).toContain('!w-auto');
      expect(Array.from(table?.querySelectorAll('th') ?? []).map((th) => srOnly(th) || visible(th))).toEqual([
        '#',
        'Tokens',
        'Cost',
        'Status',
        'Started',
      ]);
      expect(table?.querySelectorAll('thead lucide-angular')).toHaveLength(3);
      expect(visible(by(root, 'lane-run-tokens'))).toBe('≥2.6k');
      expect(by(root, 'lane-run-tokens')?.getAttribute('title')).toBe('≥2.6k tokens · lower bound');
      expect(srOnly(by(root, 'lane-run-cost'))).toContain('at least');

      const footnote = tile.subgroups[0].footnote;
      expect(footnote.length).toBeGreaterThan(0);
      expect(visible(note)).toBe(tile.subgroups[0].ownerLabel);
      expect(visible(panel)).not.toContain(footnote);
    });

    it('opens the owner footnote from the keyboard as a visible line; Escape closes it', () => {
      const tile = restoredClaude();
      const root = renderCompact(tile, true);
      const footnote = tile.subgroups[0].footnote;
      const toggle = by(root, 'lane-footnote-toggle') as HTMLButtonElement;

      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.type).toBe('button');
      expect(toggle.getAttribute('title')).toBe(footnote);
      expect(toggle.getAttribute('aria-label')).toBe(`${tile.subgroups[0].ownerLabel} details`);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.hasAttribute('aria-controls')).toBe(false);
      expect(by(root, 'lane-footnote-detail')).toBeNull();

      toggle.click();
      fixture.detectChanges();
      const detail = by(root, 'lane-footnote-detail');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-controls')).toBe(detail?.id);
      expect(visible(detail)).toBe(footnote);
      expect(detail?.className).toContain('text-[10.5px]');
      expect(detail?.className).toContain('text-base-content-muted');

      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(by(root, 'lane-footnote-detail')).toBeNull();
    });

    it('leaves the strip variant face unchanged', () => {
      const root = render(laneTile());
      expect(text(root, 'lane-tokens')).toBe('43.4k tokens');
      expect(root.querySelector('[data-testid="lane-cost"]')).toBeNull();
      expect(face(root).hasAttribute('aria-label')).toBe(false);
      expect(root.querySelector('[data-testid="lane-footnote-toggle"]')).toBeNull();
    });
  });
});
