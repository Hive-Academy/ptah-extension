import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axe from 'axe-core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  TurnChangeSet,
  TurnSourceSnapshot,
  TurnTestRun,
} from '@ptah-extension/shared';
import { TurnSummaryChipComponent } from './turn-summary-chip.component';
import {
  buildTurnSummaryModel,
  type TurnSummaryModel,
} from './turn-summary.model';

function run(command: string, outcome: TurnTestRun['outcome']): TurnTestRun {
  return { command, outcome };
}

const changeSet: TurnChangeSet = {
  sessionId: 'session',
  workspaceRoot: '/workspace',
  turnStartedAt: 0,
  turnEndedAt: 1,
  files: [
    { path: 'src/app/alpha.ts', status: 'M', additions: 40, deletions: 7 },
    { path: 'src/app/beta.ts', status: 'A', additions: 2, deletions: 0 },
    { path: 'src/app/gamma.ts', status: 'D', additions: 0, deletions: 0 },
  ],
  truncatedCount: 0,
  totals: { files: 3, additions: 42, deletions: 7 },
  countsUnavailable: false,
};

function model(
  options: {
    runs?: readonly TurnTestRun[];
    diff?: TurnChangeSet | null;
    incomplete?: boolean;
    usage?: boolean;
  } = {},
): TurnSummaryModel {
  const runs = options.runs ?? [];
  const diff = options.diff === undefined ? changeSet : options.diff;
  const snapshot: TurnSourceSnapshot = {
    state: 'terminal',
    incomplete: options.incomplete ?? false,
    diff:
      diff === null
        ? { kind: 'unavailable' }
        : { kind: 'available', changeSet: diff },
    tests: {
      kind: 'available',
      runs,
      summary: {
        total: runs.length,
        passed: runs.filter((r) => r.outcome === 'passed').length,
        failed: runs.filter((r) => r.outcome === 'failed').length,
        running: runs.filter((r) => r.outcome === 'running').length,
        unknown: runs.filter((r) => r.outcome === 'unknown').length,
      },
    },
    usage:
      options.usage === false
        ? { kind: 'unavailable' }
        : {
            kind: 'available',
            input: 180_000,
            output: 4_200,
            cost: 1.84,
            durationMs: 252_000,
          },
  };
  const built = buildTurnSummaryModel(snapshot);
  if (built === null) throw new Error('expected a summary');
  return built;
}

