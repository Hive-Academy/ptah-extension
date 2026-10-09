import { convertPtahUi } from './ptah-ui-converter';
import { renderPtahUiBlock } from './ptah-ui-pipeline';
import { resolvePtahUi } from './ptah-ui-resolver';
import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';
import { SURFACE_LIMITS } from './surface-catalog';
import type { SurfaceContent } from './surface.types';

const snapshot: TurnSourceSnapshot = {
  state: 'terminal',
  incomplete: false,
  diff: {
    kind: 'available',
    changeSet: {
      sessionId: 's',
      workspaceRoot: 'w',
      turnStartedAt: 0,
      turnEndedAt: 1,
      files: [
        {
          path: 'a.ts',
          status: 'M',
          additions: null,
          deletions: null,
          binary: true,
        },
      ],
      truncatedCount: 2,
      totals: { files: 1, additions: 3, deletions: 1 },
      countsUnavailable: false,
      baselineMissing: true,
    },
  },
  tests: {
    kind: 'available',
    runs: [{ command: 'npm test', outcome: 'passed' }],
    summary: { total: 1, passed: 1, failed: 0, running: 0, unknown: 0 },
  },
  usage: {
    kind: 'available',
    input: 12,
    output: 8,
    cost: 0.5,
    durationMs: 1500,
  },
};

const bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;

function snapshotWithEmptyDiff(): TurnSourceSnapshot {
  const diff = snapshot.diff;
  if (diff.kind !== 'available') return snapshot;
  return {
    ...snapshot,
    diff: { kind: 'available', changeSet: { ...diff.changeSet, files: [] } },
  };
}

describe('resolvePtahUi', () => {
  it('formats host scalars and keeps literal rows separate', () => {
    const result = resolvePtahUi(
      convertPtahUi(
        {
          elements: [
            {
              kind: 'stats',
              items: [
                { label: 'Cost', value: { source: 'usage', field: 'cost' } },
                {
                  label: 'Duration',
                  value: { source: 'usage', field: 'duration' },
                },
              ],
            },
            { kind: 'table', columns: ['literal'], rows: [['kept']] },
            { kind: 'table', source: 'diff', columns: ['path', 'additions'] },
          ],
        },
        'surface',
      ),
      snapshot,
    );
    expect(surfaceOf(result).components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'stat', value: '$0.50' }),
        expect.objectContaining({ kind: 'stat', value: '1.5s' }),
        expect.objectContaining({ kind: 'table', id: 'c2', rows: [['kept']] }),
        expect.objectContaining({
          kind: 'table',
          id: 'c3',
          rows: [['a.ts', 'binary']],
          description: { text: '+2 more; may include earlier changes' },
        }),
      ]),
    );
  });

  it.each(['diff', 'tests', 'usage'] as const)(
    'renders every null-snapshot source as unavailable: %s',
    (source) => {
      const result = resolvePtahUi(
        convertPtahUi(
          {
            elements: [
              {
                kind: 'stats',
                items: [
                  {
                    label: 'Value',
                    value: {
                      source,
                      field:
                        source === 'diff'
                          ? 'files'
                          : source === 'tests'
                            ? 'total'
                            : 'cost',
                    },
                  },
                ],
              },
            ],
          },
          'surface',
        ),
        null,
      );
      expect(surfaceOf(result).components[0]).toMatchObject({
        value: 'unavailable',
      });
    },
  );

  it('renders pending values as pending, never a numeric substitute', () => {
    const pending: TurnSourceSnapshot = {
      ...snapshot,
      state: 'pending',
      diff: { kind: 'pending' },
      tests: { kind: 'pending' },
      usage: { kind: 'pending' },
    };
    const result = resolvePtahUi(
      convertPtahUi(
        {
          elements: [
            {
              kind: 'stats',
              items: [
                { label: 'Files', value: { source: 'diff', field: 'files' } },
              ],
            },
          ],
        },
        'surface',
      ),
      pending,
    );
    expect(surfaceOf(result).components[0]).toMatchObject({ value: 'pending' });
  });

  it('truncates an over-limit host test command without rejecting the block', () => {
    const command = 'c'.repeat(SURFACE_LIMITS.maxStringLength + 1);
    const result = renderPtahUiBlock('table $tests\n', {
      surfaceId: 'surface',
      snapshot: {
        ...snapshot,
        tests: {
          kind: 'available',
          runs: [{ command, outcome: 'passed' }],
          summary: { total: 1, passed: 1, failed: 0, running: 0, unknown: 0 },
        },
      },
      countBytes: bytes,
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).toContain(
      `${'c'.repeat(SURFACE_LIMITS.maxStringLength - 1)}…`,
    );
  });

  it('truncates an over-limit host path without rejecting the block', () => {
    const path = 'p'.repeat(SURFACE_LIMITS.maxStringLength + 1);
    const result = renderPtahUiBlock('table $diff\n', {
      surfaceId: 'surface',
      snapshot: {
        ...snapshot,
        diff: {
          kind: 'available',
          changeSet: {
            sessionId: 's',
            workspaceRoot: 'w',
            turnStartedAt: 0,
            turnEndedAt: 1,
            files: [
              {
                path,
                status: 'M',
                additions: 1,
                deletions: 0,
                binary: false,
              },
            ],
            truncatedCount: 0,
            totals: { files: 1, additions: 1, deletions: 0 },
            countsUnavailable: false,
            baselineMissing: false,
          },
        },
      },
      countBytes: bytes,
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).toContain(
      `${'p'.repeat(SURFACE_LIMITS.maxStringLength - 1)}…`,
    );
  });

  it.each([
    [
      'pending',
      {
        ...snapshot,
        state: 'pending' as const,
        diff: { kind: 'pending' as const },
      },
      'pending',
    ],
    [
      'unavailable',
      { ...snapshot, diff: { kind: 'unavailable' as const } },
      'unavailable',
    ],
    ['empty', snapshotWithEmptyDiff(), 'No files changed this turn'],
  ] as const)(
    'keeps a %s source-table state surface-valid',
    (_state, sourceSnapshot, expected) => {
      const result = renderPtahUiBlock('table $diff\n', {
        surfaceId: 'surface',
        snapshot: sourceSnapshot,
        countBytes: bytes,
      });
      expect(result).toMatchObject({ ok: true });
      expect(JSON.stringify(result)).toContain(expected);
    },
  );

  it('rejects a rowless usage table instead of resolving it as a list', () => {
    const result = renderPtahUiBlock('table $usage\n', {
      surfaceId: 'surface',
      snapshot,
      countBytes: bytes,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'source `usage` has no columns (line 1)',
    });
  });
});

function surfaceOf(content: SurfaceContent) {
  if (content.contract !== 'dashboard-spec/2')
    throw new Error('expected dashboard-spec/2');
  return content.surface;
}

describe('renderPtahUiBlock', () => {
  it('returns validated SurfaceContent and reports parser failures', () => {
    expect(
      renderPtahUiBlock('stats\n  Files | $diff.files\n', {
        surfaceId: 'surface',
        snapshot: null,
        countBytes: bytes,
      }).ok,
    ).toBe(true);
    expect(
      renderPtahUiBlock('gauge nope\n', {
        surfaceId: 'surface',
        snapshot: null,
        countBytes: bytes,
      }),
    ).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});
