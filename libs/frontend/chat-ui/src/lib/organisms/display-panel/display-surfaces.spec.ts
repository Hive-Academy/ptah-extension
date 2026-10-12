import {
  SURFACE_STORE_LIMITS,
  compilePtahUiBlock,
  resolveCompiledPtahUiBlock,
  type CompiledPtahUiBlock,
  type SurfaceComponent,
  type SurfaceContent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { displayFenceKey } from '../../services/ptah-ui-display-dock';
import {
  anonymousDisplaySurfaceId,
  buildDisplaySurfaces,
  compileDisplayFences,
  displayFenceSources,
  type DisplayCandidate,
  type DisplayCompile,
  type DisplayResolve,
} from './display-surfaces';

const UTF8 = new TextEncoder();
const countBytes = (value: unknown): number =>
  UTF8.encode(JSON.stringify(value)).length;

const resolve: DisplayResolve = (compiled) =>
  resolveCompiledPtahUiBlock(compiled, { snapshot: null, countBytes });

function displayFence(body: string, id?: string): string {
  return `\`\`\`ptah-ui display${id === undefined ? '' : ` ${id}`}\n${body}\`\`\`\n`;
}

function candidate(
  messageId: string,
  nodeId: string,
  orderKey: number,
  text: string,
  extra: Partial<DisplayCandidate> = {},
): DisplayCandidate {
  return {
    blockKey: `${messageId}:${nodeId}`,
    messageId,
    nodeId,
    orderKey,
    text,
    turnKey: 'turn-1',
    live: false,
    ...extra,
  };
}

const statBody = (title: string, value: number): string =>
  `title ${title}\nstats\n  Files | ${value}\n`;

/** One candidate per id, in order: `s0` … `s{n-1}`. */
function distinctIds(count: number): DisplayCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(
      `m${index}`,
      `n${index}`,
      index,
      displayFence(statBody(`Surface ${index}`, index), `s${index}`),
    ),
  );
}

function surfaceComponents(
  content: SurfaceContent,
): readonly SurfaceComponent[] {
  if (content.contract !== 'dashboard-spec/2')
    throw new Error('expected a dashboard-spec/2 surface');
  return content.surface.components;
}

const build = (candidates: readonly DisplayCandidate[]) =>
  buildDisplaySurfaces(candidates, compilePtahUiBlock, resolve, null);

