import { signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  compilePtahUiBlock,
  resolveCompiledPtahUiBlock,
  type PtahUiLimitsInput,
  type SurfaceComponent,
  type SurfaceContent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { TurnSourceSnapshot } from '@ptah-extension/shared';
import {
  PTAH_UI_DISPLAY_DOCK_SYNC,
  displayFenceKey,
  type PtahUiDisplayDockSync,
  type PtahUiDisplayFenceStatus,
  type PtahUiDisplaySurfacesPublication,
} from '../../services/ptah-ui-display-dock';
import {
  PTAH_UI_BLOCK_LIVE_SOURCES,
  PTAH_UI_BLOCK_PIPELINE,
  type PtahUiBlockLiveSources,
  type PtahUiBlockPipeline,
} from '../ptah-ui/ptah-ui-block.component';
import { DisplaySurfaceSyncComponent } from './display-surface-sync.component';
import type { DisplayCandidate, DisplaySurface } from './display-surfaces';

const TAB = 'tab-1';

function surfaceComponents(
  content: SurfaceContent,
): readonly SurfaceComponent[] {
  if (content.contract !== 'dashboard-spec/2')
    throw new Error('expected a dashboard-spec/2 surface');
  return content.surface.components;
}

function displayFence(body: string, id?: string): string {
  return `\`\`\`ptah-ui display${id === undefined ? '' : ` ${id}`}\n${body}\`\`\`\n`;
}

const statBody = (title: string, value: number | string): string =>
  `title ${title}\nstats\n  Files | ${value}\n`;

function candidate(
  messageId: string,
  orderKey: number,
  text: string,
  turnKey: string,
  live: boolean,
): DisplayCandidate {
  return {
    blockKey: `${messageId}:node`,
    messageId,
    nodeId: 'node',
    orderKey,
    text,
    turnKey,
    live,
  };
}

/**
 * A dock store with the D12 rules the real `DisplayDockState` (Batch 23)
 * implements: per-tab surfaces, statuses and `seenBlockKeys`; a user close
 * during a turn records `userClosedTurnKey`; an auto-open request for that
 * turn increments `newCount` instead of opening.
 */
class FakeDockStore implements PtahUiDisplayDockSync {
  readonly open = signal(false);
  readonly newCount = signal(0);
  readonly activeSurface = signal<string | null>(null);
  readonly autoOpenRequests: {
    turnKey: string;
    surfaceKey: string;
  }[] = [];
  readonly publications: PtahUiDisplaySurfacesPublication[] = [];
  private userClosedTurnKey: string | null = null;
  private readonly published = new Map<
    string,
    PtahUiDisplaySurfacesPublication
  >();
  private readonly seen = new Map<string, Set<string>>();

  surfaces(tabId: string): readonly DisplaySurface[] {
    return this.published.get(tabId)?.surfaces ?? [];
  }
  setSurfaces(
    tabId: string,
    publication: PtahUiDisplaySurfacesPublication,
  ): void {
    this.published.set(tabId, publication);
    this.publications.push(publication);
  }
  hasSeen(tabId: string, fenceKey: string): boolean {
    return this.seen.get(tabId)?.has(fenceKey) ?? false;
  }
  markSeen(tabId: string, fenceKeys: readonly string[]): void {
    const set = this.seen.get(tabId) ?? new Set<string>();
    for (const key of fenceKeys) set.add(key);
    this.seen.set(tabId, set);
  }
  requestAutoOpen(tabId: string, turnKey: string, surfaceKey: string): void {
    this.autoOpenRequests.push({ turnKey, surfaceKey });
    if (this.userClosedTurnKey === turnKey) {
      this.newCount.update((count) => count + 1);
      return;
    }
    this.open.set(true);
    this.activeSurface.set(surfaceKey);
  }
  /** The chip's lookup (`PtahUiDisplayDock.fenceStatus`). */
  fenceStatus(
    tabId: string,
    fenceKey: string,
  ): PtahUiDisplayFenceStatus | null {
    return this.published.get(tabId)?.statuses.get(fenceKey) ?? null;
  }
  userClose(turnKey: string): void {
    this.open.set(false);
    this.userClosedTurnKey = turnKey;
  }
}

function countingPipeline(): PtahUiBlockPipeline & {
  compiles: number;
  resolves: number;
} {
  const pipeline = {
    compiles: 0,
    resolves: 0,
    compile: ((body: string, surfaceId: string) => {
      pipeline.compiles += 1;
      return compilePtahUiBlock(body, surfaceId);
    }) as typeof compilePtahUiBlock,
    resolve: ((compiled, input) => {
      pipeline.resolves += 1;
      return resolveCompiledPtahUiBlock(compiled, input);
    }) as typeof resolveCompiledPtahUiBlock,
  };
  return pipeline;
}

const LIMITS: PtahUiLimitsInput = {
  kind: 'available',
  rows: [],
  lanes: 3,
  atLimit: 0,
  nearLimit: 0,
  unknown: 0,
  asOf: 0,
};

function liveSourcesStub(): PtahUiBlockLiveSources & {
  acquired: number;
  released: number;
} {
  const limits = signal(LIMITS);
  const stub = {
    acquired: 0,
    released: 0,
    agentsInput: () => {
      throw new Error('no $agents in these specs');
    },
    acquireLimits: () => {
      stub.acquired += 1;
      return limits.asReadonly();
    },
    releaseLimits: () => {
      stub.released += 1;
    },
  };
  return stub;
}

interface Setup {
  readonly store: FakeDockStore | null;
  readonly pipeline: ReturnType<typeof countingPipeline>;
  readonly liveSources: ReturnType<typeof liveSourcesStub>;
}

function configure(withDock: boolean, store = new FakeDockStore()): Setup {
  const pipeline = countingPipeline();
  const liveSources = liveSourcesStub();
  const providers: Provider[] = [
    { provide: PTAH_UI_BLOCK_PIPELINE, useValue: pipeline },
    { provide: PTAH_UI_BLOCK_LIVE_SOURCES, useValue: liveSources },
  ];
  if (withDock)
    providers.push({ provide: PTAH_UI_DISPLAY_DOCK_SYNC, useValue: store });
  TestBed.configureTestingModule({
    imports: [DisplaySurfaceSyncComponent],
    providers,
  });
  return { store: withDock ? store : null, pipeline, liveSources };
}

function mount(
  candidates: readonly DisplayCandidate[],
  snapshots?: ReadonlyMap<string, TurnSourceSnapshot>,
): ComponentFixture<DisplaySurfaceSyncComponent> {
  const fixture = TestBed.createComponent(DisplaySurfaceSyncComponent);
  fixture.componentRef.setInput('tabId', TAB);
  fixture.componentRef.setInput('candidates', candidates);
  if (snapshots !== undefined)
    fixture.componentRef.setInput('snapshots', snapshots);
  fixture.detectChanges();
  return fixture;
}

function update(
  fixture: ComponentFixture<DisplaySurfaceSyncComponent>,
  candidates: readonly DisplayCandidate[],
): void {
  fixture.componentRef.setInput('candidates', candidates);
  fixture.detectChanges();
}

describe('DisplaySurfaceSyncComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('R1.8: user close wins for the turn; the next turn opens again', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    const first = displayFence(statBody('First', 1), 'a');
    const fixture = mount([candidate('m1', 0, first, 't1', true)]);

    expect(dock.open()).toBe(true);
    expect(dock.activeSurface()).toBe('id:a');

    dock.userClose('t1');
    update(fixture, [
      candidate(
        'm1',
        0,
        first + displayFence(statBody('Second', 2), 'b'),
        't1',
        true,
      ),
    ]);

    expect(dock.open()).toBe(false);
    expect(dock.newCount()).toBe(1);

    update(fixture, [
      candidate(
        'm1',
        0,
        first + displayFence(statBody('Second', 2), 'b'),
        't1',
        false,
      ),
      candidate('m2', 1, displayFence(statBody('Third', 3), 'c'), 't2', true),
    ]);

    expect(dock.open()).toBe(true);
    expect(dock.activeSurface()).toBe('id:c');
    expect(dock.autoOpenRequests).toEqual([
      { turnKey: 't1', surfaceKey: 'id:a' },
      { turnKey: 't1', surfaceKey: 'id:b' },
      { turnKey: 't2', surfaceKey: 'id:c' },
    ]);
  });

  it('R1.9: replay candidates rebuild the panel silently and never auto-open', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    mount([
      candidate('m1', 0, displayFence(statBody('Old', 1), 'a'), 't1', false),
      candidate('m2', 1, displayFence(statBody('Older', 2)), 't2', false),
    ]);

    expect(dock.autoOpenRequests).toEqual([]);
    expect(dock.open()).toBe(false);
    expect(dock.surfaces(TAB).map((surface) => surface.key)).toEqual([
      'id:a',
      'anon:m2:node:0',
    ]);
  });

  it('R1.9: a remount over the same live candidates does not re-trigger auto-open', () => {
    const store = new FakeDockStore();
    configure(true, store);
    const live = [
      candidate('m1', 0, displayFence(statBody('Live', 1), 'a'), 't1', true),
    ];
    const fixture = mount(live);
    expect(store.autoOpenRequests).toHaveLength(1);

    // Closed by a means that records no user-close turn, so only `seenBlockKeys`
    // can keep the remount from reopening it.
    store.open.set(false);
    fixture.destroy();
    const again = mount(live);

    expect(store.autoOpenRequests).toHaveLength(1);
    expect(store.open()).toBe(false);
    again.destroy();
  });

  it('auto-opens only for applied fences: invalid and reserved ids never request', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    mount([
      candidate(
        'm1',
        0,
        displayFence('title Bad\ngauge 5\n', 'a') +
          displayFence(statBody('Spoof', 1), 'ptah.turn-summary'),
        't1',
        true,
      ),
    ]);

    expect(dock.autoOpenRequests).toEqual([]);
    expect(dock.fenceStatus(TAB, displayFenceKey('m1', 'node', 1))).toEqual({
      kind: 'invalid',
      reason: 'reserved display id',
    });
    expect(dock.fenceStatus(TAB, displayFenceKey('m1', 'node', 0))?.kind).toBe(
      'invalid',
    );
  });

  it('R1.10: never touches the host-owned summary or a `ptah.` key', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    mount([
      candidate('m1', 0, displayFence(statBody('A', 1), 'a'), 't1', true),
    ]);

    for (const request of dock.autoOpenRequests) {
      expect(request.surfaceKey.startsWith('id:ptah.')).toBe(false);
    }
    for (const surface of dock.surfaces(TAB)) {
      expect(surface.key).not.toContain('ptah.');
    }
  });

  it('R1.7: publishing and auto-open never move focus', () => {
    configure(true);
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();

    mount([
      candidate('m1', 0, displayFence(statBody('A', 1), 'a'), 't1', true),
    ]);

    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('publishes chip-shaped statuses the chip lookup finds', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    mount([
      candidate(
        'm1',
        0,
        displayFence(statBody('One', 1), 'x') +
          displayFence(statBody('Two', 2), 'x'),
        't1',
        false,
      ),
    ]);

    expect(dock.fenceStatus(TAB, displayFenceKey('m1', 'node', 0))).toEqual({
      kind: 'superseded',
      surfaceKey: 'id:x',
      title: 'One',
      description: null,
    });
    expect(dock.fenceStatus(TAB, displayFenceKey('m1', 'node', 1))).toEqual({
      kind: 'applied',
      surfaceKey: 'id:x',
      title: 'Two',
      description: null,
    });
  });

  it('compiles a closed fence once while later text streams in', () => {
    const { pipeline } = configure(true);
    const fence = displayFence(statBody('A', 1), 'a');
    const fixture = mount([candidate('m1', 0, fence, 't1', true)]);
    const resolvesAfterFirst = pipeline.resolves;

    update(fixture, [candidate('m1', 0, `${fence}more`, 't1', true)]);
    update(fixture, [candidate('m1', 0, `${fence}more text`, 't1', true)]);

    expect(pipeline.compiles).toBe(1);
    // Unchanged sources reuse the resolve result too.
    expect(pipeline.resolves).toBe(resolvesAfterFirst);
  });

  it('R2.7: an unclosed fence does not touch the panel', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    mount([
      candidate('m1', 0, '```ptah-ui display a\ntitle Half\n', 't1', true),
    ]);

    expect(dock.surfaces(TAB)).toEqual([]);
    expect(dock.autoOpenRequests).toEqual([]);
  });

  it('D10: the second publication keeps view state of unchanged components', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    const body = (files: number) =>
      `title Overview\nstats\n  Files | ${files}\naccordion More\n  note info Later\n`;
    const first = displayFence(body(1), 'o');
    const fixture = mount([candidate('m1', 0, first, 't1', true)]);
    update(fixture, [
      candidate('m1', 0, first + displayFence(body(2), 'o'), 't1', true),
    ]);

    const latest = dock.surfaces(TAB)[0];
    const accordion = surfaceComponents(latest.content).find(
      (component) => component.kind === 'accordion',
    );
    expect(latest.retainedViewStateIds.has(accordion?.id ?? '')).toBe(true);
  });

  it('holds the `$limits` read only while a fence names it', () => {
    const { store, liveSources } = configure(true);
    const dock = store as FakeDockStore;
    const fixture = mount([
      candidate(
        'm1',
        0,
        displayFence('title Lanes\nstats\n  Lanes | $limits.lanes\n', 'l'),
        't1',
        false,
      ),
    ]);

    expect(liveSources.acquired).toBe(1);
    const stats = JSON.stringify(dock.surfaces(TAB)[0].content);
    expect(stats).toContain('3');

    update(fixture, [
      candidate(
        'm1',
        0,
        displayFence(statBody('No limits', 1), 'l'),
        't1',
        false,
      ),
    ]);
    expect(liveSources.released).toBe(1);

    update(fixture, [
      candidate(
        'm1',
        0,
        displayFence('title Lanes\nstats\n  Lanes | $limits.lanes\n', 'l'),
        't1',
        false,
      ),
    ]);
    fixture.destroy();
    expect(liveSources.acquired).toBe(2);
    expect(liveSources.released).toBe(2);
  });

  it('reads the turn snapshot of the fence message for turn sources', () => {
    const { store } = configure(true);
    const dock = store as FakeDockStore;
    const snapshot: TurnSourceSnapshot = {
      state: 'pending',
      incomplete: false,
      diff: { kind: 'pending' },
      tests: { kind: 'pending' },
      usage: { kind: 'pending' },
    };
    mount(
      [
        candidate(
          'm1',
          0,
          displayFence('title Diff\nstats\n  Files | $diff.files\n', 'd'),
          't1',
          false,
        ),
      ],
      new Map([['m1', snapshot]]),
    );

    expect(dock.fenceStatus(TAB, displayFenceKey('m1', 'node', 0))?.kind).toBe(
      'applied',
    );
  });

  it('does nothing and does not throw without a dock-sync provider', () => {
    const { pipeline, liveSources } = configure(false);

    expect(() =>
      mount([
        candidate(
          'm1',
          0,
          displayFence('title Lanes\nstats\n  Lanes | $limits.lanes\n', 'a'),
          't1',
          true,
        ),
      ]),
    ).not.toThrow();
    expect(pipeline.compiles).toBe(0);
    expect(liveSources.acquired).toBe(0);
  });

  it('renders no DOM', () => {
    configure(true);
    const fixture = mount([]);

    expect((fixture.nativeElement as HTMLElement).childNodes).toHaveLength(0);
  });
});
