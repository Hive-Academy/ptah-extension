import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axe from 'axe-core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  TurnChangeSet,
  TurnChangeSetFile,
  TurnSourceSnapshot,
  TurnTestRun,
} from '@ptah-extension/shared';
import {
  buildTurnSummaryModel,
  type TurnSummaryMarks,
  type TurnSummaryModel,
} from '../../molecules/turn-recap/turn-summary.model';
import { formatTokens } from '../../molecules/session/session-stats-format';
import { TurnSummaryComponent } from './turn-summary.component';
import {
  MINI_CARD_CLASS,
  MINI_SECTION_CLASS,
  TURN_SUMMARY_MINI_STYLES,
} from './turn-summary-mini-card.styles';

function file(
  path: string,
  status: TurnChangeSetFile['status'],
  additions: number | null,
  deletions: number | null,
  extra: Partial<TurnChangeSetFile> = {},
): TurnChangeSetFile {
  return { path, status, additions, deletions, ...extra };
}

function changeSetOf(
  files: readonly TurnChangeSetFile[],
  extra: Partial<TurnChangeSet> = {},
): TurnChangeSet {
  return {
    sessionId: 'session',
    workspaceRoot: '/workspace',
    turnStartedAt: 0,
    turnEndedAt: 1,
    files: [...files],
    truncatedCount: 0,
    totals: {
      files: files.length,
      additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
      deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    },
    countsUnavailable: false,
    ...extra,
  };
}

const defaultFiles = [
  file('src/app/alpha.ts', 'M', 40, 7),
  file('src/app/beta.ts', 'A', 2, 0),
  file('src/app/new-name.ts', 'R', 3, 1, { origPath: 'src/app/old-name.ts' }),
  file('assets/logo.png', 'M', null, null, { binary: true }),
  file('src/app/unknown.ts', 'M', null, null),
  file('src/app/same.ts', 'M', 0, 0),
];

interface Options {
  readonly diff?: TurnChangeSet | null;
  readonly runs?: readonly TurnTestRun[];
  readonly incomplete?: boolean;
  readonly usage?: 'available' | 'unavailable' | 'zero-cost';
  readonly marks?: TurnSummaryMarks;
}

function model(options: Options = {}): TurnSummaryModel {
  const runs = options.runs ?? [];
  const diff =
    options.diff === undefined ? changeSetOf(defaultFiles) : options.diff;
  const usage = options.usage ?? 'available';
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
      usage === 'unavailable'
        ? { kind: 'unavailable' }
        : {
            kind: 'available',
            input: 180_000,
            output: 4_200,
            cost: usage === 'zero-cost' ? 0 : 1.84,
            durationMs: 252_000,
          },
  };
  const built = buildTurnSummaryModel(snapshot, options.marks ?? null);
  if (built === null) throw new Error('expected a summary');
  return built;
}

const mixedRuns: readonly TurnTestRun[] = [
  { command: 'npx nx test chat-ui', project: 'chat-ui', outcome: 'passed' },
  {
    command: 'npx nx test shared --testPathPattern=parser',
    project: 'shared',
    outcome: 'failed',
    failures: ['parser.spec.ts > rejects nested fence', 'store.spec.ts > pins'],
  },
  { command: 'npx jest foo', outcome: 'unknown' },
];

