import { SURFACE_STORE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceDataModel,
  SurfaceSelection,
  SurfaceStateOp,
  SurfaceStateView,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { makeTable } from '@ptah-extension/shared/testing';
import {
  APPS_EVICTED_NOTICE,
  activateSurface,
  applySurfacePush,
  applySurfaceRead,
  createAppsSurfaceState,
  surfaceReadSeq,
  updateSurfaceOverlays,
} from './apps-surface-reducer';
import type {
  AppsSurfaceEntry,
  AppsSurfaceState,
} from './apps-surface-reducer';

const TABLE_ID = makeTable(3, 2).id;
const nameInput: SurfaceComponent = {
  kind: 'text',
  id: 'name',
  label: 'Name',
  path: 'form.name',
};

/** The v2 member of the content union: every fixture here is a v2 document. */
type SurfaceContentV2 = Extract<
  SurfaceContent,
  { contract: 'dashboard-spec/2' }
>;

function content(
  name = 'Ada',
  title = 'Profile',
  surfaceId = 'profile',
): SurfaceContentV2 {
  const dataModel: SurfaceDataModel = { form: { name } };
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: title },
      components: [makeTable(3, 2) as SurfaceComponent, nameInput],
    },
    dataModel,
  };
}

function stateView(
  surfaceId: string,
  revision: number,
  body: SurfaceContent = content('Ada', 'Profile', surfaceId),
  selection: SurfaceSelection | null = null,
): SurfaceStateView {
  return { surfaceId, revision, content: body, selection, lastSubmit: null };
}

function snapshot(
  surfaceId: string,
  revision: number,
  options: {
    origin?: 'agent' | 'ui' | 'host';
    body?: SurfaceContent;
    selection?: SurfaceSelection | null;
  } = {},
) {
  return {
    routingId: 'tab-1',
    surfaceId,
    revision,
    origin: options.origin ?? 'agent',
    change: {
      kind: 'snapshot',
      state: stateView(
        surfaceId,
        revision,
        options.body ?? content('Ada', 'Profile', surfaceId),
        options.selection ?? null,
      ),
    },
  };
}

function opsPush(
  surfaceId: string,
  fromRevision: number,
  revision: number,
  ops: readonly SurfaceStateOp[],
  origin: 'agent' | 'ui' | 'host' = 'ui',
) {
  return {
    routingId: 'tab-1',
    surfaceId,
    revision,
    origin,
    change: { kind: 'ops', fromRevision, ops },
  };
}

function deletedPush(
  surfaceId: string,
  revision: number,
  reason: 'agent-deleted' | 'evicted',
) {
  return {
    routingId: 'tab-1',
    surfaceId,
    revision,
    origin: reason === 'evicted' ? 'host' : 'agent',
    change: { kind: 'deleted', reason },
  };
}

const setName = (value: unknown): SurfaceStateOp =>
  ({ op: 'set-data', path: 'form.name', value }) as SurfaceStateOp;

function found(...surfaces: SurfaceStateView[]) {
  return { status: 'found', routingId: 'tab-1', surfaces };
}

/** Applies pushes in order, asserting each one was applied. */
function build(...pushes: unknown[]): AppsSurfaceState {
  return pushes.reduce<AppsSurfaceState>((state, push) => {
    const next = applySurfacePush(state, push);
    expect(next.outcome).toBe('applied');
    return next.state;
  }, createAppsSurfaceState());
}

function entry(state: AppsSurfaceState, surfaceId: string): AppsSurfaceEntry {
  const held = state.entries.get(surfaceId);
  if (held === undefined) throw new Error(`no entry ${surfaceId}`);
  return held;
}

function shownName(state: AppsSurfaceState, surfaceId: string): unknown {
  const renderable = entry(state, surfaceId).renderable;
  if (renderable.status !== 'accepted') return undefined;
  const body = renderable.content;
  if (body.contract !== 'dashboard-spec/2') return undefined;
  const form = body.dataModel['form'] as Record<string, unknown>;
  return form['name'];
}

function withViewState(
  state: AppsSurfaceState,
  surfaceId: string,
): AppsSurfaceState {
  const entries = new Map(state.entries);
  entries.set(surfaceId, {
    ...entry(state, surfaceId),
    viewState: {
      components: { [TABLE_ID]: { page: 2, filter: 'slow' } },
      drafts: { name: 'draft' },
    },
  });
  return { ...state, entries };
}

