import { convertPtahUi } from './ptah-ui-converter';
import { renderPtahUiBlock } from './ptah-ui-pipeline';
import { resolvePtahUi } from './ptah-ui-resolver';
import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';
import type { SurfaceContent } from './surface.types';

const snapshot: TurnSourceSnapshot = {
  state: 'terminal', incomplete: false,
  diff: { kind: 'available', changeSet: { sessionId: 's', workspaceRoot: 'w', turnStartedAt: 0, turnEndedAt: 1, files: [{ path: 'a.ts', status: 'M', additions: null, deletions: null, binary: true }], truncatedCount: 2, totals: { files: 1, additions: 3, deletions: 1 }, countsUnavailable: false, baselineMissing: true } },
  tests: { kind: 'available', runs: [{ command: 'npm test', outcome: 'passed' }], summary: { total: 1, passed: 1, failed: 0, unknown: 0 } },
  usage: { kind: 'available', input: 12, output: 8, cost: 0.5, durationMs: 1500 },
};

describe('resolvePtahUi', () => {
  it('formats host scalars and keeps literal rows separate', () => {
    const result = resolvePtahUi(convertPtahUi({ elements: [
      { kind: 'stats', items: [{ label: 'Cost', value: { source: 'usage', field: 'cost' } }, { label: 'Duration', value: { source: 'usage', field: 'duration' } }] },
      { kind: 'table', columns: ['literal'], rows: [['kept']] },
      { kind: 'table', source: 'diff', columns: ['path', 'additions'] },
    ] }, 'surface'), snapshot);
    expect(surfaceOf(result).components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'stat', value: '$0.50' }),
      expect.objectContaining({ kind: 'stat', value: '1.5s' }),
      expect.objectContaining({ kind: 'table', id: 'c2', rows: [['kept']] }),
      expect.objectContaining({ kind: 'table', id: 'c3', rows: [['a.ts', 'binary']], description: { text: '+2 more; may include earlier changes' } }),
    ]));
  });

  it.each(['diff', 'tests', 'usage'] as const)('renders every null-snapshot source as unavailable: %s', (source) => {
    const result = resolvePtahUi(convertPtahUi({ elements: [{ kind: 'stats', items: [{ label: 'Value', value: { source, field: source === 'diff' ? 'files' : source === 'tests' ? 'total' : 'cost' } }] }] }, 'surface'), null);
    expect(surfaceOf(result).components[0]).toMatchObject({ value: 'unavailable' });
  });

  it('renders pending values as pending, never a numeric substitute', () => {
    const pending: TurnSourceSnapshot = { ...snapshot, state: 'pending', diff: { kind: 'pending' }, tests: { kind: 'pending' }, usage: { kind: 'pending' } };
    const result = resolvePtahUi(convertPtahUi({ elements: [{ kind: 'stats', items: [{ label: 'Files', value: { source: 'diff', field: 'files' } }] }] }, 'surface'), pending);
    expect(surfaceOf(result).components[0]).toMatchObject({ value: 'pending' });
  });
});

function surfaceOf(content: SurfaceContent) {
  if (content.contract !== 'dashboard-spec/2') throw new Error('expected dashboard-spec/2');
  return content.surface;
}

describe('renderPtahUiBlock', () => {
  const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
  it('returns validated SurfaceContent and reports parser failures', () => {
    expect(renderPtahUiBlock('stats\n  Files | $diff.files\n', { surfaceId: 'surface', snapshot: null, countBytes: bytes }).ok).toBe(true);
    expect(renderPtahUiBlock('gauge nope\n', { surfaceId: 'surface', snapshot: null, countBytes: bytes })).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});
