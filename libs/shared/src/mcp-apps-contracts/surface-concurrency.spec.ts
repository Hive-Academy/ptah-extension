import { SURFACE_LIMITS } from './surface-catalog';
import {
  appendWrite,
  checkSurfaceConflict,
  createSurfaceWriteLog,
  surfaceOpsFootprint,
} from './surface-concurrency';
import type {
  SurfaceConflictMutation,
  SurfaceWriteFootprint,
  SurfaceWriteLog,
} from './surface-concurrency';

/** A surface created at revision 10 with the given later writes (11, 12, ...). */
function logWith(...footprints: SurfaceWriteFootprint[]): SurfaceWriteLog {
  return footprints.reduce(
    (log, footprint, index) =>
      appendWrite(log, { revision: 11 + index, footprint }),
    createSurfaceWriteLog(10),
  );
}
const data = (...paths: string[]): SurfaceWriteFootprint => ({
  kind: 'data',
  paths,
});
const change = (path: string): SurfaceConflictMutation => ({
  kind: 'ui-change',
  path,
});

describe('footprints', () => {
  it('derives the footprint a committed op list writes', () => {
    expect(
      surfaceOpsFootprint([
        { op: 'set-data', path: 'a', value: 1 },
        { op: 'remove-data', path: 'b' },
        { op: 'set-data', path: 'a', value: 2 },
      ]),
    ).toEqual({ kind: 'data', paths: ['a', 'b'] });
    expect(
      surfaceOpsFootprint([
        { op: 'set-data', path: 'a', value: 1 },
        { op: 'set-title', title: { text: 'T' } },
      ]),
    ).toEqual({ kind: 'structure' });
    expect(
      surfaceOpsFootprint([{ op: 'remove-component', componentId: 'x' }]),
    ).toEqual({ kind: 'structure' });
    expect(
      surfaceOpsFootprint([{ op: 'set-selection', selection: null }]),
    ).toEqual({ kind: 'selection' });
  });

  it('fails closed on a mixed or empty op list by recording structure', () => {
    expect(
      surfaceOpsFootprint([
        { op: 'set-data', path: 'a', value: 1 },
        { op: 'set-selection', selection: null },
      ]),
    ).toEqual({ kind: 'structure' });
    expect(surfaceOpsFootprint([])).toEqual({ kind: 'structure' });
  });
});

describe('write log bounds', () => {
  it(`keeps ${SURFACE_LIMITS.maxWriteLogPathsPerEntry} paths and collapses one more to data:*`, () => {
    const at = Array.from(
      { length: SURFACE_LIMITS.maxWriteLogPathsPerEntry },
      (_v, i) => `p${i}`,
    );
    expect(logWith(data(...at)).entries[0].footprint).toEqual(data(...at));
    expect(logWith(data(...at, 'extra')).entries[0].footprint).toEqual({
      kind: 'data-wildcard',
    });
  });

  it(`keeps ${SURFACE_LIMITS.maxWriteLogEntries} entries, and one more raises the floor`, () => {
    const full = logWith(
      ...Array.from({ length: SURFACE_LIMITS.maxWriteLogEntries }, () =>
        data('x'),
      ),
    );
    expect(full.entries).toHaveLength(SURFACE_LIMITS.maxWriteLogEntries);
    expect(full.floor).toBe(10);
    const over = appendWrite(full, { revision: 43, footprint: data('x') });
    expect(over.entries).toHaveLength(SURFACE_LIMITS.maxWriteLogEntries);
    expect(over.entries[0].revision).toBe(12);
    expect(over.floor).toBe(11);
    expect(full.entries).toHaveLength(SURFACE_LIMITS.maxWriteLogEntries);
  });

  it('treats a base below the floor as stale, and the floor itself as provable', () => {
    const log: SurfaceWriteLog = { floor: 20, entries: [] };
    expect(checkSurfaceConflict(log, 25, 19, change('a'))).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 25,
    });
    expect(checkSurfaceConflict(log, 25, 20, change('a')).ok).toBe(true);
    expect(checkSurfaceConflict(log, 25, 19, { kind: 'ui-select' }).ok).toBe(
      false,
    );
  });
});

describe('Q4 conflict table', () => {
  it('pins the intended asymmetry between agent patches and UI changes', () => {
    const log = logWith(data('form.email'));
    // Disjoint path, old base: the agent is rejected, the UI change is accepted.
    expect(checkSurfaceConflict(log, 11, 10, { kind: 'agent' })).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 11,
    });
    expect(checkSurfaceConflict(log, 11, 10, change('form.name'))).toEqual({
      ok: true,
    });
  });

  it('requires the exact current base for agent mutations and submit', () => {
    const log = logWith(data('a'), { kind: 'selection' });
    for (const kind of ['agent', 'submit'] as const) {
      expect(checkSurfaceConflict(log, 12, 12, { kind }).ok).toBe(true);
      const stale = checkSurfaceConflict(log, 12, 11, { kind });
      expect(stale).toMatchObject({ ok: false, currentRevision: 12 });
      if (!stale.ok) expect(stale.detail).toContain('Current revision is 12');
    }
  });

  it('always accepts a v1 proposal, which has no base', () => {
    const log = logWith({ kind: 'structure' });
    expect(
      checkSurfaceConflict(log, 11, null, { kind: 'v1-proposal' }),
    ).toEqual({ ok: true });
  });

  it.each<[string, SurfaceWriteFootprint, boolean]>([
    ['the same path', data('form.name'), false],
    ['an ancestor path', data('form'), false],
    ['a descendant path', data('form.name.first'), false],
    ['a sibling sharing a prefix', data('form.names'), true],
    ['a disjoint path', data('other'), true],
    ['data:*', { kind: 'data-wildcard' }, false],
    ['structure', { kind: 'structure' }, false],
    ['a selection', { kind: 'selection' }, true],
    ['a submit record', { kind: 'submit-record' }, true],
  ])('a UI change at form.name after %s: accepted=%s', (_l, footprint, ok) => {
    expect(
      checkSurfaceConflict(logWith(footprint), 11, 10, change('form.name')).ok,
    ).toBe(ok);
  });

  it.each<[string, SurfaceWriteFootprint, boolean]>([
    ['structure', { kind: 'structure' }, false],
    ['a selection', { kind: 'selection' }, false],
    ['data', data('form.name'), true],
    ['data:*', { kind: 'data-wildcard' }, true],
    ['a submit record', { kind: 'submit-record' }, true],
  ])('a UI select after %s: accepted=%s', (_l, footprint, ok) => {
    expect(
      checkSurfaceConflict(logWith(footprint), 11, 10, { kind: 'ui-select' })
        .ok,
    ).toBe(ok);
  });

  it('ignores writes at or below the base', () => {
    const log = logWith({ kind: 'structure' }, data('other'));
    expect(checkSurfaceConflict(log, 12, 11, change('form.name')).ok).toBe(
      true,
    );
    expect(checkSurfaceConflict(log, 12, 10, change('form.name')).ok).toBe(
      false,
    );
  });

  it.each([
    ['newer than the stored revision', 13],
    ['missing', null],
    ['not an integer', 11.5],
  ])('rejects a base that is %s', (_l, base) => {
    expect(
      checkSurfaceConflict(logWith(data('x')), 12, base, change('form.name')),
    ).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 12,
    });
  });

  it('names the conflicting write in the detail', () => {
    const result = checkSurfaceConflict(
      logWith(data('form')),
      11,
      10,
      change('form.name'),
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok)
      expect(result.detail).toContain('Revision 11 wrote data at "form"');
  });
});
