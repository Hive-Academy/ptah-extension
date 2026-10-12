import {
  compilePtahUiBlock,
  resolvePtahUi,
  type SurfaceComponent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  TurnChangeSet,
  TurnSourceSnapshot,
  TurnTestRun,
  TurnTestSummary,
} from '@ptah-extension/shared';
import {
  buildTurnSummaryModel,
  turnTestsOutcomeLabel,
  type TurnSummaryMarks,
  type TurnSummaryModel,
} from './turn-summary.model';

function summaryOf(runs: readonly TurnTestRun[]): TurnTestSummary {
  const count = (outcome: TurnTestRun['outcome']): number =>
    runs.filter((run) => run.outcome === outcome).length;
  return {
    total: runs.length,
    passed: count('passed'),
    failed: count('failed'),
    running: count('running'),
    unknown: count('unknown'),
  };
}

function run(
  command: string,
  outcome: TurnTestRun['outcome'],
  extra: Partial<TurnTestRun> = {},
): TurnTestRun {
  return { command, outcome, ...extra };
}

const changeSet: TurnChangeSet = {
  sessionId: 'session',
  workspaceRoot: '/workspace',
  turnStartedAt: 0,
  turnEndedAt: 1,
  files: [
    { path: 'src/a.ts', status: 'M', additions: 40, deletions: 7 },
    { path: 'src/b.ts', status: 'A', additions: 2, deletions: 0 },
    {
      path: 'src/c.ts',
      origPath: 'src/old-c.ts',
      status: 'R',
      additions: 0,
      deletions: 0,
    },
  ],
  truncatedCount: 0,
  totals: { files: 3, additions: 42, deletions: 7 },
  countsUnavailable: false,
};

const noFiles: TurnChangeSet = {
  ...changeSet,
  files: [],
  totals: { files: 0, additions: 0, deletions: 0 },
};

function snapshot(
  overrides: {
    diff?: TurnChangeSet | 'pending' | 'unavailable';
    runs?: readonly TurnTestRun[] | 'pending' | 'unavailable';
    usage?: 'pending' | 'unavailable';
    incomplete?: boolean;
    state?: TurnSourceSnapshot['state'];
  } = {},
): TurnSourceSnapshot {
  const diff = overrides.diff ?? changeSet;
  const runs = overrides.runs ?? [];
  return {
    state: overrides.state ?? 'terminal',
    incomplete: overrides.incomplete ?? false,
    diff:
      typeof diff === 'string'
        ? { kind: diff }
        : { kind: 'available', changeSet: diff },
    tests:
      typeof runs === 'string'
        ? { kind: runs }
        : { kind: 'available', runs, summary: summaryOf(runs) },
    usage:
      overrides.usage === undefined
        ? {
            kind: 'available',
            input: 184_200,
            output: 3_100,
            cost: 1.84,
            durationMs: 252_000,
          }
        : { kind: overrides.usage },
  };
}

function build(
  value: TurnSourceSnapshot | null,
  marks?: TurnSummaryMarks,
): TurnSummaryModel {
  const model = buildTurnSummaryModel(value, marks);
  if (model === null) throw new Error('expected a summary');
  return model;
}

/** Every stat the resolver produced, in document order. */
function stats(
  components: readonly SurfaceComponent[],
): (string | number | undefined)[] {
  return components.flatMap((component) => {
    if ('children' in component && Array.isArray(component.children)) {
      return stats(component.children as readonly SurfaceComponent[]);
    }
    return component.kind === 'stat'
      ? [(component as { value?: string | number }).value]
      : [];
  });
}

/** What `$diff`, `$tests` and `$usage` resolve to for one snapshot (plan: values equal). */
function resolved(value: TurnSourceSnapshot): (string | number | undefined)[] {
  const body = [
    'stats',
    '  Files | $diff.files',
    '  Added | $diff.additions',
    '  Deleted | $diff.deletions',
    '  Input | $usage.input',
    '  Output | $usage.output',
    '  Cost | $usage.cost',
    '  Duration | $usage.duration',
    // `stats` takes at most 8 lines: the test counts are a second group.
    'stats',
    '  Tests | $tests.total',
    '  Passed | $tests.passed',
    '  Failed | $tests.failed',
    '  Unknown | $tests.unknown',
    '',
  ].join('\n');
  const compiled = compilePtahUiBlock(body, 'summary-parity');
  if (!compiled.ok) throw new Error(compiled.reason);
  return stats(resolvePtahUi(compiled.conversion, value).surface.components);
}

