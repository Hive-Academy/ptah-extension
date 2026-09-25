import type { SurfaceInteractionState } from '@ptah-extension/declarative-dashboard';
import { AppsOperationOverlays } from './apps-operation-overlays';
import type { SurfaceValueOverlayInput } from './apps-operation-overlays';

function overlay(
  operationId: string,
  path: string,
  value: string,
  baseRevision = 1,
): SurfaceValueOverlayInput {
  return { operationId, path, value, baseRevision };
}

describe('AppsOperationOverlays', () => {
  it('starts empty', () => {
    const overlays = AppsOperationOverlays.empty();
    expect(overlays.size).toBe(0);
    expect(overlays.list()).toEqual([]);
    expect(overlays.pendingValues().size).toBe(0);
  });

  it('keeps overlays keyed by operation id in send order', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'settings.name', 'Alice'))
      .add(overlay('op-b', 'settings.city', 'Berlin'))
      .add(overlay('op-c', 'settings.name', 'Alicia', 2));
    expect(overlays.list().map((entry) => entry.operationId)).toEqual([
      'op-a',
      'op-b',
      'op-c',
    ]);
    expect(overlays.get('op-b')).toMatchObject({
      path: 'settings.city',
      value: 'Berlin',
      baseRevision: 1,
      settledRevision: null,
    });
    expect(overlays.has('op-c')).toBe(true);
    expect(overlays.has('op-d')).toBe(false);
  });

  it('shows the latest unretired overlay per path, several inputs may share a path', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'settings.name', 'Alice'))
      .add(overlay('op-b', 'settings.city', 'Berlin'))
      .add(overlay('op-c', 'settings.name', 'Alicia', 2));
    const pending = overlays.pendingValues();
    expect(pending.size).toBe(2);
    expect(pending.get('settings.name')).toBe('Alicia');
    expect(pending.get('settings.city')).toBe('Berlin');
  });

  it('retires exactly one overlay and reveals the older value for the path', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'settings.name', 'Alice'))
      .add(overlay('op-c', 'settings.name', 'Alicia', 2));
    const retired = overlays.retire('op-c');
    expect(retired.size).toBe(1);
    expect(retired.has('op-c')).toBe(false);
    expect(retired.pendingValues().get('settings.name')).toBe('Alice');
    // The source structure is unchanged.
    expect(overlays.has('op-c')).toBe(true);
    // An unknown operation id retires nothing.
    expect(overlays.retire('op-missing').size).toBe(2);
  });

  it('keeps a settled older overlay displayed until the echo or a read retires it', () => {
    // Reconciliation case 6: A (older) settles while B (newer) is pending on
    // the same path. A retires; B stays and the input shows B's value.
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'settings.name', 'Alice', 1))
      .add(overlay('op-b', 'settings.name', 'Alicia', 2));
    const settled = overlays.settle('op-a', 2);
    expect(settled.get('op-a')?.settledRevision).toBe(2);
    expect(settled.get('op-b')?.settledRevision).toBeNull();
    // Settling does not retire: the newer overlay still wins the display.
    expect(settled.pendingValues().get('settings.name')).toBe('Alicia');

    const echoRetired = settled.retireSettledUpTo(2);
    expect(echoRetired.has('op-a')).toBe(false);
    expect(echoRetired.has('op-b')).toBe(true);
    expect(echoRetired.pendingValues().get('settings.name')).toBe('Alicia');

    const bSettled = echoRetired.settle('op-b', 3);
    const readRetired = bSettled.retireAllSettled();
    expect(readRetired.size).toBe(0);
    expect(readRetired.pendingValues().size).toBe(0);
  });

  it('retireSettledUpTo retires only settled overlays at or below the revision', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'p.one', 'a'))
      .add(overlay('op-b', 'p.two', 'b'))
      .add(overlay('op-c', 'p.three', 'c'))
      .settle('op-a', 5)
      .settle('op-b', 6);
    const retired = overlays.retireSettledUpTo(5);
    expect(retired.has('op-a')).toBe(false);
    expect(retired.has('op-b')).toBe(true);
    expect(retired.has('op-c')).toBe(true);
    // Nothing was settled at or below 4.
    expect(overlays.retireSettledUpTo(4).size).toBe(3);
    // The source structure keeps all three.
    expect(overlays.size).toBe(3);
  });

  it('retireAllSettled keeps pending overlays for a later settle', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'p.one', 'a'))
      .add(overlay('op-b', 'p.two', 'b'))
      .settle('op-a', 4)
      .retireAllSettled();
    expect(overlays.has('op-a')).toBe(false);
    expect(overlays.has('op-b')).toBe(true);
    const settledLater = overlays.settle('op-b', 7);
    expect(settledLater.get('op-b')?.settledRevision).toBe(7);
  });

  it('never throws: invalid overlays, unknown ids and non-finite revisions change nothing', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'p.one', 'a'));
    const unchanged = [
      overlays.add(null as unknown as SurfaceValueOverlayInput),
      overlays.add({ ...overlay('', 'p', 'v'), operationId: '' }),
      overlays.add({ ...overlay('op-x', '', 'v'), path: '' }),
      overlays.add({
        ...overlay('op-x', 'p', 'v'),
        baseRevision: Number.NaN,
      }),
      overlays.add(overlay('op-a', 'p.one', 'duplicate')),
      overlays.settle('op-missing', 2),
      overlays.settle('op-a', Number.NaN),
      overlays.retireSettledUpTo(Number.NaN),
      overlays.retireSettledUpTo(Number.POSITIVE_INFINITY),
    ];
    for (const candidate of unchanged) {
      expect(candidate.size).toBe(1);
      expect(candidate.list()).toEqual(overlays.list());
    }
  });

  it('settles an operation once; a second settle changes nothing', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'p.one', 'a'));
    const first = overlays.settle('op-a', 2);
    expect(first.get('op-a')?.settledRevision).toBe(2);
    expect(first.settle('op-a', 9).get('op-a')?.settledRevision).toBe(2);
  });

  it('is immutable: every operation leaves the source structure untouched', () => {
    const empty = AppsOperationOverlays.empty();
    const added = empty.add(overlay('op-a', 'p.one', 'a'));
    expect(empty.size).toBe(0);
    const settled = added.settle('op-a', 2);
    expect(added.get('op-a')?.settledRevision).toBeNull();
    expect(settled.get('op-a')?.settledRevision).toBe(2);
    const retired = settled.retire('op-a');
    expect(settled.has('op-a')).toBe(true);
    expect(retired.size).toBe(0);
    // A retired structure is not resurrected by a later operation on a twin.
    expect(retired.add(overlay('op-b', 'p.one', 'b')).has('op-a')).toBe(false);
  });

  it('feeds SurfaceInteractionState.pendingValues without conversion', () => {
    const overlays = AppsOperationOverlays.empty()
      .add(overlay('op-a', 'settings.name', 'Alice'))
      .add(overlay('op-b', 'settings.count', '0'));
    const interaction: Pick<SurfaceInteractionState, 'pendingValues'> = {
      pendingValues: overlays.pendingValues(),
    };
    expect(interaction.pendingValues.get('settings.name')).toBe('Alice');
    expect(interaction.pendingValues.get('settings.count')).toBe('0');
  });

  it('overlays any SurfaceDataValue kind, including null and structured values', () => {
    const overlays = AppsOperationOverlays.empty()
      .add({ operationId: 'op-a', path: 'select', value: null, baseRevision: 1 })
      .add({
        operationId: 'op-b',
        path: 'rows',
        value: [1, 'two', false],
        baseRevision: 1,
      })
      .add({
        operationId: 'op-c',
        path: 'flags',
        value: { enabled: true },
        baseRevision: 1,
      });
    const pending = overlays.pendingValues();
    expect(pending.get('select')).toBeNull();
    expect(pending.get('rows')).toEqual([1, 'two', false]);
    expect(pending.get('flags')).toEqual({ enabled: true });
  });
});