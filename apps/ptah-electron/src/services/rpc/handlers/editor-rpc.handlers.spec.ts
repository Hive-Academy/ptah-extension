/**
 * `EXCLUDED_DIRS_GLOB` specs — TASK_2026_206.
 *
 * The glob that `editor:searchInFiles` and `editor:listAllFiles` hand to
 * `findFiles` used to be two hand-written literals naming 5 of
 * `TREE_HIDDEN_DIRS`' 11 members. These tests pin the derivation itself, not
 * a snapshot of today's names, so adding a member to the shared set keeps
 * them green while reverting to a literal turns them red.
 */

import { TREE_HIDDEN_DIRS } from '@ptah-extension/shared';
import { EXCLUDED_DIRS_GLOB, EditorRpcHandlers } from './editor-rpc.handlers';

/** The brace body, i.e. what sits between `**\/{` and `}/**`. */
function braceMembers(glob: string): string[] {
  const match = glob.match(/^\*\*\/\{(.+)\}\/\*\*$/);
  if (!match) {
    throw new Error(`EXCLUDED_DIRS_GLOB is not a brace glob: ${glob}`);
  }
  return match[1].split(',');
}

describe('EXCLUDED_DIRS_GLOB', () => {
  it('names every TREE_HIDDEN_DIRS member and nothing else', () => {
    expect(braceMembers(EXCLUDED_DIRS_GLOB).sort()).toEqual(
      [...TREE_HIDDEN_DIRS].sort(),
    );
  });

  it('covers the six names the previous hand-written literal missed', () => {
    const members = new Set(braceMembers(EXCLUDED_DIRS_GLOB));
    for (const name of [
      '.hg',
      '.svn',
      '.DS_Store',
      '.Trash',
      '.tmp',
      '.temp',
    ]) {
      expect(members.has(name)).toBe(true);
    }
  });

  it('is derived from the shared set rather than restated', () => {
    expect(EXCLUDED_DIRS_GLOB).toBe(
      `**/{${[...TREE_HIDDEN_DIRS].join(',')}}/**`,
    );
  });
});

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
    for (const method of ['file:open', 'editor:openFile']) {
      const result = await call<{ success: boolean; content?: string }>(
        method,
        { path: `${WS}/node_modules/left-pad/index.js` },
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain('index.js');
    }
  });

  // -- the boundary that IS enforced -----------------------------------------

  it('still refuses every one of those three outside the workspace', async () => {
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
      await call<{ success: boolean; error?: string }>('file:open', {
        path: `${outside}/id_rsa`,
      }),
    ).toMatchObject({ success: false, error: 'Path is outside the workspace' });
  });
});