describe('TurnSummaryChipComponent', () => {
  let fixture: ComponentFixture<TurnSummaryChipComponent>;

  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null =>
    native().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const queryAll = (testId: string): HTMLElement[] => [
    ...native().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
  ];
  const text = (node: Element | null): string =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** A mini card's lines (label, value, caption), each one block. */
  const cardText = (card: Element): string =>
    [...card.children].map((line) => text(line)).join(' ');
  const metrics = (): string[] =>
    queryAll('turn-summary-chip-metric').map((node) => text(node));
  const toggle = (): HTMLButtonElement =>
    query('turn-summary-chip-toggle') as HTMLButtonElement;

  function render(summary: TurnSummaryModel, openable = true): void {
    fixture.componentRef.setInput('summary', summary);
    fixture.componentRef.setInput('openable', openable);
    fixture.detectChanges();
  }

  function expand(): void {
    toggle().click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TurnSummaryChipComponent] });
    fixture = TestBed.createComponent(TurnSummaryChipComponent);
  });

  describe('collapsed line (R6.5, R6.10)', () => {
    it('shows totals and the test outcome, e.g. "3 files · +42 −7 · 2 tests passed"', () => {
      render(
        model({
          runs: [run('nx test chat', 'passed'), run('npx jest', 'passed')],
        }),
      );

      expect(metrics()).toEqual(['3 files', '+42', '−7', '2 tests passed']);
    });

    it('spells failed, running and unknown runs as words (ported counts)', () => {
      render(
        model({
          runs: [
            run('nx test chat', 'passed'),
            run('npx jest foo', 'failed'),
            run('nx test bg', 'running'),
            run('pnpm vitest run', 'unknown'),
          ],
        }),
      );

      expect(metrics()).toEqual([
        '3 files',
        '+42',
        '−7',
        '1 test passed',
        '1 test failed',
        '1 test running in background',
        '1 test unknown',
      ]);
    });

    it('shows "tests unknown" when nothing resolved (ported all-unknown case)', () => {
      render(
        model({
          diff: null,
          runs: [
            run('npx jest foo', 'unknown'),
            run('nx test chat', 'unknown'),
          ],
        }),
      );

      expect(metrics()).toEqual(['tests unknown']);
    });

    it('omits zero line totals and a missing Files card', () => {
      render(
        model({
          diff: {
            ...changeSet,
            files: [changeSet.files[1]],
            totals: { files: 1, additions: 2, deletions: 0 },
          },
        }),
      );
      expect(metrics()).toEqual(['1 file', '+2']);

      render(model({ diff: null, runs: [run('nx test a', 'failed')] }));
      expect(metrics()).toEqual(['1 test failed']);
    });

    it('says "counts unavailable" instead of numbers', () => {
      render(model({ diff: { ...changeSet, countsUnavailable: true } }));

      expect(metrics()).toEqual(['files changed', 'counts unavailable']);
    });

    it('marks an aborted turn "incomplete" only when told (ported)', () => {
      render(model({ runs: [run('nx test chat', 'failed')] }));
      expect(metrics()).not.toContain('incomplete');

      render(
        model({ runs: [run('nx test chat', 'failed')], incomplete: true }),
      );
      expect(metrics()).toContain('incomplete');
    });

    it('labels the section with the totals and is not a live region (ported)', () => {
      render(
        model({
          runs: [run('nx test chat', 'passed'), run('npx jest foo', 'failed')],
          incomplete: true,
        }),
      );

      const root = query('turn-summary-chip');
      expect(root?.getAttribute('role')).toBeNull();
      expect(
        native().querySelectorAll('[role="status"], [aria-live]'),
      ).toHaveLength(0);
      expect(root?.getAttribute('aria-label')).toBe(
        'Turn summary: 3 files, +42, −7, 1 test passed, 1 test failed (incomplete)',
      );
    });
  });

  describe('collapse (R9)', () => {
    it('starts collapsed with an inert region the toggle controls', () => {
      render(model());

      const region = native().querySelector('[role="region"]') as HTMLElement;
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().getAttribute('aria-controls')).toBe(region.id);
      expect(region.getAttribute('aria-labelledby')).toBe(toggle().id);
      expect(region.hasAttribute('inert')).toBe(true);

      expand();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(region.hasAttribute('inert')).toBe(false);
    });

    it('Escape collapses an expanded chip and returns focus to the toggle', () => {
      render(model());
      expand();
      const button = query('turn-summary-chip-open') as HTMLButtonElement;
      button.focus();

      button.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();

      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle());
    });

    it('gives each chip a distinct region id referenced by its own toggle (ported)', () => {
      render(model());
      const second = TestBed.createComponent(TurnSummaryChipComponent);
      second.componentRef.setInput('summary', model());
      second.detectChanges();

      const firstRegion = native().querySelector('[role="region"]');
      const secondRoot = second.nativeElement as HTMLElement;
      const secondRegion = secondRoot.querySelector('[role="region"]');
      expect(firstRegion?.id).not.toBe(secondRegion?.id);
      expect(toggle().getAttribute('aria-controls')).toBe(firstRegion?.id);
      expect(
        secondRoot
          .querySelector('[data-testid="turn-summary-chip-toggle"]')
          ?.getAttribute('aria-controls'),
      ).toBe(secondRegion?.id);
    });
  });

  describe('expanded body', () => {
    it('shows mini cards for Files, Lines, Tokens, Cost, Time and Tests', () => {
      render(
        model({
          runs: [run('nx test a', 'passed'), run('nx test b', 'failed')],
        }),
      );
      expand();

      const cards = queryAll('turn-summary-chip-card').map(cardText);
      expect(cards).toEqual([
        'Files 3',
        'Lines +42 −7',
        'Tokens 184.2k 180.0k in · 4.2k out',
        'Cost $1.84',
        'Time 4m 12s',
        'Tests 1/2 passed 1 passed, 1 failed',
      ]);
    });

    it('omits Files, Lines and Tests cards with nothing to show (R6.4)', () => {
      render(model({ diff: null, runs: [run('nx test a', 'passed')] }));
      expand();
      expect(
        queryAll('turn-summary-chip-card').map(
          (card) => card.querySelector('span')?.textContent,
        ),
      ).toEqual(['Tokens', 'Cost', 'Time', 'Tests']);

      render(model({ runs: [] }));
      expect(
        queryAll('turn-summary-chip-card').map(
          (card) => card.querySelector('span')?.textContent,
        ),
      ).toEqual(['Files', 'Lines', 'Tokens', 'Cost', 'Time']);
    });

    it('reads "?" with "counts unavailable", and "unavailable" usage, never 0', () => {
      render(
        model({
          diff: { ...changeSet, countsUnavailable: true },
          usage: false,
        }),
      );
      expand();

      expect(queryAll('turn-summary-chip-card').map(cardText)).toEqual([
        'Files ? counts unavailable',
        'Lines ? counts unavailable',
        'Tokens unavailable',
        'Cost unavailable',
        'Time unavailable',
      ]);
    });

    it('never lists files, even expanded (R6.9; ported "no file content")', () => {
      render(model({ runs: [run('nx test chat', 'passed')] }));
      expand();

      const content = native().textContent ?? '';
      for (const file of changeSet.files) {
        expect(content).not.toContain(file.path);
        expect(content).not.toContain(file.path.split('/').pop() as string);
      }
    });

    it('"Open in panel" emits open', () => {
      render(model());
      const emitted = jest.fn();
      fixture.componentInstance.open.subscribe(emitted);
      expand();

      (query('turn-summary-chip-open') as HTMLButtonElement).click();

      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it('disables "Open in panel" with a reason on a host without the dock', () => {
      render(model(), false);
      const emitted = jest.fn();
      fixture.componentInstance.open.subscribe(emitted);
      expand();

      const button = query('turn-summary-chip-open') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const reason = native().querySelector(
        `#${button.getAttribute('aria-describedby')}`,
      );
      expect(text(reason)).toBe('Display panel unavailable');
      button.click();
      expect(emitted).not.toHaveBeenCalled();
    });
  });

  it.each([false, true])(
    'has no axe violations with a mixed, incomplete summary (expanded: %s)',
    async (expanded) => {
      render(
        model({
          runs: [
            run('nx test chat', 'failed'),
            run('npx jest foo', 'unknown'),
            run('pnpm vitest run', 'passed'),
          ],
          incomplete: true,
        }),
      );
      if (expanded) expand();

      const results = await axe.run(native() as Parameters<typeof axe.run>[0], {
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
        },
      });

      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
  );

  it('is flat base-200 with no hero gradient (prototype .chip, decision #70)', () => {
    render(model());
    const section = query('turn-summary-chip') as HTMLElement;
    expect(section.classList).toContain('bg-base-200');
    const source = readFileSync(
      join(__dirname, 'turn-summary-chip.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/linear-gradient|ts-hero/);
  });

  it('imports neither the surface renderer nor the dashboard library (D14)', () => {
    for (const file of [
      'turn-summary-chip.component.ts',
      'turn-summary.model.ts',
    ]) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/declarative-dashboard|surface-renderer/);
    }
  });
});
