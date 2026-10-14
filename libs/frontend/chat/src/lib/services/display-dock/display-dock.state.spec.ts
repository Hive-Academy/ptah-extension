import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  PTAH_UI_DISPLAY_DOCK,
  PTAH_UI_DISPLAY_DOCK_SYNC,
  displayFenceKey,
  type DisplaySurface,
  type PtahUiDisplayDock,
  type PtahUiDisplayDockSync,
  type PtahUiDisplayFenceStatus,
} from '@ptah-extension/chat-ui';
import type { TurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import { DisplayDockState, type DisplayDockSummary } from './display-dock.state';

const TAB_A = 'tab-a';
const TAB_B = 'tab-b';

function surface(key: string, retained: readonly string[] = []): DisplaySurface {
  return {
    key,
    displayId: key.startsWith('id:') ? key.slice(3) : null,
    content: {} as DisplaySurface['content'],
    title: null,
    description: null,
    turnKey: 'u1',
    fenceKey: `${key}:0`,
    createdSeq: 0,
    updatedSeq: 0,
    componentSignatures: new Map(),
    retainedViewStateIds: new Set(retained),
  };
}

function applied(surfaceKey: string): PtahUiDisplayFenceStatus {
  return { kind: 'applied', surfaceKey, title: 'Stats', description: null };
}

function viewState(ids: readonly string[]): SurfaceViewState {
  return {
    components: Object.fromEntries(ids.map((id) => [id, { page: 1 }])),
    drafts: Object.fromEntries(ids.map((id) => [id, `draft-${id}`])),
  };
}

function summary(label: string): DisplayDockSummary {
  return { model: { label } as unknown as TurnSummaryModel, changeSet: null };
}

describe('DisplayDockState', () => {
  let store: DisplayDockState;

  beforeEach(() => {
    store = new DisplayDockState();
  });

  describe('per-tab isolation (R1.1)', () => {
    it('keeps open, pin, tab, width and surfaces apart per tab', () => {
      store.open(TAB_A);
      store.setPinned(TAB_A, true);
      store.selectTab(TAB_A, 'agents');
      store.setWidth(TAB_A, 420);
      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:stats')],
        statuses: new Map(),
      });

      const a = store.tab(TAB_A);
      expect(a.open).toBe(true);
      expect(a.pinned).toBe(true);
      expect(a.activeTab).toBe('agents');
      expect(a.widthPx).toBe(420);
      expect(a.surfaces.map((s) => s.key)).toEqual(['id:stats']);

      const b = store.tab(TAB_B);
      expect(b.open).toBe(false);
      expect(b.pinned).toBe(false);
      expect(b.activeTab).toBe('displays');
      expect(b.widthPx).toBeNull();
      expect(b.surfaces).toEqual([]);
      expect(store.surfaces(TAB_B)).toEqual([]);
    });

    it('keeps the width per tab across tab switches (R1.5)', () => {
      store.setWidth(TAB_A, 360);
      store.setWidth(TAB_B, 500);
      expect(store.tab(TAB_A).widthPx).toBe(360);
      expect(store.tab(TAB_B).widthPx).toBe(500);
      store.setWidth(TAB_A, null);
      expect(store.tab(TAB_A).widthPx).toBeNull();
      expect(store.tab(TAB_B).widthPx).toBe(500);
    });

    it('keeps seen fences per tab', () => {
      const key = displayFenceKey('m1', 'n1', 0);
      store.markSeen(TAB_A, [key]);
      expect(store.hasSeen(TAB_A, key)).toBe(true);
      expect(store.hasSeen(TAB_B, key)).toBe(false);
    });
  });

  describe('open, close, toggle and pin (R1.4, R1.6)', () => {
    it('toggles the dock open and closed', () => {
      store.toggle(TAB_A);
      expect(store.tab(TAB_A).open).toBe(true);
      store.toggle(TAB_A);
      expect(store.tab(TAB_A).open).toBe(false);
    });

    it('unpins a pinned dock on close', () => {
      store.open(TAB_A);
      store.setPinned(TAB_A, true);
      store.close(TAB_A);
      expect(store.tab(TAB_A)).toMatchObject({ open: false, pinned: false });
    });

    it('closes only the current tab and retains the other tab pin, section and width', () => {
      store.open(TAB_A);
      store.setPinned(TAB_A, true);
      store.selectTab(TAB_A, 'agents');
      store.setWidth(TAB_A, 420);
      store.open(TAB_B);
      store.setPinned(TAB_B, true);
      store.selectTab(TAB_B, 'agents');
      store.setWidth(TAB_B, 500);

      store.close(TAB_A);

      expect(store.tab(TAB_A)).toMatchObject({
        open: false,
        pinned: false,
        activeTab: 'agents',
        widthPx: 420,
      });
      expect(store.tab(TAB_B)).toMatchObject({
        open: true,
        pinned: true,
        activeTab: 'agents',
        widthPx: 500,
      });
    });

    it('opens on a surface or a turn summary from a chip', () => {
      store.selectTab(TAB_A, 'agents');
      store.openSurface(TAB_A, 'id:stats');
      expect(store.tab(TAB_A)).toMatchObject({
        open: true,
        activeTab: 'displays',
        selection: { kind: 'surface', surfaceKey: 'id:stats' },
      });

      store.close(TAB_A);
      store.openSummary(TAB_A, 'u1');
      expect(store.tab(TAB_A)).toMatchObject({
        open: true,
        activeTab: 'displays',
        summaryTurnKey: 'u1',
        selection: { kind: 'summary' },
      });
    });
  });

  describe('read port and write port (decisions #59, #60)', () => {
    it('reads back through fenceStatus what the sync wrote', () => {
      const sync: PtahUiDisplayDockSync = store;
      const dock: PtahUiDisplayDock = store;
      const key = displayFenceKey('m1', 'n:1', 0);
      const status = applied('id:stats');
      sync.setSurfaces(TAB_A, {
        surfaces: [surface('id:stats')],
        statuses: new Map([[key, status]]),
      });

      expect(dock.fenceStatus(TAB_A, key)).toBe(status);
      expect(dock.fenceStatus(TAB_A, 'm1:n:1:9')).toBeNull();
      expect(dock.fenceStatus(TAB_B, key)).toBeNull();
      expect(sync.surfaces(TAB_A).map((s) => s.key)).toEqual(['id:stats']);
    });

    it('re-runs a computed read when the status changes, even for a tab first written later', () => {
      const key = displayFenceKey('m1', 'n1', 0);
      const read = computed(() => store.fenceStatus(TAB_B, key)?.kind ?? null);
      expect(read()).toBeNull();

      store.setSurfaces(TAB_B, {
        surfaces: [surface('id:stats')],
        statuses: new Map([[key, applied('id:stats')]]),
      });
      expect(read()).toBe('applied');

      store.setSurfaces(TAB_B, {
        surfaces: [],
        statuses: new Map<string, PtahUiDisplayFenceStatus>([
          [key, { kind: 'invalid', reason: 'reserved display id' }],
        ]),
      });
      expect(read()).toBe('invalid');
    });

    it('resolves both chat-ui tokens to the same store with useExisting', () => {
      TestBed.configureTestingModule({
        providers: [
          DisplayDockState,
          { provide: PTAH_UI_DISPLAY_DOCK, useExisting: DisplayDockState },
          { provide: PTAH_UI_DISPLAY_DOCK_SYNC, useExisting: DisplayDockState },
        ],
      });
      const instance = TestBed.inject(DisplayDockState);
      expect(TestBed.inject(PTAH_UI_DISPLAY_DOCK)).toBe(instance);
      expect(TestBed.inject(PTAH_UI_DISPLAY_DOCK_SYNC)).toBe(instance);
    });
  });

  describe('setSurfaces applies D10 retainedViewStateIds (decision #74)', () => {
    it('drops the view state of surface keys no longer present', () => {
      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:a'), surface('id:b')],
        statuses: new Map(),
      });
      store.setViewState(TAB_A, 'id:a', viewState(['t1']));
      store.setViewState(TAB_A, 'id:b', viewState(['t2']));

      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:a', ['t1'])],
        statuses: new Map(),
      });

      expect([...store.tab(TAB_A).viewStates.keys()]).toEqual(['id:a']);
    });

    it('keeps only the component entries listed in retainedViewStateIds', () => {
      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:a')],
        statuses: new Map(),
      });
      const kept = viewState(['table', 'chart']);
      store.setViewState(TAB_A, 'id:a', kept);

      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:a', ['table', 'chart'])],
        statuses: new Map(),
      });
      // Nothing dropped: the very same object survives (renderer echo rule).
      expect(store.tab(TAB_A).viewStates.get('id:a')).toBe(kept);

      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:a', ['table'])],
        statuses: new Map(),
      });
      expect(store.tab(TAB_A).viewStates.get('id:a')).toEqual({
        components: { table: { page: 1 } },
        drafts: { table: 'draft-table' },
      });

      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:a')],
        statuses: new Map(),
      });
      expect(store.tab(TAB_A).viewStates.has('id:a')).toBe(false);
    });

    it('ignores view state for a surface the tab does not hold', () => {
      store.setViewState(TAB_A, 'id:ghost', viewState(['x']));
      expect(store.tab(TAB_A).viewStates.size).toBe(0);
    });

    it('clears a surface selection whose surface left the panel', () => {
      store.setSurfaces(TAB_A, {
        surfaces: [surface('id:a')],
        statuses: new Map(),
      });
      store.openSurface(TAB_A, 'id:a');
      store.setSurfaces(TAB_A, { surfaces: [], statuses: new Map() });
      expect(store.tab(TAB_A).selection).toBeNull();
    });
  });

  describe('auto-open (D12, R1.7-R1.9)', () => {
    it('opens a closed dock on the Displays tab with the surface selected', () => {
      store.selectTab(TAB_A, 'agents');
      store.requestAutoOpen(TAB_A, 'u1', 'id:stats');
      expect(store.tab(TAB_A)).toMatchObject({
        open: true,
        activeTab: 'displays',
        selection: { kind: 'surface', surfaceKey: 'id:stats' },
        newCount: 0,
      });
    });

    it('switches an open, unpinned dock from Agents to Displays; a pinned one stays', () => {
      store.open(TAB_A);
      store.selectTab(TAB_A, 'agents');
      store.requestAutoOpen(TAB_A, 'u1', 'id:stats');
      expect(store.tab(TAB_A)).toMatchObject({
        open: true,
        activeTab: 'displays',
        selection: { kind: 'surface', surfaceKey: 'id:stats' },
      });

      store.selectTab(TAB_A, 'agents');
      store.setPinned(TAB_A, true);
      store.requestAutoOpen(TAB_A, 'u1', 'id:other');
      expect(store.tab(TAB_A).activeTab).toBe('agents');
    });

    it('R1.8: open, user close, second block same turn stays closed with 1 new, next turn opens', () => {
      store.requestAutoOpen(TAB_A, 'u1', 'id:first');
      expect(store.tab(TAB_A).open).toBe(true);

      store.close(TAB_A);
      expect(store.tab(TAB_A).userClosedTurnKey).toBe('u1');

      store.requestAutoOpen(TAB_A, 'u1', 'id:second');
      expect(store.tab(TAB_A)).toMatchObject({ open: false, newCount: 1 });

      store.requestAutoOpen(TAB_A, 'u2', 'id:third');
      expect(store.tab(TAB_A)).toMatchObject({
        open: true,
        newCount: 0,
        selection: { kind: 'surface', surfaceKey: 'id:third' },
      });
    });

    it('R1.8: a close during the live turn before any display holds that turn back', () => {
      store.open(TAB_A);
      store.setLiveTurn(TAB_A, 'u5');
      store.close(TAB_A);
      store.requestAutoOpen(TAB_A, 'u5', 'id:late');
      expect(store.tab(TAB_A)).toMatchObject({ open: false, newCount: 1 });

      store.setLiveTurn(TAB_A, null);
      store.setLiveTurn(TAB_A, 'u6');
      store.requestAutoOpen(TAB_A, 'u6', 'id:next');
      expect(store.tab(TAB_A).open).toBe(true);
    });

    it('a close after the turn ended does not hold back the next turn', () => {
      store.open(TAB_A);
      store.close(TAB_A);
      expect(store.tab(TAB_A).userClosedTurnKey).toBeNull();
      store.requestAutoOpen(TAB_A, 'u1', 'id:stats');
      expect(store.tab(TAB_A).open).toBe(true);
    });

    it('a pinned open dock keeps its selection; an unpinned one follows', () => {
      store.openSurface(TAB_A, 'id:mine');
      store.setPinned(TAB_A, true);
      store.requestAutoOpen(TAB_A, 'u1', 'id:other');
      expect(store.tab(TAB_A).selection).toEqual({
        kind: 'surface',
        surfaceKey: 'id:mine',
      });

      store.setPinned(TAB_A, false);
      store.requestAutoOpen(TAB_A, 'u1', 'id:other');
      expect(store.tab(TAB_A).selection).toEqual({
        kind: 'surface',
        surfaceKey: 'id:other',
      });
    });

    it('auto-open in one tab leaves the other tab closed', () => {
      store.requestAutoOpen(TAB_A, 'u1', 'id:stats');
      expect(store.tab(TAB_B).open).toBe(false);
    });

    it('hasSeen -> requestAutoOpen -> markSeen is synchronous, so a remounted sync cannot re-open (decision #81)', () => {
      const sync: PtahUiDisplayDockSync = store;
      const key = displayFenceKey('m1', 'n1', 0);
      const publish = (): void => {
        if (sync.hasSeen(TAB_A, key)) return;
        sync.requestAutoOpen(TAB_A, 'u1', 'id:stats');
        sync.markSeen(TAB_A, [key]);
      };

      publish();
      expect(store.tab(TAB_A).open).toBe(true);
      store.close(TAB_A);
      store.setLiveTurn(TAB_A, null);

      // A second sync instance (tab switch remount) publishes the same fence.
      publish();
      expect(store.tab(TAB_A)).toMatchObject({ open: false, newCount: 0 });
    });
  });

  describe('agents tab auto-open', () => {
    it('opens on Agents, stays closed after a user close until released', () => {
      store.requestAgentsOpen(TAB_A);
      expect(store.tab(TAB_A)).toMatchObject({ open: true, activeTab: 'agents' });

      store.close(TAB_A);
      store.requestAgentsOpen(TAB_A);
      expect(store.tab(TAB_A).open).toBe(false);

      store.releaseAgentsUserClose(TAB_A);
      store.requestAgentsOpen(TAB_A);
      expect(store.tab(TAB_A).open).toBe(true);
    });

    it('does not switch an open dock away from the user tab', () => {
      store.openSurface(TAB_A, 'id:stats');
      store.requestAgentsOpen(TAB_A);
      expect(store.tab(TAB_A).activeTab).toBe('displays');
    });
  });

  describe('summaries', () => {
    it('does not open the dock when summaries arrive (R1.10)', () => {
      store.setSummaries(TAB_A, new Map([['u1', summary('first')]]));
      expect(store.tab(TAB_A).open).toBe(false);
    });

    it('shows the selected turn, else the latest, and drops a stale turn key', () => {
      const first = summary('first');
      const second = summary('second');
      store.setSummaries(
        TAB_A,
        new Map([
          ['u1', first],
          ['u2', second],
        ]),
      );
      expect(store.summaryFor(TAB_A)).toBe(second);

      store.openSummary(TAB_A, 'u1');
      expect(store.summaryFor(TAB_A)).toBe(first);

      store.setSummaries(TAB_A, new Map([['u2', second]]));
      expect(store.tab(TAB_A).summaryTurnKey).toBeNull();
      expect(store.summaryFor(TAB_A)).toBe(second);

      store.setSummaries(TAB_A, new Map());
      expect(store.summaryFor(TAB_A)).toBeNull();
      expect(store.tab(TAB_A).selection).toBeNull();
      expect(store.summaryFor(TAB_B)).toBeNull();
    });
  });
});