function modelValues(model: TurnSummaryModel): (string | number | undefined)[] {
  return [
    model.files?.value,
    model.lines?.additions,
    model.lines?.deletions,
    model.tokens.input,
    model.tokens.output,
    model.cost.value,
    model.duration.value,
    model.tests?.summary.total,
    model.tests?.summary.passed,
    model.tests?.summary.failed,
    model.tests?.summary.unknown,
  ];
}

describe('buildTurnSummaryModel', () => {
  describe('values equal the $diff / $tests / $usage resolution (R6.1)', () => {
    it.each([
      [
        'files and tests',
        snapshot({
          runs: [run('nx test chat', 'passed'), run('npx jest foo', 'failed')],
        }),
      ],
      [
        'counts unavailable',
        snapshot({
          diff: { ...changeSet, countsUnavailable: true },
          runs: [run('nx test chat', 'unknown')],
        }),
      ],
      [
        'usage unavailable',
        snapshot({
          usage: 'unavailable',
          runs: [run('nx test chat', 'passed')],
        }),
      ],
      [
        'zero cost stays $0.00-shaped, never "unavailable"',
        {
          ...snapshot({ runs: [run('nx test a', 'passed')] }),
          usage: {
            kind: 'available' as const,
            input: 0,
            output: 0,
            cost: 0,
            durationMs: 0,
          },
        },
      ],
    ])('%s', (_name, value) => {
      expect(modelValues(build(value))).toEqual(resolved(value));
    });

    it('formats a real cost and never invents $0 when cost is unavailable', () => {
      expect(build(snapshot()).cost.value).toBe('$1.84');
      expect(build(snapshot({ usage: 'unavailable' })).cost.value).toBe(
        'unavailable',
      );
    });
  });

  describe('nothing to report (R6.4)', () => {
    it('is null before the turn is terminal (never built during streaming)', () => {
      expect(
        buildTurnSummaryModel(
          snapshot({ state: 'pending', runs: [run('nx test a', 'passed')] }),
        ),
      ).toBeNull();
      expect(buildTurnSummaryModel(null)).toBeNull();
    });

    it('is null for a turn that changed no files and ran no test command', () => {
      expect(buildTurnSummaryModel(snapshot({ diff: noFiles }))).toBeNull();
      expect(
        buildTurnSummaryModel(snapshot({ diff: 'unavailable' })),
      ).toBeNull();
      expect(
        buildTurnSummaryModel(
          snapshot({ diff: 'unavailable', runs: 'unavailable' }),
        ),
      ).toBeNull();
    });

    it('is null while the change set is still loading and no test ran', () => {
      expect(buildTurnSummaryModel(snapshot({ diff: 'pending' }))).toBeNull();
    });

    it('turn with no test command has no Tests card (ported: "renders nothing for an empty list")', () => {
      const model = build(snapshot({ runs: [] }));
      expect(model.tests).toBeNull();
      expect(model.cards.map((card) => card.kind)).toEqual([
        'files',
        'lines',
        'tokens',
        'cost',
        'duration',
      ]);
    });

    it('turn with no files has no Files or Lines card, not a zero', () => {
      const model = build(
        snapshot({ diff: noFiles, runs: [run('nx test a', 'passed')] }),
      );
      expect(model.files).toBeNull();
      expect(model.lines).toBeNull();
      expect(model.cards.map((card) => card.kind)).toEqual([
        'tokens',
        'cost',
        'duration',
        'tests',
      ]);
    });

    it('keeps a Files card for a set whose files are all past the stored bound', () => {
      const model = build(
        snapshot({
          diff: {
            ...noFiles,
            truncatedCount: 600,
            totals: { files: 600, additions: 0, deletions: 0 },
          },
        }),
      );
      expect(model.files?.value).toBe(600);
      expect(model.files?.truncatedCount).toBe(600);
    });
  });

  describe('Tests card (ported from turn-tests-row.component.spec.ts)', () => {
    it('shows the right counts for a mixed list', () => {
      const model = build(
        snapshot({
          runs: [
            run('nx test chat', 'passed'),
            run('npx nx run-many -t lint,test', 'passed'),
            run('npx jest foo', 'failed'),
            run('pnpm vitest run', 'unknown'),
          ],
        }),
      );
      expect(model.tests?.label).toBe('2 passed, 1 failed, 1 unknown');
    });

    it('shows just "unknown" for an all-unknown list', () => {
      const model = build(
        snapshot({
          runs: [
            run('npx jest foo', 'unknown'),
            run('nx test chat', 'unknown'),
          ],
        }),
      );
      expect(model.tests?.label).toBe('unknown');
    });

    it('counts background runs as "N running in background"', () => {
      expect(
        turnTestsOutcomeLabel({
          total: 2,
          passed: 1,
          failed: 0,
          running: 1,
          unknown: 0,
        }),
      ).toBe('1 passed, 1 running in background');
      const model = build(snapshot({ runs: [run('nx test a', 'running')] }));
      expect(model.testsInBackground).toBe(true);
      expect(model.tests?.runs[0].outcomeName).toBe('running in background');
    });

    it('keeps unknown runs in a background outcome label', () => {
      expect(
        turnTestsOutcomeLabel({
          total: 2,
          passed: 0,
          failed: 0,
          running: 1,
          unknown: 1,
        }),
      ).toBe('1 running in background, 1 unknown');
    });

    it('lists each run in execution order as outcome word plus command', () => {
      const model = build(
        snapshot({
          runs: [
            run('nx test chat', 'failed'),
            run('npx jest foo', 'unknown'),
            run('pnpm vitest run', 'passed'),
          ],
        }),
      );
      expect(
        model.tests?.runs.map((row) => [row.label, row.project ?? row.command]),
      ).toEqual([
        ['failed', 'nx test chat'],
        ['unknown', 'npx jest foo'],
        ['passed', 'pnpm vitest run'],
      ]);
    });

    it.each(['passed', 'failed', 'unknown'] as const)(
      'spells the %s outcome as text, never colour alone',
      (outcome) => {
        const row = build(snapshot({ runs: [run('npx cmd', outcome)] })).tests
          ?.runs[0];
        expect(row?.label).toBe(outcome);
        expect(row?.outcomeName).toBe(outcome);
      },
    );

    it.each([
      ['passed', 'success'],
      ['failed', 'error'],
      ['running', 'info'],
      ['unknown', 'muted'],
    ] as const)('precomputes the %s row tone (%s)', (outcome, tone) => {
      const row = build(snapshot({ runs: [run('npx cmd', outcome)] })).tests
        ?.runs[0];
      expect(row?.tone).toBe(tone);
    });

    it('labels a run with its Nx project, keeps the full command and failure lines', () => {
      const failures = ['● chat › renders', 'Expected 1, received 2'];
      const row = build(
        snapshot({
          runs: [
            run('npx nx test chat --skip-nx-cache', 'failed', {
              project: 'chat',
              failures,
            }),
          ],
        }),
      ).tests?.runs[0];
      expect(row).toEqual({
        command: 'npx nx test chat --skip-nx-cache',
        project: 'chat',
        outcome: 'failed',
        label: 'chat',
        outcomeName: 'failed',
        tone: 'error',
        failures,
      });
    });

    it('marks an aborted turn "(incomplete)" only when told', () => {
      const runs = [run('nx test chat', 'failed')];
      const complete = build(snapshot({ runs }));
      expect(complete.incomplete).toBe(false);
      expect(complete.tests?.ariaLabel).toBe('Tests: 1 failed');

      const aborted = build(snapshot({ runs, incomplete: true }));
      expect(aborted.incomplete).toBe(true);
      expect(aborted.tests?.ariaLabel).toBe('Tests: 1 failed (incomplete)');
    });

    it('labels the section with the outcome (aria label carries incomplete)', () => {
      const model = build(
        snapshot({
          runs: [run('nx test chat', 'passed'), run('npx jest foo', 'failed')],
          incomplete: true,
        }),
      );
      expect(model.tests?.ariaLabel).toBe(
        'Tests: 1 passed, 1 failed (incomplete)',
      );
    });

    it('carries no file or +/- counts content in the Tests card', () => {
      const tests = build(
        snapshot({
          runs: [
            run('nx test chat', 'passed'),
            run('pnpm vitest run', 'failed'),
          ],
        }),
      ).tests;
      expect(JSON.stringify(tests)).not.toMatch(/[+-]\d+|src\//);
    });

    it('reads as failing (polarity bad, decision #51) only when a run failed', () => {
      expect(
        build(snapshot({ runs: [run('a', 'passed'), run('b', 'failed')] }))
          .tests?.polarity,
      ).toBe('bad');
      expect(
        build(snapshot({ runs: [run('a', 'passed'), run('b', 'unknown')] }))
          .tests?.polarity,
      ).toBe('good');
    });
  });

  describe('Files and Lines cards carry the change-set capabilities (R6.3, R6.8)', () => {
    it('carries the set for the Open file and Review actions, rows in recorded order', () => {
      const files = build(snapshot()).files;
      expect(files?.changeSet).toBe(changeSet);
      expect(files?.rows.map((row) => [row.file.path, row.counts])).toEqual([
        ['src/a.ts', '+40 −7'],
        ['src/b.ts', '+2'],
        ['src/c.ts', '+0 −0'],
      ]);
      expect(files?.rows[2].file.origPath).toBe('src/old-c.ts');
    });

    it('counts unavailable: files and lines read "unavailable", rows read "?"', () => {
      const model = build(
        snapshot({ diff: { ...changeSet, countsUnavailable: true } }),
      );
      expect(model.files?.value).toBe('unavailable');
      expect(model.files?.countsUnavailable).toBe(true);
      expect(model.lines).toEqual({
        kind: 'lines',
        additions: 'unavailable',
        deletions: 'unavailable',
        countsUnavailable: true,
      });
      expect(model.files?.rows.every((row) => row.counts === '?')).toBe(true);
    });

    it('null per-file counts read "?" and binary reads "binary"', () => {
      const rows = build(
        snapshot({
          diff: {
            ...changeSet,
            files: [
              { path: 'a.ts', status: 'M', additions: null, deletions: null },
              {
                path: 'logo.png',
                status: 'A',
                additions: null,
                deletions: null,
                binary: true,
              },
            ],
          },
        }),
      ).files?.rows;
      expect(rows?.map((row) => row.counts)).toEqual(['?', 'binary']);
    });

    it('carries baselineMissing and truncatedCount', () => {
      const files = build(
        snapshot({
          diff: { ...changeSet, baselineMissing: true, truncatedCount: 4 },
        }),
      ).files;
      expect(files?.baselineMissing).toBe(true);
      expect(files?.truncatedCount).toBe(4);
      expect(build(snapshot()).files?.baselineMissing).toBe(false);
    });

    it('applies conflicted and reconciled marks; conflicted wins', () => {
      const marks: TurnSummaryMarks = {
        conflicted: new Set(['src/a.ts']),
        reconciled: new Set(['src/a.ts', 'src/b.ts']),
      };
      const files = build(snapshot(), marks).files;
      expect(files?.rows.map((row) => row.state)).toEqual([
        'conflicted',
        'reconciled',
        'changed',
      ]);
      expect(files?.conflictedCount).toBe(1);
      expect(files?.reconciledCount).toBe(1);
    });

    it('treats absent marks as nothing conflicted or reconciled', () => {
      const files = build(snapshot()).files;
      expect(files?.rows.every((row) => row.state === 'changed')).toBe(true);
      expect(files?.conflictedCount).toBe(0);
    });
  });

  it('aborted turn without tests is still flagged incomplete (R6.3)', () => {
    expect(build(snapshot({ incomplete: true })).incomplete).toBe(true);
  });

  it('usage pending reads "pending" on Tokens, Cost and Duration', () => {
    const model = build(snapshot({ usage: 'pending' }));
    expect([
      model.tokens.input,
      model.tokens.output,
      model.cost.value,
      model.duration.value,
    ]).toEqual(['pending', 'pending', 'pending', 'pending']);
  });
});