describe('TurnSummaryComponent', () => {
  let fixture: ComponentFixture<TurnSummaryComponent>;

  const native = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const query = (testId: string): HTMLElement | null =>
    native().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const queryAll = (testId: string, root: ParentNode = native()): HTMLElement[] => [
    ...root.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
  ];
  const text = (node: Element | null): string =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const card = (kind: string): HTMLElement | null =>
    query(`turn-summary-card-${kind}`);
  const toggleOf = (kind: string): HTMLButtonElement =>
    query(`turn-summary-card-toggle-${kind}`) as HTMLButtonElement;
  const regionOf = (kind: string): HTMLElement =>
    query(`turn-summary-region-${kind}`) as HTMLElement;
  const pills = (kind: string): string[] =>
    queryAll('turn-summary-pill', card(kind) as HTMLElement).map(text);

  function render(
    summary: TurnSummaryModel,
    actionError: string | null = null,
    turnKey = 'turn-1',
  ): void {
    fixture.componentRef.setInput('summary', summary);
    fixture.componentRef.setInput('turnKey', turnKey);
    fixture.componentRef.setInput('actionError', actionError);
    fixture.detectChanges();
  }

  function open(kind: string): void {
    toggleOf(kind).click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TurnSummaryComponent] });
    fixture = TestBed.createComponent(TurnSummaryComponent);
  });

  describe('cards (R6.1, R6.4)', () => {
    it('renders the model cards in order: Files, Lines, Tokens, Cost, Duration, Tests', () => {
      render(model({ runs: mixedRuns }));
      const kinds = [
        ...native().querySelectorAll<HTMLElement>('[data-testid^="turn-summary-card-"]:not([data-testid*="toggle"])'),
      ].map((node) => node.dataset['testid']);
      expect(kinds).toEqual([
        'turn-summary-card-files',
        'turn-summary-card-lines',
        'turn-summary-card-tokens',
        'turn-summary-card-cost',
        'turn-summary-card-duration',
        'turn-summary-card-tests',
      ]);
      expect(text(query('turn-summary-value-files'))).toBe('6');
      expect(text(query('turn-summary-caption-files'))).toBe('changed');
      expect(text(query('turn-summary-value-lines'))).toBe(
        '+45 −8 lines added and removed',
      );
      expect(text(query('turn-summary-value-tokens'))).toBe('184.2k');
      expect(text(query('turn-summary-value-cost'))).toBe('$1.84');
      expect(text(query('turn-summary-value-duration'))).toBe(
        model().duration.value,
      );
      expect(text(query('turn-summary-value-tests'))).toBe('1/3 passed');
    });

    it('labels the cards as the inline chip does, Duration reading "Time"', () => {
      render(model({ runs: mixedRuns }));
      const labels = queryAll('turn-summary-grid')[0].querySelectorAll(
        '[role="listitem"] button > span:first-child',
      );
      expect([...labels].map(text)).toEqual([
        'Files',
        'Lines',
        'Tokens',
        'Cost',
        'Time',
        'Tests',
      ]);
    });

    it('shows Tokens as the total with an "in · out" caption', () => {
      render(model());
      expect(text(query('turn-summary-caption-tokens'))).toBe(
        `${formatTokens(180_000)} in · ${formatTokens(4_200)} out`,
      );
      render(model({ usage: 'unavailable' }));
      expect(query('turn-summary-caption-tokens')).toBeNull();
    });

    it('expands Lines, Tokens, Cost and Time to their detail rows', () => {
      render(model());
      const rows = (kind: string): string[] =>
        [...regionOf(kind).querySelectorAll('dt, dd')].map(text);
      for (const kind of ['lines', 'tokens', 'cost', 'duration']) open(kind);
      expect(rows('lines')).toEqual(['Added', '45', 'Removed', '8']);
      expect(rows('tokens')).toEqual([
        'Input',
        formatTokens(180_000),
        'Output',
        formatTokens(4_200),
      ]);
      expect(rows('cost')).toEqual(['Turn cost', '$1.84']);
      expect(rows('duration')).toEqual(['Elapsed', model().duration.value]);

      render(model({ usage: 'unavailable' }));
      expect(text(regionOf('cost'))).toContain(
        'No cost was reported for this turn.',
      );
    });

    it('turn with no test command has no Tests card (omitted, not zero)', () => {
      render(model());
      expect(card('tests')).toBeNull();
      expect(card('files')).not.toBeNull();
    });

    it('turn with no files has no Files or Lines card (decision #66)', () => {
      render(model({ diff: null, runs: mixedRuns }));
      expect(card('files')).toBeNull();
      expect(card('lines')).toBeNull();
      expect(card('tests')).not.toBeNull();
    });

    it('keeps cost "unavailable", never $0; a real 0 stays a number', () => {
      render(model({ usage: 'unavailable' }));
      const cost = query('turn-summary-value-cost') as HTMLElement;
      expect(text(cost)).toBe('unavailable');
      // A status word is set small and never broken mid-word (D2, #150).
      expect(cost.classList).toContain('break-normal');
      expect(text(query('turn-summary-caption-cost'))).toBe('not reported');
      expect(text(query('turn-summary-value-tokens'))).toBe('unavailable');

      render(model({ usage: 'zero-cost' }));
      expect(text(query('turn-summary-value-cost'))).toBe('$0.0000');
      expect(query('turn-summary-caption-cost')).toBeNull();
      expect(
        (query('turn-summary-value-cost') as HTMLElement).classList,
      ).toContain('text-lg');
    });
  });

  describe('collapse (R9)', () => {
    it('starts every card collapsed with an inert region its toggle controls', () => {
      render(model({ runs: mixedRuns }));
      for (const kind of ['files', 'lines', 'tokens', 'cost', 'duration', 'tests']) {
        const toggle = toggleOf(kind);
        const region = regionOf(kind);
        expect(toggle.tagName).toBe('BUTTON');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-controls')).toBe(region.id);
        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('aria-labelledby')).toBe(toggle.id);
        expect(region.hasAttribute('inert')).toBe(true);
      }
    });

    it('toggles open, then Escape collapses and returns focus to the toggle', () => {
      render(model({ runs: mixedRuns }));
      open('tests');
      expect(toggleOf('tests').getAttribute('aria-expanded')).toBe('true');
      expect(regionOf('tests').hasAttribute('inert')).toBe(false);
      expect(card('tests')?.getAttribute('data-open')).toBe('true');

      const inside = regionOf('tests').querySelector('summary') as HTMLElement;
      inside.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(toggleOf('tests').getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggleOf('tests'));
      // The section around it stays open: the card handled Escape.
      expect(
        query('turn-summary-toggle')?.getAttribute('aria-expanded'),
      ).toBe('true');
    });

    it('Escape on an open card toggle collapses only that card', () => {
      render(model());
      open('tokens');
      toggleOf('tokens').focus();
      toggleOf('tokens').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(toggleOf('tokens').getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggleOf('tokens'));
      expect(
        query('turn-summary-toggle')?.getAttribute('aria-expanded'),
      ).toBe('true');
    });

    it('keeps the card grid fixed: open details stack under it in card order', () => {
      render(model({ runs: mixedRuns }));
      open('tests');
      open('tokens');
      const grid = query('turn-summary-grid') as HTMLElement;
      expect(grid.contains(regionOf('tokens'))).toBe(false);
      expect(grid.contains(regionOf('tests'))).toBe(false);
      // Regions follow the grid, in card order (tokens before tests).
      expect(
        grid.compareDocumentPosition(regionOf('tokens')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        regionOf('tokens').compareDocumentPosition(regionOf('tests')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(card('tokens')?.getAttribute('data-open')).toBe('true');
      expect(card('tests')?.getAttribute('data-open')).toBe('true');
      expect(card('files')?.getAttribute('data-open')).toBe('false');
    });

    it('opens the section by default and collapses it with its own toggle', () => {
      render(model());
      const toggle = query('turn-summary-toggle') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      const region = document.getElementById(
        toggle.getAttribute('aria-controls') as string,
      );
      expect(region?.hasAttribute('inert')).toBe(true);
    });

    it('a conflict forces Files open until the user toggles it (parity)', () => {
      const marks: TurnSummaryMarks = {
        conflicted: new Set(['src/app/alpha.ts']),
        reconciled: new Set(),
      };
      render(model({ marks }));
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('true');
      expect(pills('files')).toContain('1 conflicted');
      open('files');
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('disclosure state lasts one turn (review R9o finding 1)', () => {
    const conflictOn = (path: string): TurnSummaryMarks => ({
      conflicted: new Set([path]),
      reconciled: new Set(),
    });
    const turnA = (options: Options = {}): void =>
      render(
        model({ diff: changeSetOf(defaultFiles, { turnStartedAt: 1_000 }), ...options }),
        null,
        'turn-a',
      );
    const turnB = (options: Options = {}): void =>
      render(
        model({ diff: changeSetOf(defaultFiles, { turnStartedAt: 2_000 }), ...options }),
        null,
        'turn-b',
      );

    it('a new conflicted turn forces Files open after Files was closed on the previous turn', () => {
      turnA({ marks: conflictOn('src/app/alpha.ts') });
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('true');
      open('files');
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('false');

      turnB({ marks: conflictOn('src/app/beta.ts') });
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('true');
      expect(regionOf('files').hasAttribute('inert')).toBe(false);
      expect(queryAll('turn-summary-file-row').length).toBeGreaterThan(0);
    });

    it('a new turn returns cards and the section to their defaults', () => {
      turnA({ runs: mixedRuns });
      open('tokens');
      open('tests');
      const section = query('turn-summary-toggle') as HTMLButtonElement;
      section.click();
      fixture.detectChanges();
      expect(toggleOf('tokens').getAttribute('aria-expanded')).toBe('true');
      expect(section.getAttribute('aria-expanded')).toBe('false');

      turnB({ runs: mixedRuns });
      for (const kind of ['files', 'lines', 'tokens', 'cost', 'duration', 'tests']) {
        expect(toggleOf(kind).getAttribute('aria-expanded')).toBe('false');
      }
      expect(section.getAttribute('aria-expanded')).toBe('true');
    });

    it('a re-render of the same turn keeps the user choice, even when marks change', () => {
      turnA({ marks: conflictOn('src/app/alpha.ts'), runs: mixedRuns });
      open('files');
      open('tokens');
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('false');

      turnA({ marks: conflictOn('src/app/beta.ts'), runs: mixedRuns });
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('false');
      expect(toggleOf('tokens').getAttribute('aria-expanded')).toBe('true');
    });

    it('a file-less turn keys on the source turn id: an added run keeps, a look-alike turn resets', () => {
      const running: readonly TurnTestRun[] = [
        { command: 'npx nx test chat-ui', project: 'chat-ui', outcome: 'running' },
      ];
      render(model({ diff: null, runs: running }), null, 'turn-a');
      open('tests');
      const section = query('turn-summary-toggle') as HTMLButtonElement;
      section.click();
      fixture.detectChanges();
      // The same turn gains a run and resolves an outcome: choices stay.
      render(
        model({ diff: null, runs: [{ ...running[0], outcome: 'passed' }, ...mixedRuns] }),
        null,
        'turn-a',
      );
      expect(toggleOf('tests').getAttribute('aria-expanded')).toBe('true');
      expect(section.getAttribute('aria-expanded')).toBe('false');

      // Another file-less turn that ran the very same commands: defaults again.
      render(model({ diff: null, runs: running }), null, 'turn-b');
      expect(toggleOf('tests').getAttribute('aria-expanded')).toBe('false');
      expect(section.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('Files detail (parity section 2)', () => {
    it('shows status with an accessible name, rename origin and per-file counts', () => {
      render(model());
      open('files');
      const rows = queryAll('turn-summary-file-row');
      expect(rows).toHaveLength(6);
      const badge = rows[0].querySelector('[data-testid="file-status-badge"]');
      expect(badge?.getAttribute('aria-label')).toBe('Modified');
      expect(text(rows[0].querySelector('[data-testid="turn-summary-file-path"]'))).toBe(
        'src/app/alpha.ts',
      );
      expect(
        rows[0].querySelector('[data-testid="turn-summary-file-path"]')?.getAttribute('title'),
      ).toBe('src/app/alpha.ts');
      expect(text(query('turn-summary-file-origin'))).toBe(
        'renamed from src/app/old-name.ts',
      );
      expect(queryAll('turn-summary-file-counts').map(text)).toEqual([
        '+40 −7',
        '+2',
        '+3 −1',
        'binary',
        '?',
        '+0 −0',
      ]);
    });

    it('row actions open the file and Review all reviews the set (R6.8)', () => {
      render(model());
      open('files');
      const opened: string[] = [];
      let reviewed = 0;
      fixture.componentInstance.openFile.subscribe((path) => opened.push(path));
      fixture.componentInstance.review.subscribe(() => reviewed++);

      const action = queryAll('turn-summary-file-action')[0];
      expect(action.getAttribute('aria-label')).toBe('Show alpha.ts in review');
      action.click();
      (query('turn-summary-review-all') as HTMLButtonElement).click();

      expect(opened).toEqual(['src/app/alpha.ts']);
      expect(reviewed).toBe(1);
    });

    it('marks a conflicted file U with a Resolve action, and groups reconciled files', () => {
      const marks: TurnSummaryMarks = {
        conflicted: new Set(['src/app/alpha.ts']),
        reconciled: new Set(['src/app/beta.ts']),
      };
      render(model({ marks }));
      const conflictedRow = queryAll('turn-summary-file-row')[0];
      expect(
        conflictedRow.querySelector('[data-testid="file-status-badge"]')?.getAttribute('aria-label'),
      ).toBe('Conflicted');
      expect(text(conflictedRow.querySelector('[data-testid="turn-summary-file-conflicted"]'))).toBe(
        'Conflicted',
      );
      const resolve = conflictedRow.querySelector(
        '[data-testid="turn-summary-file-action"]',
      ) as HTMLButtonElement;
      expect(text(resolve)).toBe('Resolve');
      expect(resolve.getAttribute('aria-label')).toBe('Resolve alpha.ts');

      const group = query('turn-summary-reconciled') as HTMLDetailsElement;
      expect(group.tagName).toBe('DETAILS');
      expect(text(group.querySelector('summary'))).toBe(
        'No longer changes HEAD (1)',
      );
      expect(queryAll('turn-summary-file-reconciled-path').map(text)).toEqual([
        'src/app/beta.ts',
      ]);
      expect(queryAll('turn-summary-file-row')).toHaveLength(5);
    });

    it('counts unavailable: Files and Lines read "?" with the words (decision #69)', () => {
      render(
        model({
          diff: changeSetOf([file('a.ts', 'M', null, null)], {
            countsUnavailable: true,
          }),
        }),
      );
      expect(text(query('turn-summary-value-files'))).toBe('?');
      expect(text(query('turn-summary-caption-files'))).toBe(
        'counts unavailable',
      );
      expect(text(query('turn-summary-value-lines'))).toBe('? lines changed');
      expect(text(query('turn-summary-caption-lines'))).toBe(
        'counts unavailable',
      );
      open('lines');
      expect(text(regionOf('lines'))).toContain(
        'Line counts are unavailable for this turn.',
      );
      open('files');
      expect(text(query('turn-summary-counts-unavailable'))).toBe(
        'Line counts are unavailable for this turn.',
      );
      expect(native().textContent).not.toMatch(/\+0 −0/);
    });

    it('baseline missing: a warning pill and the "before this turn" note', () => {
      render(model({ diff: changeSetOf(defaultFiles, { baselineMissing: true }) }));
      expect(pills('files')).toContain('baseline missing');
      expect(text(query('turn-summary-baseline-missing'))).toBe(
        'May include changes made before this turn.',
      );
    });

    it('says "+N more files not listed" for the stored-file bound', () => {
      render(model({ diff: changeSetOf(defaultFiles, { truncatedCount: 3 }) }));
      expect(text(query('turn-summary-truncated'))).toBe(
        '+3 more files not listed',
      );
    });

    it('renders rows in pages of 50', () => {
      const many = Array.from({ length: 51 }, (_, i) =>
        file(`src/f${i}.ts`, 'M', 1, 0),
      );
      render(model({ diff: changeSetOf(many) }));
      open('files');
      expect(queryAll('turn-summary-file-row')).toHaveLength(50);
      const more = query('turn-summary-show-more') as HTMLButtonElement;
      expect(text(more)).toBe('Show 1 more (1 hidden)');
      more.click();
      fixture.detectChanges();
      expect(queryAll('turn-summary-file-row')).toHaveLength(51);
      expect(query('turn-summary-show-more')).toBeNull();
    });

    it('shows a rejected action inline as role="alert", even with Files collapsed', () => {
      render(model(), 'Could not open alpha.ts');
      expect(toggleOf('files').getAttribute('aria-expanded')).toBe('false');
      const alert = query('turn-summary-action-error') as HTMLElement;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe('Could not open alpha.ts');
      // Under the cards, above every detail, inside no collapsible region.
      for (const kind of ['files', 'lines', 'tokens', 'cost', 'duration']) {
        expect(regionOf(kind).contains(alert)).toBe(false);
      }
      expect(alert.closest('[inert]')).toBeNull();
      expect(
        (query('turn-summary-grid') as HTMLElement).compareDocumentPosition(alert) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        alert.compareDocumentPosition(regionOf('files')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      render(model(), null);
      expect(query('turn-summary-action-error')).toBeNull();
    });
  });

  describe('Tests detail (parity section 1)', () => {
    it('carries passed, failed and unknown counts in the card (ported labels)', () => {
      render(model({ runs: mixedRuns }));
      expect(text(query('turn-summary-caption-tests'))).toBe(
        '1 passed, 1 failed, 1 unknown',
      );
      expect(pills('tests')).toEqual([]);
      expect(card('tests')?.getAttribute('data-polarity')).toBe('bad');
    });

    it('shows "unknown" for an all-unknown list and "good" polarity', () => {
      render(model({ runs: [{ command: 'npx jest', outcome: 'unknown' }] }));
      expect(text(query('turn-summary-caption-tests'))).toBe('unknown');
      expect(card('tests')?.getAttribute('data-polarity')).toBe('good');
    });

    it('lists each run with an icon name, label, failure lines and the full command', () => {
      render(model({ runs: mixedRuns }));
      open('tests');
      const runs = queryAll('turn-summary-test-run');
      expect(runs).toHaveLength(3);
      expect(
        runs.map((run) => run.querySelector('[role="img"]')?.getAttribute('aria-label')),
      ).toEqual(['passed', 'failed', 'unknown']);
      expect(queryAll('turn-summary-test-label').map(text)).toEqual([
        'chat-ui',
        'shared',
        'unknown',
      ]);
      expect(queryAll('turn-summary-test-outcome').map(text)).toEqual([
        'Passed · chat-ui',
        'Failed · shared',
        'Unknown',
      ]);
      const outcome = queryAll('turn-summary-test-outcome')[1];
      expect(outcome.className).toContain('diff-del-text');
      expect(queryAll('turn-summary-test-failure').map(text)).toEqual([
        'parser.spec.ts > rejects nested fence',
        'store.spec.ts > pins',
      ]);
      const command = queryAll('turn-summary-test-command')[1];
      expect(command.tagName).toBe('DETAILS');
      expect(text(command.querySelector('summary'))).toBe('Full command');
      expect(text(command.querySelector('code'))).toBe(
        'npx nx test shared --testPathPattern=parser',
      );
      const progress = query('turn-summary-tests-progress') as HTMLProgressElement;
      expect(progress.getAttribute('aria-label')).toBe('1 of 3 tests passed');
    });

    it('names a background run and shows the "in background" pill (R6.3)', () => {
      render(model({ runs: [{ command: 'npx nx test a', outcome: 'running' }] }));
      expect(pills('tests')).toEqual(['in background']);
      open('tests');
      expect(
        query('turn-summary-test-run')?.querySelector('[role="img"]')?.getAttribute('aria-label'),
      ).toBe('running in background');
    });

    it('marks an aborted turn "incomplete" in the head and says why', () => {
      render(model({ runs: mixedRuns, incomplete: true }));
      expect(text(query('turn-summary-incomplete'))).toBe('incomplete');
      expect(pills('tests')).toContain('incomplete');
      expect(query('turn-summary-incomplete-note')?.getAttribute('role')).toBe('note');

      render(model({ runs: mixedRuns }));
      expect(query('turn-summary-incomplete')).toBeNull();
    });
  });

  describe('mini-card look (R9.6, decision 76)', () => {
    const source = readFileSync(join(__dirname, 'turn-summary.component.ts'), 'utf8');

    it('fits as many mini-card columns as the panel width allows, from the shared grid', () => {
      expect(TURN_SUMMARY_MINI_STYLES).toMatch(
        /\.ts-mini-grid \{\s*display: grid;\s*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 104px\), 1fr\)\);/,
      );
      render(model());
      const grid = query('turn-summary-grid') as HTMLElement;
      expect(grid.classList).toContain('ts-mini-grid');
      expect(grid.getAttribute('role')).toBe('list');
      expect(source).toContain('styles: [TURN_SUMMARY_MINI_STYLES, SUMMARY_STYLES]');
    });

    it('is the flat chip surface with the chip card on every toggle, no hero gradient', () => {
      render(model({ runs: mixedRuns }));
      const section = query('turn-summary') as HTMLElement;
      for (const token of MINI_SECTION_CLASS.split(' ')) {
        expect(section.classList).toContain(token);
      }
      for (const kind of ['files', 'lines', 'tokens', 'cost', 'duration', 'tests']) {
        for (const token of MINI_CARD_CLASS.split(' ')) {
          expect(toggleOf(kind).classList).toContain(token);
        }
      }
      expect(source).not.toMatch(/linear-gradient|ts-hero/);
    });

    it('keeps the Host pill that marks the host-built section', () => {
      render(model());
      expect(text(query('turn-summary-host'))).toBe('Host');
    });
  });

  it.each([false, true])(
    'has no axe violations with a mixed, incomplete summary (expanded: %s)',
    async (expanded) => {
      render(
        model({
          runs: mixedRuns,
          incomplete: true,
          diff: changeSetOf(defaultFiles, { baselineMissing: true, truncatedCount: 2 }),
        }),
        'Could not open alpha.ts',
      );
      if (expanded) {
        open('files');
        open('tests');
        open('tokens');
      }
      const results = await axe.run(native() as Parameters<typeof axe.run>[0], {
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
        },
      });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
  );

  it('imports neither the surface renderer nor the dashboard library (D14)', () => {
    for (const name of [
      'turn-summary.component.ts',
      'turn-summary-files.component.ts',
      'turn-summary-tests.component.ts',
      'turn-summary-mini-card.styles.ts',
    ]) {
      const source = readFileSync(join(__dirname, name), 'utf8');
      expect(source).not.toMatch(/declarative-dashboard|surface-renderer/);
    }
  });
});