describe('apps-surface-reducer', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('snapshot', () => {
    it('creates the surface at its revision and makes an agent surface active', () => {
      const result = applySurfacePush(
        createAppsSurfaceState(),
        snapshot('profile', 3),
      );
      expect(result).toMatchObject({ outcome: 'applied', needsRead: false });
      expect(entry(result.state, 'profile')).toMatchObject({
        materializedRevision: 3,
        renderable: { status: 'accepted' },
        lastAppliedSeq: 1,
      });
      expect(result.state.activeSurfaceId).toBe('profile');
    });

    it('replaces the document atomically and resets view state from the pushed state', () => {
      const selection: SurfaceSelection = {
        componentId: TABLE_ID,
        target: { kind: 'table-row', rowIndex: 1 },
      };
      const before = withViewState(
        build(snapshot('profile', 3, { selection })),
        'profile',
      );
      const replaced = applySurfacePush(
        before,
        snapshot('profile', 4, { body: content('Grace', 'Replaced') }),
      );
      expect(replaced.outcome).toBe('applied');
      const held = entry(replaced.state, 'profile');
      expect(held.materializedRevision).toBe(4);
      expect(held.renderable).toEqual({
        status: 'accepted',
        content: content('Grace', 'Replaced'),
        selection: null,
        lastSubmit: null,
      });
      expect(held.viewState).toEqual({ components: {}, drafts: {} });
      // The previous state object is untouched (pure).
      expect(entry(before, 'profile').viewState.drafts).toEqual({
        name: 'draft',
      });
    });

    it('discards a snapshot at or below the materialized revision', () => {
      const state = build(snapshot('profile', 5));
      const same = applySurfacePush(state, snapshot('profile', 5));
      const older = applySurfacePush(state, snapshot('profile', 4));
      expect(same).toEqual({ state, outcome: 'stale', needsRead: false });
      expect(older).toEqual({ state, outcome: 'stale', needsRead: false });
    });

    it('advances the revision on a rejected document and shows the fallback without a read', () => {
      const state = build(snapshot('profile', 3));
      const broken = {
        ...content(),
        surface: { ...content().surface, schemaVersion: 'dashboard-spec/3' },
      } as unknown as SurfaceContent;
      const result = applySurfacePush(
        state,
        snapshot('profile', 4, { body: broken }),
      );
      expect(result).toMatchObject({ outcome: 'applied', needsRead: false });
      expect(entry(result.state, 'profile')).toMatchObject({
        materializedRevision: 4,
        renderable: { status: 'rejected' },
      });
    });

    it('does not steal the active surface for a non-agent snapshot', () => {
      const state = build(
        snapshot('a', 1),
        snapshot('b', 2, { origin: 'host' }),
      );
      expect(state.activeSurfaceId).toBe('a');
    });

    it('changes nothing for a malformed push', () => {
      const state = build(snapshot('profile', 3));
      expect(applySurfacePush(state, { routingId: 'tab-1' })).toEqual({
        state,
        outcome: 'malformed',
        needsRead: false,
      });
    });
  });

  describe('manual pick (B15 coordinator ruling)', () => {
    it('a pick records pickedSurfaceId; an unknown id changes nothing', () => {
      const state = build(snapshot('a', 1), snapshot('b', 1));
      expect(state.pickedSurfaceId).toBeNull();
      const picked = activateSurface(state, 'a');
      expect(picked).toMatchObject({
        activeSurfaceId: 'a',
        pickedSurfaceId: 'a',
      });
      expect(activateSurface(picked, 'a')).toBe(picked);
      expect(activateSurface(picked, 'zzz')).toBe(picked);
      // Picking the surface that is already active still pins it.
      expect(activateSurface(state, 'b').pickedSurfaceId).toBe('b');
    });

    it('agent updates and new agent surfaces never move a pick', () => {
      const picked = activateSurface(
        build(snapshot('a', 1), snapshot('b', 1)),
        'a',
      );
      const updated = applySurfacePush(picked, snapshot('b', 2)).state;
      expect(updated.activeSurfaceId).toBe('a');
      const created = applySurfacePush(updated, snapshot('c', 1)).state;
      expect(created).toMatchObject({
        activeSurfaceId: 'a',
        pickedSurfaceId: 'a',
      });
    });

    it('without a pick, a new agent surface activates and an agent update to a held one does not', () => {
      const state = build(snapshot('a', 1), snapshot('b', 1));
      expect(state.activeSurfaceId).toBe('b');
      const updated = applySurfacePush(state, snapshot('a', 2)).state;
      expect(updated.activeSurfaceId).toBe('b');
      expect(
        applySurfacePush(updated, snapshot('c', 1)).state.activeSurfaceId,
      ).toBe('c');
    });

    it('an eviction or agent delete of the picked surface clears the pick and falls back to the most recent', () => {
      const picked = activateSurface(
        build(snapshot('a', 1), snapshot('b', 1), snapshot('c', 1)),
        'a',
      );
      for (const reason of ['evicted', 'agent-deleted'] as const) {
        const removed = applySurfacePush(
          picked,
          deletedPush('a', 2, reason),
        ).state;
        expect(removed).toMatchObject({
          activeSurfaceId: 'c',
          pickedSurfaceId: null,
        });
      }
      // Removing another surface keeps the pick.
      expect(
        applySurfacePush(picked, deletedPush('b', 2, 'evicted')).state,
      ).toMatchObject({ activeSurfaceId: 'a', pickedSurfaceId: 'a' });
    });

    it('a read that drops the picked surface clears the pick; one that keeps it keeps it', () => {
      const picked = activateSurface(
        build(snapshot('a', 1), snapshot('b', 2)),
        'a',
      );
      const readSeq = surfaceReadSeq(picked);
      const dropped = applySurfaceRead(
        picked,
        found(stateView('b', 2)),
        readSeq,
      ).state;
      expect(dropped).toMatchObject({
        activeSurfaceId: 'b',
        pickedSurfaceId: null,
      });
      const kept = applySurfaceRead(
        picked,
        found(stateView('a', 1), stateView('b', 3)),
        readSeq,
      ).state;
      expect(kept).toMatchObject({
        activeSurfaceId: 'a',
        pickedSurfaceId: 'a',
      });
    });
  });

  describe('ops', () => {
    it('applies ops only from a matching fromRevision and keeps view state', () => {
      const state = withViewState(build(snapshot('profile', 3)), 'profile');
      const result = applySurfacePush(
        state,
        opsPush('profile', 3, 4, [setName('Grace')]),
      );
      expect(result).toMatchObject({ outcome: 'applied', needsRead: false });
      expect(entry(result.state, 'profile').materializedRevision).toBe(4);
      expect(shownName(result.state, 'profile')).toBe('Grace');
      expect(entry(result.state, 'profile').viewState.drafts).toEqual({
        name: 'draft',
      });
    });

    it('returns needsRead on a fromRevision gap and changes nothing', () => {
      const state = build(snapshot('profile', 3));
      const result = applySurfacePush(
        state,
        opsPush('profile', 4, 5, [setName('Grace')]),
      );
      expect(result).toEqual({ state, outcome: 'gap', needsRead: true });
    });

    it('discards ops at or below the materialized revision', () => {
      const state = build(snapshot('profile', 3));
      expect(
        applySurfacePush(state, opsPush('profile', 2, 3, [setName('Old')])),
      ).toEqual({ state, outcome: 'stale', needsRead: false });
    });

    it('returns needsRead when the ops cannot be applied', () => {
      const state = build(snapshot('profile', 3));
      const result = applySurfacePush(
        state,
        opsPush('profile', 3, 4, [
          { op: 'remove-component', componentId: 'missing' },
        ]),
      );
      expect(result).toEqual({ state, outcome: 'ops-failed', needsRead: true });
    });

    it('falls back to the text view when the post-ops document fails re-validation', () => {
      const state = build(snapshot('profile', 3));
      const result = applySurfacePush(
        state,
        opsPush('profile', 3, 4, [setName(42)]),
      );
      expect(result).toMatchObject({ outcome: 'applied', needsRead: false });
      expect(entry(result.state, 'profile')).toMatchObject({
        materializedRevision: 4,
        renderable: { status: 'rejected' },
      });
    });

    it('applies a selection op and clears it when a later op removes its target', () => {
      const selection: SurfaceSelection = {
        componentId: TABLE_ID,
        target: { kind: 'table-row', rowIndex: 0 },
      };
      const selected = build(
        snapshot('profile', 3),
        opsPush('profile', 3, 4, [{ op: 'set-selection', selection }]),
      );
      expect(entry(selected, 'profile').renderable).toMatchObject({
        selection,
      });
      const removed = applySurfacePush(
        selected,
        opsPush('profile', 4, 5, [
          { op: 'remove-component', componentId: TABLE_ID },
        ]),
      );
      expect(entry(removed.state, 'profile').renderable).toMatchObject({
        status: 'accepted',
        selection: null,
      });
    });

    it('asks for a read for ops on an unknown or rejected surface', () => {
      const empty = createAppsSurfaceState();
      expect(
        applySurfacePush(empty, opsPush('ghost', 1, 2, [setName('x')])),
      ).toEqual({ state: empty, outcome: 'unknown-surface', needsRead: true });

      const broken = {
        ...content(),
        dataModel: { form: { name: 42 } },
      } as SurfaceContent;
      const rejected = build(snapshot('profile', 3, { body: broken }));
      expect(
        applySurfacePush(rejected, opsPush('profile', 3, 4, [setName('ok')])),
      ).toEqual({
        state: rejected,
        outcome: 'rejected-surface',
        needsRead: true,
      });
    });
  });

  describe('deleted', () => {
    it('applies an eviction at an EQUAL revision as terminal and leaves a tombstone', () => {
      const state = build(snapshot('profile', 5));
      const evicted = applySurfacePush(
        state,
        deletedPush('profile', 5, 'evicted'),
      );
      expect(evicted).toMatchObject({ outcome: 'applied', needsRead: false });
      expect(evicted.state.entries.has('profile')).toBe(false);
      expect(evicted.state.tombstones.get('profile')).toBe(5);
      expect(evicted.state.notice).toEqual({
        kind: 'evicted',
        surfaceId: 'profile',
        text: APPS_EVICTED_NOTICE,
      });
      expect(evicted.state.activeSurfaceId).toBeNull();
      // Late pushes for the evicted incarnation cannot revive it.
      expect(
        applySurfacePush(evicted.state, snapshot('profile', 5)).outcome,
      ).toBe('tombstoned');
      expect(
        applySurfacePush(
          evicted.state,
          opsPush('profile', 4, 5, [setName('x')]),
        ).outcome,
      ).toBe('tombstoned');
    });

    it('recreates the surface from a later snapshot above the tombstone', () => {
      const evicted = build(
        snapshot('profile', 5),
        deletedPush('profile', 5, 'evicted'),
      );
      const recreated = applySurfacePush(evicted, snapshot('profile', 6));
      expect(recreated.outcome).toBe('applied');
      expect(entry(recreated.state, 'profile').materializedRevision).toBe(6);
      expect(recreated.state.tombstones.has('profile')).toBe(false);
      expect(recreated.state.notice).toBeNull();
    });

    it('removes the surface on an agent delete and activates the next most recent', () => {
      const state = build(snapshot('a', 1), snapshot('b', 2), snapshot('c', 3));
      const deleted = applySurfacePush(
        state,
        deletedPush('c', 4, 'agent-deleted'),
      );
      expect(deleted.outcome).toBe('applied');
      expect([...deleted.state.entries.keys()]).toEqual(['a', 'b']);
      expect(deleted.state.tombstones.get('c')).toBe(4);
      expect(deleted.state.activeSurfaceId).toBe('b');
      expect(deleted.state.notice).toBeNull();
    });
  });

  describe('bound', () => {
    it('accepts a 9th surface and asks for a read', () => {
      const bound = SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId;
      const state = build(
        ...Array.from({ length: bound }, (_unused, index) =>
          snapshot(`s${index}`, index + 1),
        ),
      );
      expect(state.entries.size).toBe(bound);
      const ninth = applySurfacePush(state, snapshot('s8', bound + 1));
      expect(ninth).toMatchObject({ outcome: 'applied', needsRead: true });
      expect(ninth.state.entries.size).toBe(bound + 1);
      // The host's eviction delete settles the overflow.
      const evicted = applySurfacePush(
        ninth.state,
        deletedPush('s0', bound + 1, 'evicted'),
      );
      expect(evicted.state.entries.size).toBe(bound);
    });

    it('keeps the surfaces with the highest revisions when a read reports more than the bound', () => {
      const bound = SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId;
      const views = Array.from({ length: bound + 2 }, (_unused, index) =>
        stateView(`s${index}`, index + 1),
      );
      const result = applySurfaceRead(
        createAppsSurfaceState(),
        found(...views),
        0,
      );
      expect([...result.state.entries.keys()].sort()).toEqual(
        views
          .slice(2)
          .map((view) => view.surfaceId)
          .sort(),
      );
    });
  });

  describe('applySurfaceRead', () => {
    it('never lowers a materialized revision', () => {
      const state = build(snapshot('profile', 7));
      const readSeq = surfaceReadSeq(state);
      const result = applySurfaceRead(
        state,
        found(stateView('profile', 5, content('Stale'))),
        readSeq,
      );
      expect(entry(result.state, 'profile').materializedRevision).toBe(7);
      expect(shownName(result.state, 'profile')).toBe('Ada');
    });

    it('replaces a held surface from a newer view and keeps its view state', () => {
      const state = withViewState(build(snapshot('profile', 3)), 'profile');
      const result = applySurfaceRead(
        state,
        found(stateView('profile', 6, content('Grace'))),
        surfaceReadSeq(state),
      );
      expect(entry(result.state, 'profile').materializedRevision).toBe(6);
      expect(shownName(result.state, 'profile')).toBe('Grace');
      expect(entry(result.state, 'profile').viewState.drafts).toEqual({
        name: 'draft',
      });
    });

    it('keeps entries pushed after the read was sent and removes the rest', () => {
      const state = build(snapshot('a', 1));
      const readSeq = surfaceReadSeq(state);
      const pushedAfter = applySurfacePush(state, snapshot('b', 2)).state;
      const result = applySurfaceRead(pushedAfter, found(), readSeq);
      expect([...result.state.entries.keys()]).toEqual(['b']);
      expect(result.state.tombstones.get('a')).toBe(1);
      expect(result.state.activeSurfaceId).toBe('b');
    });

    it('removes only entries older than the read on not-found', () => {
      const state = build(snapshot('a', 1));
      const readSeq = surfaceReadSeq(state);
      const later = applySurfacePush(state, snapshot('b', 2)).state;
      const result = applySurfaceRead(later, { status: 'not-found' }, readSeq);
      expect([...result.state.entries.keys()]).toEqual(['b']);
    });

    it('does not revive a tombstoned surface from an older view', () => {
      const state = build(
        snapshot('a', 4),
        deletedPush('a', 5, 'agent-deleted'),
      );
      const result = applySurfaceRead(
        state,
        found(stateView('a', 4)),
        surfaceReadSeq(state),
      );
      expect(result.state.entries.has('a')).toBe(false);
    });

    it('changes nothing for a malformed result', () => {
      const state = build(snapshot('a', 1));
      expect(applySurfaceRead(state, { status: 'found' }, 0)).toEqual({
        state,
        outcome: 'malformed',
        needsRead: false,
      });
    });
  });

  describe('reconciliation (handoff (c), cases 1-5)', () => {
    const OP = 'op-1758790000000-abcdefgh12345678';

    function withPendingOverlay(state: AppsSurfaceState, baseRevision: number) {
      return updateSurfaceOverlays(state, 'profile', (overlays) =>
        overlays.add({
          operationId: OP,
          path: 'form.name',
          value: 'Grace',
          baseRevision,
        }),
      );
    }

    const settle = (state: AppsSurfaceState, ackRevision: number) =>
      updateSurfaceOverlays(state, 'profile', (overlays) =>
        overlays.settle(OP, ackRevision),
      );

    it('case 1: result before echo; the ack is never materialized and the echo retires the overlay', () => {
      const base = withPendingOverlay(build(snapshot('profile', 4)), 4);
      const acked = settle(base, 5);
      expect(entry(acked, 'profile').materializedRevision).toBe(4);
      expect(
        entry(acked, 'profile').overlays.pendingValues().get('form.name'),
      ).toBe('Grace');
      const echoed = applySurfacePush(
        acked,
        opsPush('profile', 4, 5, [setName('Grace')]),
      );
      expect(echoed.outcome).toBe('applied');
      expect(entry(echoed.state, 'profile').materializedRevision).toBe(5);
      expect(shownName(echoed.state, 'profile')).toBe('Grace');
      expect(entry(echoed.state, 'profile').overlays.size).toBe(0);
    });

    it('case 2: echo before result; the result only settles and retires', () => {
      const base = withPendingOverlay(build(snapshot('profile', 4)), 4);
      const echoed = applySurfacePush(
        base,
        opsPush('profile', 4, 5, [setName('Grace')]),
      ).state;
      expect(entry(echoed, 'profile').overlays.size).toBe(1);
      const settled = settle(echoed, 5);
      expect(entry(settled, 'profile').materializedRevision).toBe(5);
      expect(entry(settled, 'profile').renderable).toBe(
        entry(echoed, 'profile').renderable,
      );
      expect(entry(settled, 'profile').overlays.size).toBe(0);
    });

    it('case 3: a non-conflicting agent write between base and commit is a gap, and the read replaces the view', () => {
      const state = build(snapshot('profile', 4));
      const readSeq = surfaceReadSeq(state);
      const echo = applySurfacePush(
        state,
        opsPush('profile', 5, 6, [setName('Grace')]),
      );
      expect(echo).toEqual({ state, outcome: 'gap', needsRead: true });
      const read = applySurfaceRead(
        echo.state,
        found(stateView('profile', 6, content('Grace', 'Agent title'))),
        readSeq,
      );
      expect(entry(read.state, 'profile').materializedRevision).toBe(6);
      expect(entry(read.state, 'profile').renderable).toMatchObject({
        content: content('Grace', 'Agent title'),
      });
    });

    it('case 4: a newer push, then an older result or read, never moves the revision back', () => {
      const pending = withPendingOverlay(build(snapshot('profile', 4)), 4);
      const newer = applySurfacePush(
        pending,
        opsPush('profile', 4, 6, [setName('Agent')], 'agent'),
      ).state;
      const olderResult = settle(newer, 5);
      expect(entry(olderResult, 'profile').materializedRevision).toBe(6);
      expect(entry(olderResult, 'profile').overlays.size).toBe(0);
      const staleRead = applySurfaceRead(
        olderResult,
        found(stateView('profile', 5, content('Grace'))),
        surfaceReadSeq(olderResult),
      );
      expect(entry(staleRead.state, 'profile').materializedRevision).toBe(6);
      expect(shownName(staleRead.state, 'profile')).toBe('Agent');
    });

    it('case 4: a stale read keeps a settled overlay whose ack is above what it materializes', () => {
      const acked = settle(
        withPendingOverlay(build(snapshot('profile', 4)), 4),
        5,
      );
      const staleRead = applySurfaceRead(
        acked,
        found(stateView('profile', 4)),
        surfaceReadSeq(acked),
      );
      expect(entry(staleRead.state, 'profile').materializedRevision).toBe(4);
      expect(entry(staleRead.state, 'profile').overlays.size).toBe(1);
    });

    it('case 5: a lost echo is recovered by the read, which retires the settled overlay', () => {
      const acked = settle(
        withPendingOverlay(build(snapshot('profile', 4)), 4),
        5,
      );
      const readSeq = surfaceReadSeq(acked);
      const read = applySurfaceRead(
        acked,
        found(stateView('profile', 5, content('Grace'))),
        readSeq,
      );
      expect(entry(read.state, 'profile').materializedRevision).toBe(5);
      expect(shownName(read.state, 'profile')).toBe('Grace');
      expect(entry(read.state, 'profile').overlays.size).toBe(0);
    });

    it('keeps a pending overlay across a read', () => {
      const pending = withPendingOverlay(build(snapshot('profile', 4)), 4);
      const read = applySurfaceRead(
        pending,
        found(stateView('profile', 5, content('Agent'))),
        surfaceReadSeq(pending),
      );
      expect(entry(read.state, 'profile').overlays.has(OP)).toBe(true);
    });

    it('ignores overlay updates for an unknown surface', () => {
      const state = createAppsSurfaceState();
      expect(
        updateSurfaceOverlays(state, 'ghost', (overlays) =>
          overlays.settle(OP, 3),
        ),
      ).toBe(state);
    });
  });
});
