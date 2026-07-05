import 'reflect-metadata';

import { ElectronIDECapabilities } from './electron-ide-capabilities';

type Reader = {
  searchSymbols: jest.Mock;
};
type Indexer = {
  indexWorkspaceStream: jest.Mock;
};
type Fs = {
  readFile: jest.Mock;
};
type DepGraph = {
  isBuilt: jest.Mock;
  getDependents: jest.Mock;
};
type Ast = {
  analyzeSource: jest.Mock;
};
type TreeSitter = {
  query: jest.Mock;
};

/** Minimal stand-in for the workspace-intelligence Result type. */
function ok<T>(value: T) {
  return { isOk: () => true, isErr: () => false, value };
}
function err() {
  return { isOk: () => false, isErr: () => true, value: undefined };
}

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function makeWorkspace(root: string | undefined = 'C:/repo') {
  return { getWorkspaceRoot: jest.fn(() => root) };
}

function makeEditor(active: string | undefined = undefined) {
  return {
    getActiveEditorPath: jest.fn(() => active),
    onDidChangeActiveEditor: jest.fn(),
    onDidOpenDocument: jest.fn(),
  };
}

async function* streamOf(paths: string[]) {
  for (const p of paths) yield { path: p };
}

function build(overrides: {
  reader?: Reader;
  indexer?: Indexer;
  fs?: Fs;
  workspace?: { getWorkspaceRoot: () => string | undefined };
  editor?: { getActiveEditorPath: () => string | undefined };
  depGraph?: DepGraph;
  ast?: Ast;
  treeSitter?: TreeSitter;
}) {
  const reader = overrides.reader;
  const indexer = overrides.indexer ?? {
    indexWorkspaceStream: jest.fn(() => streamOf([])),
  };
  const fs = overrides.fs ?? { readFile: jest.fn() };
  const workspace = overrides.workspace ?? makeWorkspace();
  const editor = overrides.editor ?? makeEditor();
  // Defaults: graph unbuilt (brute scan), no imports, no excluded ranges.
  const depGraph = overrides.depGraph ?? {
    isBuilt: jest.fn(() => false),
    getDependents: jest.fn(() => []),
  };
  const ast = overrides.ast ?? { analyzeSource: jest.fn(async () => err()) };
  const treeSitter = overrides.treeSitter ?? {
    query: jest.fn(async () => ok([])),
  };
  const logger = makeLogger();

  const cap = new ElectronIDECapabilities(
    reader as never,
    indexer as never,
    fs as never,
    workspace as never,
    editor as never,
    depGraph as never,
    ast as never,
    treeSitter as never,
    logger as never,
  );
  return {
    cap,
    reader,
    indexer,
    fs,
    workspace,
    editor,
    depGraph,
    ast,
    treeSitter,
    logger,
  };
}

