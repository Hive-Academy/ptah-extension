import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { QuotaOwnerRef } from '@ptah-extension/shared';
import { LaneUsageTileComponent } from './lane-usage-tile.component';
import { buildStatsLimitViewModel } from './stats-limit-view-model';
import {
  LANE_CAPTION,
  type LaneSubgroupModel,
  type LaneUsageTileModel,
  type StatsLimitLaneRun,
} from './stats-limit-view-model.types';

const NOW = Date.UTC(2026, 9, 5, 12, 0);
const UTC = { timeZone: 'UTC', zoneNameLocale: 'en-GB' } as const;
const CLAUDE_A: QuotaOwnerRef = {
  key: 'claude-cli#account:aaa',
  providerId: 'claude-cli',
  identityKind: 'account',
  label: 'Claude account',
};

const SAME_SUBGROUP: LaneSubgroupModel = {
  key: 'claude-cli#account:aaa|sonnet',
  heading: 'sonnet',
  ownerStatus: 'same',
  ownerLabel: 'Same account',
  ownerText: 'Same account as this session · see plan tiles',
  state: 'near-limit',
  stateChip: { tone: 'warning', glyph: '▲', text: 'Near limit' },
  runs: [
    {
      runId: 'run-1',
      label: 'Run',
      model: 'sonnet',
      tokensText: '31.4k',
      costText: '$0.18',
      stateText: 'Live · running',
    },
  ],
  planTileChips: [
    {
      planTileId: 'plan:claude-cli#account:aaa:five_hour',
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
};

const DIFFERENT_SUBGROUP: LaneSubgroupModel = {
  ...SAME_SUBGROUP,
  key: 'openai-codex#cli-store:ccc|',
  heading: 'gpt-5',
  ownerStatus: 'different',
  ownerLabel: 'Different owner',
  ownerText: 'Different owner · Codex account',
  state: 'unknown',
  stateChip: { tone: 'neutral', glyph: '?', text: 'Limit unknown' },
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
};

function laneTile(
  overrides: Partial<LaneUsageTileModel> = {},
): LaneUsageTileModel {
  return {
    id: 'lane:ptah-cli:docs',
    label: 'Claude · docs',
    caption: LANE_CAPTION,
    tokensText: '43.4k tokens',
    costLine: 'cost $0.32 · 2 runs',
    runChip: { tone: 'live', text: 'Live · 1 of 2 running' },
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

  const text = (root: HTMLElement, testId: string): string =>
    (root.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').trim();

  afterEach(() => TestBed.resetTestingModule());

  it('reads as outside the session totals: caption, dashed border, own fill', () => {
    const root = render(laneTile());

    expect(text(root, 'lane-caption')).toBe('lane · not in totals');
    expect(face(root).className).toContain('border-dashed');
    expect(face(root).className).toContain('bg-base-300/40');
  });

  it('is a closed disclosure button wired to its sibling panel', () => {
    const root = render(laneTile());
    const panel = root.querySelector<HTMLElement>(
      '[data-testid="lane-usage-panel"]',
    );

    expect(face(root).type).toBe('button');
    expect(face(root).getAttribute('aria-expanded')).toBe('false');
    expect(face(root).nextElementSibling).toBe(panel);
    expect(face(root).getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.hidden).toBe(true);
    expect(root.querySelector('[data-testid="lane-subgroup"]')).toBeNull();
  });

  it('shows tokens, cost, run state and per-subgroup limit chips on the face', () => {
    const root = render(laneTile());

    expect(text(root, 'lane-tokens')).toBe('43.4k tokens');
    expect(text(root, 'lane-cost')).toBe('cost $0.32 · 2 runs');
    expect(text(root, 'lane-run-chip')).toContain('Live · 1 of 2 running');
    expect(text(root, 'lane-limit-chip')).toContain(
      'Near limit · 1 of 2 runs (sonnet)',
    );
    expect(face(root).textContent).toContain('Provider API');
  });

  it('emits toggled on activation', () => {
    const root = render(laneTile());
    const emitted = jest.fn();
    fixture.componentInstance.toggled.subscribe(emitted);

    face(root).click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('when open, shows each subgroup with its owner relation', () => {
    const root = render(laneTile(), true);
    const groups = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid="lane-subgroup"]'),
    );

    expect(face(root).getAttribute('aria-expanded')).toBe('true');
    expect(root.classList.contains('col-span-full')).toBe(true);
    expect(groups.map((group) => group.dataset['ownerStatus'])).toEqual([
      'same',
      'different',
    ]);
    // Same account: "see plan tiles" chips, no repeated window detail (A2).
    expect(groups[0].textContent).toContain(
      'Same account as this session · see plan tiles',
    );
    expect(
      groups[0].querySelector('[data-testid="lane-plan-tile-chip"]')
        ?.textContent,
    ).toContain('5-hour · Near limit');
    expect(groups[0].querySelector('[role="meter"]')).toBeNull();
    // Different owner: the full window detail with its meter.
    expect(groups[1].textContent).toContain('Different owner · Codex account');
    expect(
      groups[1].querySelector('[role="meter"]')?.getAttribute('aria-valuenow'),
    ).toBe('12');
    expect(text(groups[1], 'lane-run-row')).toContain('Tokens 31.4k');
  });

  it('renders informational notes as info, never as a warning', () => {
    const root = render(laneTile(), true);
    const notes = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid="lane-note"]'),
    );

    expect(notes.map((note) => note.dataset['noteTone'])).toEqual([
      'info',
      'neutral',
    ]);
    expect(notes[0].className).toContain('border-info');
    for (const note of notes) {
      expect(note.className).not.toMatch(/warning|error/);
    }
  });

  it.each([
    ['null', null],
    ['absent', undefined],
  ])('reads %s usageTotals as unknown, never 0', (_label, usageTotals) => {
    const run: StatsLimitLaneRun = {
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
      ...(usageTotals === null && { usageTotals: null }),
    };
    const vm = buildStatsLimitViewModel({
      sessionId: 'session-1',
      sessionOwnerKey: CLAUDE_A.key,
      sessionModelScope: null,
      owners: [],
      laneRuns: [run],
      now: NOW,
      time: UTC,
    });
    const root = render(vm.laneTiles[0], true);

    expect(text(root, 'lane-tokens')).toBe('unknown tokens');
    expect(text(root, 'lane-cost')).toBe('cost unknown');
    expect(text(root, 'lane-run-row')).toContain('Tokens unknown');
    expect(text(root, 'lane-run-row')).toContain('Cost unknown');
    expect(root.textContent).not.toMatch(/\b0 tokens|\$0\.00/);
  });

  it('a restored lane of a last-known owner: the face agrees with its panel', () => {
    const CLAUDE_B: QuotaOwnerRef = { ...CLAUDE_A, key: 'claude-cli#account:bbb' };
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
        {
          runId: 'run-r',
          cli: 'ptah-cli',
          cliLabel: 'Ptah CLI',
          role: null,
          model: null,
          modelScope: null,
          status: 'completed',
          restored: true,
          startedAt: NOW - 3_600_000,
          quotaOwner: CLAUDE_B,
          usageTotals: null,
        },
      ],
      now: NOW,
      time: UTC,
    });
    const root = render(vm.laneTiles[0], true);

    expect(face(root).textContent).toContain('Ptah CLI');
    expect(text(root, 'lane-limit-chip')).toContain(
      'Last known · Weekly 60% used',
    );
    expect(face(root).textContent).not.toContain('Limit unknown');
    expect(root.textContent).toContain('Different owner · Claude account');
    expect(root.textContent).toContain('showing its last-known evidence');
  });

  it('draws a focus ring in base-content, which reaches 3:1 in both themes', () => {
    const root = render(laneTile());

    expect(face(root).className).toContain('focus-visible:outline-base-content');
    expect(face(root).className).not.toContain('outline-info');
  });

  it('marks the live run chip with a reduced-motion-safe dot', () => {
    const root = render(laneTile());
    const dot = root.querySelector(
      '[data-testid="lane-run-chip"] .motion-safe\\:animate-pulse',
    );

    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });
});