function findComponent(
  components: readonly SurfaceComponent[],
  kind: SurfaceComponent['kind'],
): SurfaceComponent | undefined {
  for (const component of components) {
    if (component.kind === kind) return component;
    if ('children' in component) {
      const found = findComponent(component.children, kind);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

describe('buildDisplaySurfaces', () => {
  const cap = SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId;

  describe('R1.12 surface cap', () => {
    it(`keeps all ${cap} surfaces for ${cap} distinct ids`, () => {
      const result = build(distinctIds(cap));

      expect(result.surfaces.map((surface) => surface.key)).toEqual(
        Array.from({ length: cap }, (_, index) => `id:s${index}`),
      );
      for (const fence of result.fences) {
        expect(fence.status.kind).toBe('applied');
      }
    });

    it('drops the least recently updated surface for one more distinct id and marks its fence evicted', () => {
      const result = build(distinctIds(cap + 1));

      expect(result.surfaces).toHaveLength(cap);
      expect(result.surfaces.map((surface) => surface.key)).not.toContain(
        'id:s0',
      );
      expect(result.statuses.get(displayFenceKey('m0', 'n0', 0))).toEqual({
        kind: 'evicted',
        surfaceKey: 'id:s0',
        title: 'Surface 0',
        description: null,
      });
      expect(
        result.statuses.get(displayFenceKey(`m${cap}`, `n${cap}`, 0))?.kind,
      ).toBe('applied');
    });

    it('removes nothing when the extra block reuses an existing id', () => {
      const candidates = [
        ...distinctIds(cap),
        candidate(
          'm-again',
          'n-again',
          cap,
          displayFence(statBody('Again', 9), 's0'),
        ),
      ];
      const result = build(candidates);

      expect(result.surfaces).toHaveLength(cap);
      expect(result.statuses.get(displayFenceKey('m0', 'n0', 0))?.kind).toBe(
        'superseded',
      );
      expect(
        result.statuses.get(displayFenceKey('m-again', 'n-again', 0)),
      ).toEqual({
        kind: 'applied',
        surfaceKey: 'id:s0',
        title: 'Again',
        description: null,
      });
    });

    it('evicts by recency of create or update, not by creation alone', () => {
      const candidates = [
        ...distinctIds(cap),
        // s0 is updated, so s1 is now the least recently created or updated.
        candidate('m-up', 'n-up', cap, displayFence(statBody('Up', 1), 's0')),
        candidate(
          'm-new',
          'n-new',
          cap + 1,
          displayFence(statBody('New', 2), 'fresh'),
        ),
      ];
      const result = build(candidates);
      const keys = result.surfaces.map((surface) => surface.key);

      expect(keys).toContain('id:s0');
      expect(keys).not.toContain('id:s1');
      expect(result.statuses.get(displayFenceKey('m1', 'n1', 0))?.kind).toBe(
        'evicted',
      );
      // Both fences of the surviving s0 keep their own status.
      expect(result.statuses.get(displayFenceKey('m0', 'n0', 0))?.kind).toBe(
        'superseded',
      );
    });

    it('marks every fence of an evicted surface evicted, superseded ones included', () => {
      const candidates = [
        candidate('m-a', 'n-a', 0, displayFence(statBody('A1', 1), 'a')),
        candidate('m-b', 'n-b', 1, displayFence(statBody('A2', 2), 'a')),
        ...distinctIds(cap).map((entry) => ({
          ...entry,
          orderKey: entry.orderKey + 2,
        })),
      ];
      const result = build(candidates);

      expect(result.statuses.get(displayFenceKey('m-a', 'n-a', 0))?.kind).toBe(
        'evicted',
      );
      expect(result.statuses.get(displayFenceKey('m-b', 'n-b', 0))?.kind).toBe(
        'evicted',
      );
    });
  });

  it('R2.3: an updated surface equals a fresh render of the new block alone', () => {
    const updated = build([
      candidate('m1', 'n1', 0, displayFence(statBody('First', 1), 'x')),
      candidate('m2', 'n2', 1, displayFence(statBody('Second', 2), 'x')),
    ]);
    const fresh = build([
      candidate('m3', 'n3', 0, displayFence(statBody('Second', 2), 'x')),
    ]);

    expect(updated.surfaces).toHaveLength(1);
    expect(updated.surfaces[0].content).toEqual(fresh.surfaces[0].content);
    expect(updated.surfaces[0].title).toBe('Second');
  });

  it('R2.4: one stat changes and the expanded accordion elsewhere keeps its view state', () => {
    const body = (files: number) =>
      `title Overview\nstats\n  Files | ${files}\naccordion More\n  note info Later\n`;
    const first = build([
      candidate('m1', 'n1', 0, displayFence(body(1), 'over')),
    ]);
    const second = buildDisplaySurfaces(
      [
        candidate('m1', 'n1', 0, displayFence(body(1), 'over')),
        candidate('m2', 'n2', 1, displayFence(body(2), 'over')),
      ],
      compilePtahUiBlock,
      resolve,
      first.surfaces,
    );
    const components = surfaceComponents(second.surfaces[0].content);
    const accordion = findComponent(components, 'accordion');
    const stat = findComponent(components, 'stat');

    expect(accordion).toBeDefined();
    expect(stat).toBeDefined();
    const retained = second.surfaces[0].retainedViewStateIds;
    expect(retained.has(accordion?.id ?? '')).toBe(true);
    expect(retained.has(stat?.id ?? '')).toBe(false);
  });

  it('D10: a surface the previous result did not hold retains no view state', () => {
    const result = build([
      candidate('m1', 'n1', 0, displayFence(statBody('New', 1), 'x')),
    ]);

    expect(result.surfaces[0].retainedViewStateIds.size).toBe(0);
  });

  it('R2.5: a block naming a reserved `ptah.` id is invalid and never enters the panel', () => {
    const compile = jest.fn<
      ReturnType<DisplayCompile>,
      Parameters<DisplayCompile>
    >(compilePtahUiBlock);
    const result = buildDisplaySurfaces(
      [
        candidate(
          'm1',
          'n1',
          0,
          displayFence(statBody('Spoof', 1), 'ptah.turn-summary'),
        ),
      ],
      compile,
      resolve,
      null,
    );

    expect(result.surfaces).toEqual([]);
    expect(result.statuses.get(displayFenceKey('m1', 'n1', 0))).toEqual({
      kind: 'invalid',
      reason: 'reserved display id',
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it('R2.6: an invalid update leaves the previous content and status in place', () => {
    const result = build([
      candidate('m1', 'n1', 0, displayFence(statBody('Good', 1), 'x')),
      candidate('m2', 'n2', 1, displayFence('title Bad\ngauge 5\n', 'x')),
    ]);

    expect(result.surfaces).toHaveLength(1);
    expect(result.surfaces[0].title).toBe('Good');
    expect(result.statuses.get(displayFenceKey('m1', 'n1', 0))?.kind).toBe(
      'applied',
    );
    const invalid = result.statuses.get(displayFenceKey('m2', 'n2', 0));
    expect(invalid?.kind).toBe('invalid');
    expect(invalid && 'reason' in invalid ? invalid.reason : '').not.toBe('');
  });

  it('R2.6: a resolve that fails or throws is invalid', () => {
    const failing: DisplayResolve = () => ({ ok: false, reason: 'nope' });
    const throwing: DisplayResolve = () => {
      throw new Error('boom');
    };
    const one = [candidate('m1', 'n1', 0, displayFence(statBody('A', 1), 'x'))];

    expect(
      buildDisplaySurfaces(one, compilePtahUiBlock, failing, null).statuses.get(
        displayFenceKey('m1', 'n1', 0),
      ),
    ).toEqual({ kind: 'invalid', reason: 'nope' });
    expect(
      buildDisplaySurfaces(
        one,
        compilePtahUiBlock,
        throwing,
        null,
      ).statuses.get(displayFenceKey('m1', 'n1', 0)),
    ).toEqual({ kind: 'invalid', reason: 'internal error' });
  });

  it('R2.8: applies across messages, nodes and ordinals in transcript order; the later block wins', () => {
    const twoInOne =
      displayFence(statBody('Node A0', 1), 'x') +
      'between\n' +
      displayFence(statBody('Node A1', 2), 'x');
    // Input order is not message order: orderKey decides, input order breaks ties.
    const result = build([
      candidate('m2', 'n3', 2, displayFence(statBody('Last', 4), 'x')),
      candidate('m1', 'nA', 1, twoInOne),
      candidate('m1', 'nB', 1, displayFence(statBody('Node B', 3), 'x')),
    ]);

    expect(result.fences.map((fence) => fence.fenceKey)).toEqual([
      displayFenceKey('m1', 'nA', 0),
      displayFenceKey('m1', 'nA', 1),
      displayFenceKey('m1', 'nB', 0),
      displayFenceKey('m2', 'n3', 0),
    ]);
    expect(result.surfaces[0].title).toBe('Last');
    expect(result.fences.map((fence) => fence.status.kind)).toEqual([
      'superseded',
      'superseded',
      'superseded',
      'applied',
    ]);
  });

  it('R2.9: the same candidates rebuild an equal panel', () => {
    const candidates = [
      ...distinctIds(cap + 2),
      candidate('m-anon', 'n-anon', 99, displayFence(statBody('Anon', 1))),
    ];

    expect(build(candidates)).toEqual(build(candidates));
  });

  it('keys anonymous blocks by blockKey and ordinal, and statuses by the chip lookup key', () => {
    const text =
      '```ptah-ui\nstats\n  Inline | 1\n```\n' +
      displayFence(statBody('Anon', 1)) +
      displayFence(statBody('Anon again', 2));
    const result = build([candidate('msg', 'node', 0, text)]);

    // Inline and display fences share one ordinal sequence.
    expect(result.surfaces.map((surface) => surface.key)).toEqual([
      'anon:msg:node:1',
      'anon:msg:node:2',
    ]);
    // What the chip computes finds what was published.
    const chipLookup = result.statuses.get(displayFenceKey('msg', 'node', 1));
    expect(chipLookup).toEqual({
      kind: 'applied',
      surfaceKey: 'anon:msg:node:1',
      title: 'Anon',
      description: null,
    });
    expect(result.statuses.has(displayFenceKey('msg', 'node', 0))).toBe(false);
  });

  it('R2.7: an unclosed (streaming) display fence yields nothing', () => {
    const result = build([
      candidate('m1', 'n1', 0, '```ptah-ui display x\ntitle Half\nstats\n'),
    ]);

    expect(result.surfaces).toEqual([]);
    expect(result.fences).toEqual([]);
  });

  it('reports `null` title for an untitled block and carries turn and live flags', () => {
    const result = build([
      candidate('m1', 'n1', 0, displayFence('stats\n  Files | 1\n', 'x'), {
        turnKey: 'turn-7',
        live: true,
      }),
    ]);

    expect(result.surfaces[0].title).toBeNull();
    expect(result.fences[0]).toMatchObject({ turnKey: 'turn-7', live: true });
    expect(result.surfaces[0].turnKey).toBe('turn-7');
  });
});

describe('compileDisplayFences', () => {
  it('compiles each closed display fence once with its id or an id-safe anonymous surface id', () => {
    const compile = jest.fn<
      ReturnType<DisplayCompile>,
      Parameters<DisplayCompile>
    >(compilePtahUiBlock);
    const fences = compileDisplayFences(
      [
        candidate(
          'm1',
          'node/with:odd chars',
          0,
          displayFence(statBody('A', 1), 'named') +
            displayFence(statBody('B', 2)),
        ),
      ],
      compile,
    );

    expect(fences).toHaveLength(2);
    expect(compile.mock.calls.map(([, surfaceId]) => surfaceId)).toEqual([
      'named',
      anonymousDisplaySurfaceId('node/with:odd chars', 1),
    ]);
    expect(anonymousDisplaySurfaceId('node/with:odd chars', 1)).toBe(
      'display-node-with-odd-chars-1',
    );
  });

  it('turns a throwing compile into an internal error', () => {
    const fences = compileDisplayFences(
      [candidate('m1', 'n1', 0, displayFence(statBody('A', 1), 'x'))],
      () => {
        throw new Error('boom');
      },
    );

    expect(fences[0].compiled).toEqual({ ok: false, reason: 'internal error' });
  });

  it('reports the host sources the fences name', () => {
    const fences = compileDisplayFences(
      [
        candidate(
          'm1',
          'n1',
          0,
          displayFence('stats\n  Lanes | $limits.lanes\n', 'x') +
            displayFence(statBody('A', 1), 'y'),
        ),
      ],
      compilePtahUiBlock,
    );

    expect([...displayFenceSources(fences)]).toEqual(['limits']);
    expect((fences[1].compiled as CompiledPtahUiBlock).usedSources.size).toBe(
      0,
    );
  });
});