describe('ElectronIDECapabilities', () => {
  describe('lsp.getDefinition', () => {
    it('resolves the identifier under the cursor to its declaration via the symbol index', async () => {
      const reader: Reader = {
        searchSymbols: jest.fn(async () => ({
          bm25Only: false,
          hits: [
            {
              id: '1',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/foo.ts',
              kind: 'function',
              symbolName: 'doThing',
              subject: 'code:function:C:/repo/src/foo.ts:doThing',
              text: 'function doThing in src/foo.ts:41-50',
              tokenCount: 10,
              score: 0.9,
            },
            {
              id: '2',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/other.ts',
              kind: 'function',
              symbolName: 'doOther',
              subject: 'code:function:C:/repo/src/other.ts:doOther',
              text: 'function doOther in src/other.ts:5-9',
              tokenCount: 10,
              score: 0.5,
            },
          ],
        })),
      };
      const fs: Fs = {
        readFile: jest.fn(async () => 'const x = doThing();\n'),
      };
      const { cap } = build({ reader, fs });

      // cursor on "doThing" (col 12 is inside the identifier)
      const result = await cap.lsp.getDefinition('C:/repo/src/a.ts', 0, 12);

      expect(reader.searchSymbols).toHaveBeenCalledWith(
        'doThing',
        expect.any(Number),
        'C:/repo',
      );
      expect(result).toEqual([
        { file: 'C:/repo/src/foo.ts', line: 41, column: 0 },
      ]);
    });

    it('returns [] when no symbol reader is available', async () => {
      const fs: Fs = { readFile: jest.fn(async () => 'doThing()') };
      const { cap } = build({ reader: undefined, fs });
      expect(await cap.lsp.getDefinition('C:/repo/a.ts', 0, 0)).toEqual([]);
    });

    it('returns [] when the cursor is not on an identifier', async () => {
      const reader: Reader = { searchSymbols: jest.fn() };
      const fs: Fs = { readFile: jest.fn(async () => '   = 1;') };
      const { cap } = build({ reader, fs });
      expect(await cap.lsp.getDefinition('C:/repo/a.ts', 0, 0)).toEqual([]);
      expect(reader.searchSymbols).not.toHaveBeenCalled();
    });
  });

  describe('lsp.getReferences', () => {
    it('returns word-boundary matches across scanned files', async () => {
      const fs: Fs = {
        readFile: jest.fn(async (p: string) => {
          if (p === 'C:/repo/src/a.ts') return 'const doThing = 1;';
          if (p === 'C:/repo/src/b.ts')
            return 'doThing();\nconst doThingX = 2;\n  doThing(3);';
          return '';
        }),
      };
      const indexer: Indexer = {
        indexWorkspaceStream: jest.fn(() =>
          streamOf(['C:/repo/src/a.ts', 'C:/repo/src/b.ts']),
        ),
      };
      const { cap } = build({ indexer, fs });

      const result = await cap.lsp.getReferences('C:/repo/src/a.ts', 0, 6);

      // doThing in a.ts (col 6), b.ts line0 col0, b.ts line2 col2.
      // doThingX must NOT match (word boundary).
      expect(result).toEqual([
        { file: 'C:/repo/src/a.ts', line: 0, column: 6 },
        { file: 'C:/repo/src/b.ts', line: 0, column: 0 },
        { file: 'C:/repo/src/b.ts', line: 2, column: 2 },
      ]);
    });

    it('returns [] when there is no workspace root', async () => {
      const fs: Fs = { readFile: jest.fn(async () => 'doThing') };
      const { cap, indexer } = build({
        fs,
        workspace: {
          getWorkspaceRoot: jest.fn((): string | undefined => undefined),
        },
      });
      expect(await cap.lsp.getReferences('C:/repo/a.ts', 0, 0)).toEqual([]);
      expect(indexer.indexWorkspaceStream).not.toHaveBeenCalled();
    });
  });

  describe('lsp.getDefinition — import disambiguation (Tier 1 #3)', () => {
    function twoSameNamed(): Reader {
      return {
        searchSymbols: jest.fn(async () => ({
          bm25Only: false,
          hits: [
            {
              id: '1',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/foo.ts',
              kind: 'function',
              symbolName: 'doThing',
              subject: 'code:function:C:/repo/src/foo.ts:doThing',
              text: 'function doThing in src/foo.ts:41-50',
              tokenCount: 10,
              score: 0.9,
            },
            {
              id: '2',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/bar.ts',
              kind: 'function',
              symbolName: 'doThing',
              subject: 'code:function:C:/repo/src/bar.ts:doThing',
              text: 'function doThing in src/bar.ts:10-20',
              tokenCount: 10,
              score: 0.8,
            },
          ],
        })),
      };
    }

    it('picks the candidate from the module the cursor file imports', async () => {
      const fs: Fs = {
        readFile: jest.fn(
          async () => "import { doThing } from './foo';\ndoThing();",
        ),
      };
      const ast: Ast = {
        analyzeSource: jest.fn(async () =>
          ok({
            imports: [{ source: './foo', importedSymbols: ['doThing'] }],
            exports: [],
            functions: [],
            classes: [],
          }),
        ),
      };
      const { cap } = build({ reader: twoSameNamed(), fs, ast });

      // cursor on "doThing" in the import statement (col 9)
      const result = await cap.lsp.getDefinition('C:/repo/src/a.ts', 0, 9);

      expect(result).toEqual([
        { file: 'C:/repo/src/foo.ts', line: 41, column: 0 },
      ]);
    });

    it('returns all candidates when imports cannot disambiguate', async () => {
      const fs: Fs = { readFile: jest.fn(async () => 'doThing();') };
      const { cap } = build({ reader: twoSameNamed(), fs });

      const result = await cap.lsp.getDefinition('C:/repo/src/a.ts', 0, 0);

      expect(result).toEqual([
        { file: 'C:/repo/src/foo.ts', line: 41, column: 0 },
        { file: 'C:/repo/src/bar.ts', line: 10, column: 0 },
      ]);
    });

    it('prefers a declaration in the cursor file itself', async () => {
      const reader: Reader = {
        searchSymbols: jest.fn(async () => ({
          bm25Only: false,
          hits: [
            {
              id: '1',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/a.ts',
              kind: 'function',
              symbolName: 'thing',
              subject: 'code:function:C:/repo/src/a.ts:thing',
              text: 'function thing in src/a.ts:2-4',
              tokenCount: 10,
              score: 0.7,
            },
            {
              id: '2',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/other.ts',
              kind: 'function',
              symbolName: 'thing',
              subject: 'code:function:C:/repo/src/other.ts:thing',
              text: 'function thing in src/other.ts:5-9',
              tokenCount: 10,
              score: 0.9,
            },
          ],
        })),
      };
      const fs: Fs = { readFile: jest.fn(async () => 'thing();') };
      const { cap } = build({ reader, fs });

      const result = await cap.lsp.getDefinition('C:/repo/src/a.ts', 0, 0);

      expect(result).toEqual([
        { file: 'C:/repo/src/a.ts', line: 2, column: 0 },
      ]);
    });
  });

  describe('lsp.getReferences — dependency-graph scoping (Tier 1 #1)', () => {
    it('scopes the scan to declaration + transitive dependents when the graph is built', async () => {
      const reader: Reader = {
        searchSymbols: jest.fn(async () => ({
          bm25Only: false,
          hits: [
            {
              id: '1',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/foo.ts',
              kind: 'function',
              symbolName: 'doThing',
              subject: 'code:function:C:/repo/src/foo.ts:doThing',
              text: 'function doThing in src/foo.ts:0-2',
              tokenCount: 10,
              score: 0.9,
            },
          ],
        })),
      };
      const fs: Fs = {
        readFile: jest.fn(async (p: string) => {
          if (p === 'C:/repo/src/foo.ts') return 'export function doThing(){}';
          if (p === 'C:/repo/src/consumer.ts') return 'doThing();';
          return 'doThing(); // unrelated, must not be scanned';
        }),
      };
      const depGraph: DepGraph = {
        isBuilt: jest.fn(() => true),
        getDependents: jest.fn((p: string) =>
          p === 'C:/repo/src/foo.ts' ? ['C:/repo/src/consumer.ts'] : [],
        ),
      };
      const indexer: Indexer = { indexWorkspaceStream: jest.fn() };
      const { cap } = build({ reader, fs, depGraph, indexer });

      // cursor on "doThing" in foo.ts (col 16)
      const result = await cap.lsp.getReferences('C:/repo/src/foo.ts', 0, 16);

      expect(result).toEqual([
        { file: 'C:/repo/src/foo.ts', line: 0, column: 16 },
        { file: 'C:/repo/src/consumer.ts', line: 0, column: 0 },
      ]);
      // Scoped path must NOT fall back to the full-workspace stream.
      expect(indexer.indexWorkspaceStream).not.toHaveBeenCalled();
    });
  });

  describe('lsp.getReferences — string/comment filtering (Tier 1 #2)', () => {
    it('drops matches inside comment/string nodes reported by Tree-sitter', async () => {
      const fs: Fs = {
        readFile: jest.fn(async () => 'doThing(); // doThing in comment'),
      };
      const indexer: Indexer = {
        indexWorkspaceStream: jest.fn(() => streamOf(['C:/repo/src/b.ts'])),
      };
      // Comment spans from column 11 to end of line.
      const treeSitter: TreeSitter = {
        query: jest.fn(async () =>
          ok([
            {
              captures: [
                {
                  name: 'x',
                  startPosition: { row: 0, column: 11 },
                  endPosition: { row: 0, column: 32 },
                },
              ],
            },
          ]),
        ),
      };
      const { cap } = build({ fs, indexer, treeSitter });

      const result = await cap.lsp.getReferences('C:/repo/src/b.ts', 0, 0);

      // Only the real code occurrence at col 0 survives.
      expect(result).toEqual([
        { file: 'C:/repo/src/b.ts', line: 0, column: 0 },
      ]);
    });
  });

  describe('lsp.getSignatureHelp', () => {
    it('is unsupported and returns null', async () => {
      const { cap } = build({});
      expect(await cap.lsp.getSignatureHelp('a.ts', 0, 0)).toBeNull();
    });
  });

  describe('editor', () => {
    it('getActive reflects the active editor path', async () => {
      const { cap } = build({ editor: makeEditor('C:\\repo\\src\\x.ts') });
      expect(await cap.editor.getActive()).toEqual({
        file: 'C:/repo/src/x.ts',
        line: 0,
        column: 0,
      });
    });

    it('getActive returns null when no editor is active', async () => {
      const { cap } = build({ editor: makeEditor(undefined) });
      expect(await cap.editor.getActive()).toBeNull();
    });

    it('getDirtyFiles returns [] (not tracked in main process)', async () => {
      const { cap } = build({ editor: makeEditor('C:/repo/x.ts') });
      expect(await cap.editor.getDirtyFiles()).toEqual([]);
    });
  });

  describe('actions', () => {
    it('are graceful no-ops', async () => {
      const { cap } = build({});
      expect(await cap.actions.getAvailable('a.ts', 0)).toEqual([]);
      expect(await cap.actions.rename('a.ts', 0, 0, 'y')).toBe(false);
      expect(await cap.actions.organizeImports('a.ts')).toBe(false);
      expect(await cap.actions.fixAll('a.ts')).toBe(false);
    });
  });
});
