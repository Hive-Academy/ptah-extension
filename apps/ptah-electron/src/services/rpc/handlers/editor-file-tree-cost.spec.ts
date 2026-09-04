/**
 * `editor:getFileTree` cost specs — TASK_2026_340.
 *
 * The explorer paints the root's children COLLAPSED, and everything below that
 * is fetched on expand through `editor:getDirectoryChildren`. The handler
 * nevertheless materialized six levels, which on this monorepo meant 10738
 * directory reads and a 10.91 MB payload before the first paint — and, under
 * contention with the post-window boot, no answer inside 65 seconds.
 *
 * Both properties below are asserted as COUNTS and ORDERING, never as timings.
 * A wall-clock assertion on a directory walk is a flake generator, and the two
 * things that actually regressed here are countable: how many directories the
 * walk touches, and whether siblings are read one at a time.
 *
 * Fixture shape: a perfectly balanced tree, `fanout` directories per level,
 * `depth` levels deep. Balanced because the arithmetic then states the
 * expectation — at fanout 3 the levels are 1, 3, 9, 27, 81 directories, so the
 * read count alone says which depth the handler stopped at, with no ambiguity.
 */

import { EditorRpcHandlers } from './editor-rpc.handlers';

const WS = '/ws';

type RpcMethod = (params?: unknown) => Promise<unknown>;

interface TreeNode {
  name: string;
  type: string;
  children?: TreeNode[];
  needsLoad?: boolean;
}

/** VS Code's `FileType`: 1 = file, 2 = directory. */
const FILE = 1;
const DIRECTORY = 2;

interface Harness {
  methods: Map<string, RpcMethod>;
  /** Every path handed to `readDirectory`, in call order. */
  reads: string[];
  /** Paths whose read had STARTED but not yet resolved, at each start. */
  concurrentAtStart: number[];
}

/**
 * Build the handler over a synthetic balanced tree.
 *
 * `settle` controls when a `readDirectory` resolves. The default resolves on a
 * microtask, which is enough for the concurrency assertion: a sequential walk
 * cannot start sibling two until sibling one has resolved, so the in-flight
 * count never exceeds 1.
 */
