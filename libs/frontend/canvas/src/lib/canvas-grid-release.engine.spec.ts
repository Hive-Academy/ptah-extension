// The shipped UMD bundle exercises the same GridStack implementation in Jest's CJS runtime.
const GridStack =
  require('gridstack/dist/gridstack-all.js') as typeof import('gridstack').GridStack;
import { projectTileGeometry, type TileIntent } from './canvas-layout-intent';
import {
  pinLiveNodes,
  restorePinnedNodes,
  staleGridNodes,
} from './canvas-grid-release';

const intent: TileIntent[] = [
  {
    tabId: 'A',
    order: 0,
    width: { kind: 'span', span: 'half' },
    rowBreakBefore: false,
  },
  {
    tabId: 'B',
    order: 1,
    width: { kind: 'span', span: 'half' },
    rowBreakBefore: false,
  },
  {
    tabId: 'C',
    order: 2,
    width: { kind: 'span', span: 'half' },
    rowBreakBefore: true,
  },
  {
    tabId: 'D',
    order: 3,
    width: { kind: 'span', span: 'half' },
    rowBreakBefore: false,
  },
];
const derived = projectTileGeometry(intent, 2, null, [
  { tabId: 'B', compact: true, heightUnits: 2 },
]);
const derivedTile = (id: string) => {
  const tile = derived.find((candidate) => candidate.tabId === id);
  if (!tile) throw new Error(`Missing derived tile ${id}`);
  return tile;
};

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      /* jsdom has no layout observer */
    }
    unobserve() {
      /* no-op */
    }
    disconnect() {
      /* no-op */
    }
  } as unknown as typeof ResizeObserver;
});

function releaseAndLoad(pin: boolean) {
  const host = document.createElement('div');
  document.body.append(host);
  const grid = GridStack.init(
    { column: 12, float: false, animate: false },
    host,
  );
  const add = (id: string) => {
    const tile = derivedTile(id);
    grid.addWidget({ id, x: tile.x, y: tile.y, w: tile.w, h: tile.h });
  };
  add('A');
  add('B');
  grid.addWidget({ id: 'ghost', x: 6, y: 2, w: 6, h: 4 });
  add('C');
  add('D');
  const liveIds = new Set(intent.map((tile) => tile.tabId));
  const pinned = pin ? pinLiveNodes(grid.engine.nodes, liveIds) : [];
  try {
    for (const node of staleGridNodes(grid.engine.nodes, liveIds)) {
      if (node.el) grid.removeWidget(node.el, false, false);
      else grid.engine.removeNode(node, false, false);
    }
    grid.load(
      derived.map(({ tabId, x, y, w, h }) => ({ id: tabId, x, y, w, h })),
      false,
    );
  } finally {
    restorePinnedNodes(pinned);
  }
  const result = new Map(
    grid.engine.nodes.map((node) => [
      node.id,
      { x: node.x, y: node.y, w: node.w, h: node.h, locked: node.locked },
    ]),
  );
  grid.destroy(false);
  host.remove();
  return result;
}

function applyMovingTargets(
  initial: readonly {
    tabId: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }[],
  target: readonly {
    tabId: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }[],
  pin = true,
) {
  const host = document.createElement('div');
  document.body.append(host);
  const grid = GridStack.init(
    { column: 12, float: false, animate: false },
    host,
  );
  for (const { tabId, x, y, w, h } of initial) {
    grid.addWidget({ id: tabId, x, y, w, h });
  }
  const liveIds = new Set(target.map((tile) => tile.tabId));
  const pinned = pin ? pinLiveNodes(grid.engine.nodes, liveIds) : [];
  try {
    for (const node of staleGridNodes(grid.engine.nodes, liveIds)) {
      if (node.el) grid.removeWidget(node.el, false, false);
      else grid.engine.removeNode(node, false, false);
    }
    grid.load(
      target.map(({ tabId, x, y, w, h }) => ({ id: tabId, x, y, w, h })),
      false,
    );
  } finally {
    restorePinnedNodes(pinned);
  }
  const result = new Map(
    grid.engine.nodes.map((node) => [
      node.id,
      { x: node.x, y: node.y, w: node.w, h: node.h },
    ]),
  );
  grid.destroy(false);
  host.remove();
  return result;
}

describe('real GridStack release and load', () => {
  it('moves pinned neighbours to derived rows after closing a middle tile', () => {
    const starting = projectTileGeometry(intent, 2, null, [
      { tabId: 'A', compact: true, heightUnits: 2 },
    ]);
    const target = projectTileGeometry(
      intent.filter((tile) => tile.tabId !== 'B'),
      2,
      null,
      [{ tabId: 'A', compact: true, heightUnits: 2 }],
    );
    expect(starting.find((tile) => tile.tabId === 'C')?.y).toBeGreaterThan(
      target.find((tile) => tile.tabId === 'C')?.y ?? 0,
    );
    const result = applyMovingTargets(starting, target);
    expect(result.has('B')).toBe(false);
    for (const { tabId, x, y, w, h } of target) {
      expect(result.get(tabId)).toEqual({ x, y, w, h });
    }
    expect(
      applyMovingTargets(starting, target, false).get('D')?.y,
    ).toBeLessThan(target.find((tile) => tile.tabId === 'D')?.y ?? 0);
  });

  it('moves a target into the old cell of another tile', () => {
    const starting = projectTileGeometry(intent.slice(0, 2), 2);
    const target = starting.map((tile) => ({
      ...tile,
      x: tile.tabId === 'A' ? 6 : 0,
    }));
    const result = applyMovingTargets(starting, target);
    for (const { tabId, x, y, w, h } of target) {
      expect(result.get(tabId)).toEqual({ x, y, w, h });
    }
  });
  it('keeps a derived row-break gap and applies every live position while pinned', () => {
    const b = derivedTile('B');
    const d = derivedTile('D');
    expect(d.x).toBe(b.x);
    expect(d.y).toBeGreaterThan(b.y + b.h);
    const result = releaseAndLoad(true);
    expect(result.has('ghost')).toBe(false);
    for (const { tabId, x, y, w, h } of derived) {
      expect(result.get(tabId)).toEqual({ x, y, w, h, locked: undefined });
    }
  });

  it('shows top-gravity collapse when the same release is unpinned', () => {
    const d = derivedTile('D');
    expect(releaseAndLoad(false).get('D')?.y).toBeLessThan(d.y);
  });
});
