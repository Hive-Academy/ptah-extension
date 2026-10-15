import { TestBed } from '@angular/core/testing';
import {
  CompactSessionLanesComponent,
  formatBoardDuration,
} from './compact-session-lanes.component';
import type { CompactLaneRow, CompactLaneSummary } from './compact-lane.types';

const NOW = 1_000_000;

function lane(
  id: string,
  overrides: Partial<CompactLaneRow> = {},
): CompactLaneRow {
  return {
    id,
    name: id,
    kind: 'cli',
    status: 'running',
    startedAt: NOW - 65_000,
    endedAt: null,
    ...overrides,
  };
}

function summary(
  rows: readonly CompactLaneRow[],
  moreCount = 0,
): CompactLaneSummary {
  return {
    rows,
    moreCount,
    total: rows.length + moreCount,
    counts: {
      running: rows.length + moreCount,
      waiting: 0,
      error: 0,
      done: 0,
      stopped: 0,
    },
  };
}

function render(lanes: CompactLaneSummary) {
  const fixture = TestBed.createComponent(CompactSessionLanesComponent);
  fixture.componentRef.setInput('lanes', lanes);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  return fixture;
}

describe(CompactSessionLanesComponent.name, () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [CompactSessionLanesComponent] }),
  );

  it('shows the summary and accessible lane rows with board elapsed time', () => {
    const root = render(
      summary([
        lane('cli:a1'),
        lane('subagent:t1', {
          kind: 'subagent',
          status: 'done',
          startedAt: NOW - 30_000,
          endedAt: NOW - 18_000,
        }),
      ]),
    ).nativeElement as HTMLElement;

    const rows = root.querySelectorAll<HTMLButtonElement>('[data-lane-id]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('aria-label')).toBe(
      'Open cli:a1 output, running',
    );
    expect(rows[0].textContent).toContain('1m 05s');
    expect(rows[1].textContent).toContain('Sub-agent');
    expect(rows[1].textContent).toContain('12s');
    expect(
      root.querySelector('[data-testid="cs-lanes-summary"]')?.textContent,
    ).toContain('2 running');
  });

  it('shows the more line when moreCount is positive and caps rows at three', () => {
    const root = render(summary([lane('1'), lane('2'), lane('3')], 4))
      .nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-lane-id]')).toHaveLength(3);
    expect(
      root.querySelector('[data-testid="cs-lanes-more"]')?.textContent?.trim(),
    ).toBe('+4 more lanes');
  });

  it('counts rows beyond three and emits the selected lane key', () => {
    const fixture = render(
      summary([lane('1'), lane('2'), lane('3'), lane('4')]),
    );
    const selected = jest.fn();
    fixture.componentInstance.laneSelected.subscribe(selected);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-lane-id]')).toHaveLength(3);
    expect(
      root.querySelector('[data-testid="cs-lanes-more"]')?.textContent?.trim(),
    ).toBe('+1 more lanes');
    root.querySelector<HTMLButtonElement>('[data-lane-id="1"]')?.click();
    expect(selected).toHaveBeenCalledWith('1');
  });

  it('keeps the summary while a callout replaces rows', () => {
    const fixture = render(summary([lane('1')], 2));
    fixture.componentRef.setInput('showRows', false);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="cs-lanes-summary"]')?.textContent,
    ).toContain('3 running');
    expect(root.querySelector('[data-lane-id]')).toBeNull();
    expect(root.querySelector('[data-testid="cs-lanes-more"]')).toBeNull();
  });
});

describe(formatBoardDuration.name, () => {
  it.each([
    [0, '0s'],
    [12_000, '12s'],
    [65_000, '1m 05s'],
    [3_725_000, '1h 02m'],
    [-1_000, '0s'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatBoardDuration(ms)).toBe(expected);
  });
});