function buildHarness(opts: { fanout: number; depth: number }): Harness {
  const { fanout, depth } = opts;
  const reads: string[] = [];
  const concurrentAtStart: number[] = [];
  let inFlight = 0;

  const levelOf = (dirPath: string): number => {
    const rest = dirPath.slice(WS.length).replace(/^\//, '');
    return rest === '' ? 0 : rest.split('/').length;
  };

  const fs = {
    readDirectory: async (dirPath: string) => {
      const normalized = dirPath.replace(/\\/g, '/');
      reads.push(normalized);
      inFlight += 1;
      concurrentAtStart.push(inFlight);
      try {
        // Yield twice so a genuinely concurrent caller has a turn to start its
        // own read before this one resolves. One turn is not enough: the
        // sequential form also yields once, at its own await.
        await Promise.resolve();
        await Promise.resolve();

        const level = levelOf(normalized);
        if (level >= depth) return [];
        return [
          ...Array.from({ length: fanout }, (_, i) => ({
            name: `d${i}`,
            type: DIRECTORY,
          })),
          { name: 'file.ts', type: FILE },
        ];
      } finally {
        inFlight -= 1;
      }
    },
    readFile: async (filePath: string) => `content of ${filePath}`,
  };

  const methods = new Map<string, RpcMethod>();
  const fake = <T>(value: unknown): T => value as T;

  const handlers = new EditorRpcHandlers(
    fake(
      Object.fromEntries(
        ['error', 'warn', 'info', 'debug'].map((k) => [k, jest.fn()]),
      ),
    ),
    fake({
      registerMethod: (name: string, fn: RpcMethod) => methods.set(name, fn),
    }),
    fake(fs),
    fake({ getWorkspaceRoot: () => WS, getWorkspaceFolders: () => [WS] }),
    fake({ notifyFileOpened: jest.fn() }),
    fake({ broadcastMessage: jest.fn(async () => undefined) }),
  );
  handlers.register();

  return { methods, reads, concurrentAtStart };
}

const call = async <T>(
  methods: Map<string, RpcMethod>,
  name: string,
  params?: unknown,
): Promise<T> => {
  const method = methods.get(name);
  if (!method) throw new Error(`method not registered: ${name}`);
  return (await method(params)) as T;
};

describe('editor:getFileTree — how much of the tree it materializes', () => {
  it('stops at the second level and marks the boundary for lazy loading', async () => {
    // Deep enough that a depth-6 walk would be unmistakable in the read count.
    const h = buildHarness({ fanout: 3, depth: 8 });

    const result = await call<{ success: boolean; tree: TreeNode[] }>(
      h.methods,
      'editor:getFileTree',
    );

    expect(result.success).toBe(true);

    // Level 0 is the root; level 1 is its three directories. A walk that
    // stopped at depth 2 reads exactly those four and nothing deeper.
    expect(h.reads).toHaveLength(1 + 3);
    expect(h.reads.filter((p) => p.split('/').length > 3)).toEqual([]);

    // Depth 2 means the root's children are materialized WITH their own
    // listing, so the explorer can expand one level without a round trip. The
    // boundary sits on the generation below that.
    const dirs = result.tree.filter((n) => n.type === 'directory');
    expect(dirs).toHaveLength(3);
    for (const dir of dirs) {
      expect(dir.needsLoad).toBeUndefined();
      expect(dir.children?.length).toBeGreaterThan(0);

      // The boundary is advertised here, which is what lets the renderer fetch
      // on expand instead of the walk pre-fetching for it.
      const grandchildren = (dir.children ?? []).filter(
        (n) => n.type === 'directory',
      );
      expect(grandchildren).toHaveLength(3);
      for (const grandchild of grandchildren) {
        expect(grandchild.needsLoad).toBe(true);
        expect(grandchild.children).toEqual([]);
      }
    }
  });

  it('does not amplify reads as the tree gets deeper', async () => {
    // The defect's signature: cost scaling with the tree rather than with the
    // level being shown. Same fanout, three very different depths.
    const counts: number[] = [];
    for (const depth of [3, 6, 10]) {
      const h = buildHarness({ fanout: 4, depth });
      await call(h.methods, 'editor:getFileTree');
      counts.push(h.reads.length);
    }

    // Root + 4 first-level directories, whatever lies beneath.
    expect(counts).toEqual([5, 5, 5]);
  });

  it('still returns files and directories in the handler order', async () => {
    // Concurrency must not reorder the result: `Promise.all` preserves input
    // order and the sort still runs before the fan-out.
    const h = buildHarness({ fanout: 3, depth: 4 });

    const result = await call<{ tree: TreeNode[] }>(
      h.methods,
      'editor:getFileTree',
    );

    expect(result.tree.map((n) => n.name)).toEqual([
      'd0',
      'd1',
      'd2',
      'file.ts',
    ]);
    expect(result.tree.map((n) => n.type)).toEqual([
      'directory',
      'directory',
      'directory',
      'file',
    ]);
  });
});

describe('editor:getFileTree — sibling directories are read concurrently', () => {
  it('has more than one directory read in flight at once', async () => {
    // The sequential form awaits each child inside the loop, so a second read
    // can only start after the first has resolved and `inFlight` is back to 0.
    // Its maximum is therefore exactly 1, whatever the fanout.
    const h = buildHarness({ fanout: 5, depth: 4 });

    await call(h.methods, 'editor:getFileTree');

    expect(Math.max(...h.concurrentAtStart)).toBeGreaterThan(1);
  });

  it('fans out the whole level, not just a pair', async () => {
    const h = buildHarness({ fanout: 6, depth: 4 });

    await call(h.methods, 'editor:getFileTree');

    // Six siblings under one root: all six should be in flight together.
    expect(Math.max(...h.concurrentAtStart)).toBe(6);
  });
});

describe('editor:getDirectoryChildren — the lazy half the depth relies on', () => {
  it('returns one more level so an expanded folder shows its own children', async () => {
    const h = buildHarness({ fanout: 3, depth: 8 });

    const result = await call<{ success: boolean; children: TreeNode[] }>(
      h.methods,
      'editor:getDirectoryChildren',
      { dirPath: `${WS}/d0` },
    );

    expect(result.success).toBe(true);
    const dirs = result.children.filter((n) => n.type === 'directory');
    expect(dirs).toHaveLength(3);

    // Same shape as the initial tree: one level materialized, the boundary on
    // the generation below it. That symmetry is what makes expanding feel the
    // same at every level.
    for (const dir of dirs) {
      expect(dir.needsLoad).toBeUndefined();
      const grandchildren = (dir.children ?? []).filter(
        (n) => n.type === 'directory',
      );
      for (const grandchild of grandchildren) {
        expect(grandchild.needsLoad).toBe(true);
      }
    }
  });
});
