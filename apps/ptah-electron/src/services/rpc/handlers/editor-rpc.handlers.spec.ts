import { EditorRpcHandlers } from './editor-rpc.handlers';

/**
 * Exclusion reachability — TASK_2026_208.
 *
 * `TREE_HIDDEN_DIRS` filters NAVIGATION, not ACCESS, and the gap between
 * those two was behaviour nobody had written down. These tests state it
 * executably, in both directions, so the prose in the header of
 * `workspace-scan.constants.ts` cannot quietly drift away from the code:
 *
 *  - walking from the workspace root never surfaces an excluded directory;
 *  - naming one explicitly — as `rootPath`, as `dirPath`, or as a file path
 *    to open — enumerates or reads it, with only the workspace check in the
 *    way.
 *
 * If the asymmetry is ever made symmetric, that is a product decision and
 * these tests are the thing that forces it to be a conscious one.
 */

const WS = 'C:/ws';

/** In-memory directory listings. `type` follows FileType: 1 = file, 2 = directory. */
const DIRS: Record<string, Array<{ name: string; type: number }>> = {
  [WS]: [
    { name: 'node_modules', type: 2 },
    { name: 'src', type: 2 },
    { name: 'readme.md', type: 1 },
  ],
  [`${WS}/src`]: [{ name: 'main.ts', type: 1 }],
  [`${WS}/node_modules`]: [{ name: 'left-pad', type: 2 }],
  [`${WS}/node_modules/left-pad`]: [
    { name: 'index.js', type: 1 },
    { name: 'node_modules', type: 2 },
  ],
  [`${WS}/node_modules/left-pad/node_modules`]: [
    { name: 'nested.js', type: 1 },
  ],
};

type RpcMethod = (params?: unknown) => Promise<unknown>;

interface TreeNode {
  name: string;
  type: string;
  children?: TreeNode[];
  needsLoad?: boolean;
}

function buildHandlers(): Map<string, RpcMethod> {
  const methods = new Map<string, RpcMethod>();

  const fs = {
    readDirectory: async (dirPath: string) => {
      const listing = DIRS[dirPath.replace(/\\/g, '/')];
      // buildFileTree swallows a throw into [] — same as a real ENOENT.
      if (!listing) throw new Error(`ENOENT: ${dirPath}`);
      return listing;
    },
    readFile: async (filePath: string) => `content of ${filePath}`,
  };

  // The constructor is @injectable() over six tokens. This suite passes the
  // six fakes positionally rather than standing up a DI container; each is
  // narrowed to only the members the handler actually reaches.
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
    fake({
      getWorkspaceRoot: () => WS,
      getWorkspaceFolders: () => [WS],
    }),
    fake({ notifyFileOpened: jest.fn() }),
    fake({ broadcastMessage: jest.fn(async () => undefined) }),
  );

  handlers.register();
  return methods;
}

describe('exclusion reachability — navigation is filtered, explicit access is not (TASK_2026_208)', () => {
  let methods: Map<string, RpcMethod>;

  const call = async <T>(name: string, params?: unknown): Promise<T> => {
    const method = methods.get(name);
    if (!method) throw new Error(`method not registered: ${name}`);
    return (await method(params)) as T;
  };

  const names = (nodes: TreeNode[] | undefined): string[] =>
    (nodes ?? []).map((n) => n.name);

  beforeEach(() => {
    methods = buildHandlers();
  });

  // -- the filtered half ------------------------------------------------------

  it('hides an excluded directory when walking from the workspace root', async () => {
    const result = await call<{ success: boolean; tree: TreeNode[] }>(
      'editor:getFileTree',
    );

    expect(result.success).toBe(true);
    // `src` and `readme.md` are there; the excluded sibling is not — so this
    // is a filter, not an empty walk.
    expect(names(result.tree).sort()).toEqual(['readme.md', 'src']);
  });

  it('hides an excluded directory nested below the root too', async () => {
    const result = await call<{ tree: TreeNode[] }>('editor:getFileTree', {
      // Explicit root, but the exclusion still applies to everything BELOW it.
      rootPath: `${WS}/node_modules/left-pad`,
    });

    expect(names(result.tree)).toEqual(['index.js']);
  });

  // -- the unfiltered half ----------------------------------------------------

  it('enumerates an excluded directory named explicitly as rootPath', async () => {
    const result = await call<{ success: boolean; tree: TreeNode[] }>(
      'editor:getFileTree',
      { rootPath: `${WS}/node_modules` },
    );

    expect(result.success).toBe(true);
    expect(names(result.tree)).toEqual(['left-pad']);
  });

  it('enumerates an excluded directory named explicitly as dirPath', async () => {
    const result = await call<{ success: boolean; children: TreeNode[] }>(
      'editor:getDirectoryChildren',
      { dirPath: `${WS}/node_modules` },
    );

    expect(result.success).toBe(true);
    expect(names(result.children)).toEqual(['left-pad']);
  });

  it('opens a file inside an excluded directory, applying no exclusion test at all', async () => {
    // 'file:open' moved to ElectronFileOpenRpcHandlers (TASK_2026_385 Batch
    // 3.2); this class now serves only its Electron-specific alias.
    const result = await call<{ success: boolean; content?: string }>(
      'editor:openFile',
      { path: `${WS}/node_modules/left-pad/index.js` },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('index.js');
  });

  // -- the boundary that IS enforced -----------------------------------------

  it('still refuses every one of those outside the workspace', async () => {
    const outside = 'D:/elsewhere/secrets';

    expect(
      await call<{ success: boolean; error?: string }>('editor:getFileTree', {
        rootPath: outside,
      }),
    ).toMatchObject({ success: false, error: 'Path is outside the workspace' });

    expect(
      await call<{ success: boolean; error?: string }>(
        'editor:getDirectoryChildren',
        { dirPath: outside },
      ),
    ).toMatchObject({ success: false, error: 'Path is outside the workspace' });

    expect(
      await call<{ success: boolean; error?: string }>('editor:openFile', {
        path: `${outside}/id_rsa`,
      }),
    ).toMatchObject({ success: false, error: 'Path is outside the workspace' });
  });
});
