import 'reflect-metadata';

import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  IncompleteFileSearchError,
  withCoverageVerdict,
  type CoverageFields,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import {
  AstAnalysisService,
  DependencyGraphService,
  IgnorePatternResolverService,
  TreeSitterParserService,
} from '@ptah-extension/workspace-intelligence';
import { ElectronIDECapabilities } from './electron-ide-capabilities';

/*
 * The index-independent definition guard below runs the REAL tree-sitter
 * import analysis. The project-wide `wasm-bundle-dir` stub throws on purpose,
 * so this file points it at the real grammars, the same two shims as
 * `libs/backend/vscode-lm-tools/.../code-outliner.adapter.spec.ts`:
 *  - `wasm-bundle-dir` resolves grammars from @vscode/tree-sitter-wasm and the
 *    runtime from web-tree-sitter;
 *  - `Language.load(path)` in the CJS web-tree-sitter build uses a dynamic
 *    `import('fs/promises')` Jest's VM rejects, so bytes are handed over.
 * Every other test here still injects mocked AST/tree-sitter collaborators.
 */
jest.mock('wasm-bundle-dir', () => {
  const p = require('path');
  const grammarDir = p.join(
    p.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = p.dirname(require.resolve('web-tree-sitter'));
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? p.join(runtimeDir, filename)
        : p.join(grammarDir, filename),
  };
});

jest.mock('web-tree-sitter', () => {
  const actual =
    jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
  const fsSync = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(fsSync.readFileSync(input))
        : input,
    );
  return actual;
});

/*
 * TS/JS do not claim `referenceScopeComplete` in the shipped registry (Batch
 * 26b r1 B2), so no shipped language can pass the narrowing gate today. The
 * gate's other conditions are exercised by granting the claim per test:
 * `mockScopeComplete` lists the languages whose graph edges claim it. Every
 * other registry value is the real one.
 */
const mockScopeComplete = new Set<string>();
jest.mock('@ptah-extension/workspace-intelligence', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/workspace-intelligence')
  >('@ptah-extension/workspace-intelligence');
  const registry = Object.fromEntries(
    Object.entries(actual.LANGUAGE_REGISTRY).map(([id, entry]) => [
      id,
      {
        ...entry,
        capabilities: {
          ...entry.capabilities,
          get graphEdges() {
            const edges = entry.capabilities.graphEdges;
            return edges && mockScopeComplete.has(id)
              ? { ...edges, referenceScopeComplete: true }
              : edges;
          },
        },
      },
    ]),
  );
  return { ...actual, LANGUAGE_REGISTRY: registry };
});

/** Grant TS/JS/TSX `referenceScopeComplete` for the tests of one describe. */
function withTsScopeCompleteClaim(): void {
  beforeEach(() => {
    mockScopeComplete.add('typescript');
    mockScopeComplete.add('javascript');
    mockScopeComplete.add('tsx');
  });
  afterEach(() => mockScopeComplete.clear());
}

type Reader = {
  searchSymbols: jest.Mock;
};
/** Stand-in for text-scan discovery: `IFileSystemProvider.findFiles`. */
type Indexer = {
  findFiles: jest.Mock;
};
type Fs = {
  readFile: jest.Mock;
  exists?: jest.Mock;
  stat?: jest.Mock;
};
type DepGraph = {
  isBuilt: jest.Mock;
  getDependents: jest.Mock;
  getCoverageReport?: jest.Mock;
  getCoverageReportForFile?: jest.Mock;
  resolveNodePath?: jest.Mock;
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

/** What the text scan's discovery (`findFiles`) resolves to. */
function streamOf(paths: string[]): Promise<string[]> {
  return Promise.resolve(paths);
}

/**
 * A graph's published language coverage: clean (complete census, TS/JS only,
 * clean resolution) unless overridden.
 */
function graphCoverage(overrides: Partial<CoverageFields> = {}) {
  return withCoverageVerdict({
    supportedLanguages: ['typescript', 'javascript'],
    census: 'complete',
    analyzed: 3,
    unchecked: 0,
    failed: 0,
    unsupported: 0,
    unrecognised: 0,
    nonSource: 0,
    excluded: null,
    omittedByCap: 0,
    resolution: {
      external: 0,
      unresolvedInternal: 0,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'complete',
    },
    ...overrides,
  });
}

/**
 * A built graph for `C:/repo` publishing `coverage` (none when undefined),
 * with the given reverse edges; every path is its own node unless listed in
 * `notInGraph`.
 */
function builtGraph(
  coverage: LanguageCoverage | undefined,
  dependents: Record<string, string[]> = {},
  notInGraph: string[] = [],
): Required<DepGraph> {
  const report = () =>
    coverage === undefined
      ? undefined
      : {
          files: { graphedFiles: 3, discoveredFiles: 3 },
          languages: coverage,
        };
  return {
    isBuilt: jest.fn((wsRoot?: string) => wsRoot === 'C:/repo'),
    getDependents: jest.fn((p: string) => dependents[p] ?? []),
    getCoverageReport: jest.fn(report),
    // One graph: it answers every file.
    getCoverageReportForFile: jest.fn(report),
    resolveNodePath: jest.fn((p: string) =>
      notInGraph.includes(p) ? undefined : p,
    ),
  };
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
  realpath?: (p: string) => Promise<string>;
  ignoreResolver?: unknown;
}) {
  const reader = overrides.reader;
  // Default: no workspace ignore files.
  const ignoreResolver = overrides.ignoreResolver ?? {
    parseWorkspaceIgnoreFiles: jest.fn(async () => []),
    compileMatcher: jest.fn(() => () => false),
  };
  const indexer = overrides.indexer ?? {
    findFiles: jest.fn(() => streamOf([])),
  };
  // Every file is small unless a test stats otherwise; discovery comes from
  // `indexer`. The caller's own mock functions are kept (same references).
  const fs = {
    stat: jest.fn(async () => ({ size: 1 })),
    ...(overrides.fs ?? { readFile: jest.fn() }),
    findFiles: indexer.findFiles,
  };
  const workspace = overrides.workspace ?? makeWorkspace();
  const editor = overrides.editor ?? makeEditor();
  // Defaults: graph unbuilt (brute scan), no imports, no excluded ranges.
  const depGraph = overrides.depGraph ?? {
    isBuilt: jest.fn(() => false),
    getDependents: jest.fn(() => []),
    getCoverageReport: jest.fn(() => undefined),
    getCoverageReportForFile: jest.fn(() => undefined),
    resolveNodePath: jest.fn(() => undefined),
  };
  const ast = overrides.ast ?? { analyzeSource: jest.fn(async () => err()) };
  const treeSitter = overrides.treeSitter ?? {
    query: jest.fn(async () => ok([])),
  };
  const logger = makeLogger();
  // Virtual paths (C:/repo, //server/share) do not exist on disk: the default
  // canonicalisation is the identity; on-disk suites pass the real realpath.
  const realpath = overrides.realpath ?? (async (p: string) => p);

  const cap = new ElectronIDECapabilities(
    reader as never,
    fs as never,
    ignoreResolver as never,
    workspace as never,
    editor as never,
    depGraph as never,
    ast as never,
    treeSitter as never,
    logger as never,
    realpath,
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

    it('returns [] with no symbol reader when nothing declares the identifier', async () => {
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
        findFiles: jest.fn(() =>
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
      expect(indexer.findFiles).not.toHaveBeenCalled();
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

  describe('lsp.getDefinition — without the symbol index (TASK_2026_559 Batch 8)', () => {
    const silentLogger = (): Logger =>
      ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        dispose: jest.fn(),
      }) as unknown as Logger;

    /** A reader that answers every query with no hits (empty or stale index). */
    function emptyReader(): Reader {
      return {
        searchSymbols: jest.fn(async () => ({ bm25Only: false, hits: [] })),
      };
    }

    /** IFileSystemProvider subset over the real disk. */
    function diskFs(): Required<Omit<Fs, 'stat'>> {
      return {
        readFile: jest.fn((p: string) => nodeFs.readFile(p, 'utf-8')),
        exists: jest.fn((p: string) =>
          nodeFs.access(p).then(
            () => true,
            () => false,
          ),
        ),
      };
    }

    let parser: TreeSitterParserService;
    let ast: AstAnalysisService;
    let tmp: string;
    let root: string;

    beforeAll(async () => {
      parser = new TreeSitterParserService(silentLogger());
      const init = await parser.initialize();
      if (init.isErr()) {
        throw init.error ?? new Error('tree-sitter initialisation failed');
      }
      ast = new AstAnalysisService(silentLogger(), parser);

      tmp = (
        await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'ptah-lsp-def-'))
      ).replace(/\\/g, '/');
      root = `${tmp}/ws`;
      const files: Record<string, string> = {
        'ws/src/widget.ts': [
          '/** A widget. */',
          'export class Widget {',
          '  render(): string {',
          "    return 'w';",
          '  }',
          '}',
          '',
        ].join('\n'),
        'ws/src/consumer.ts': [
          "import { Widget } from './widget';",
          '',
          'export const w = new Widget();',
          '',
        ].join('\n'),
        'ws/src/esm-consumer.ts': [
          "import { Widget } from './widget.js';",
          'export const w = new Widget();',
          '',
        ].join('\n'),
        'ws/src/leak.ts': [
          "import { Secret } from '../../outside/secret';",
          'export const s = new Secret();',
          '',
        ].join('\n'),
        'ws/src/pkg.ts': [
          "import { Injectable } from 'tsyringe';",
          'export const i = Injectable;',
          '',
        ].join('\n'),
        'outside/secret.ts': 'export class Secret {}\n',
        // Revision 1 fixtures (batch-8-code-logic-review-r1.md).
        'ws/src/junction-consumer.ts': [
          "import { Secret } from '../linked/secret';",
          'export const s = new Secret();',
          '',
        ].join('\n'),
        'ws/src/ghost.ts': ['/*', 'class Ghost {}', '*/', 'Ghost();', ''].join(
          '\n',
        ),
        'ws/src/commented.ts': [
          "import { Widget } from './widget';",
          '/*',
          'class Widget {}',
          '*/',
          'export const w = new Widget();',
          '',
        ].join('\n'),
        'ws/src/templated.ts': [
          "import { Widget } from './widget';",
          'export const doc = `',
          'export class Widget {}',
          '`;',
          'export const w = new Widget();',
          '',
        ].join('\n'),
        'ws/src/nested.ts': [
          "import { Widget } from './widget';",
          'export function make(): unknown {',
          '  class Widget {}',
          '  return new Widget();',
          '}',
          'export const w = new Widget();',
          '',
        ].join('\n'),
        'ws/src/ambient.d.ts': [
          'export declare class Gadget {',
          '  run(): void;',
          '}',
          '',
        ].join('\n'),
        'ws/src/ambient-consumer.ts': [
          "import { Gadget } from './ambient';",
          'export const g: Gadget | null = null;',
          '',
        ].join('\n'),
        'ws/src/plain.js': [
          'export function helper() {}',
          'helper();',
          '',
        ].join('\n'),
        'ws/py/mod.py': [
          'class Thing:',
          '    pass',
          '',
          '',
          'Thing()',
          '',
        ].join('\n'),
        'ws/go/main.go': [
          'package main',
          '',
          'func Run() {}',
          '',
          'func main() { Run() }',
          '',
        ].join('\n'),
        // Revision 2 fixtures (batch-8-code-logic-review-r2.md).
        'ws/go/alias.go': 'package p\ntype Widget = int\nvar value Widget\n',
        'ws/src/view.tsx': 'export class Panel {}\nconst view = <div/>;\n',
        'ws/src/tsx-consumer.ts': [
          "import { Panel } from './view';",
          'export const p = new Panel();',
          '',
        ].join('\n'),
      };
      for (const [rel, text] of Object.entries(files)) {
        const abs = nodePath.join(tmp, rel);
        await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
        await nodeFs.writeFile(abs, text, 'utf-8');
      }
      // An in-workspace directory junction (a directory symlink on POSIX)
      // pointing OUTSIDE the workspace, like a worktree's node_modules link.
      await nodeFs.symlink(
        nodePath.join(tmp, 'outside'),
        nodePath.join(tmp, 'ws', 'linked'),
        'junction',
      );
    });

    afterAll(async () => {
      parser?.dispose();
      if (tmp) await nodeFs.rm(tmp, { recursive: true, force: true });
    });

    function buildOnDisk(
      reader: Reader | undefined,
      realpath: (p: string) => Promise<string> = (p) => nodeFs.realpath(p),
    ) {
      const fs = diskFs();
      const { cap } = build({
        reader,
        fs,
        workspace: makeWorkspace(root),
        ast: ast as unknown as Ast,
        treeSitter: parser as unknown as TreeSitter,
        realpath,
      });
      return { cap, fs };
    }

    it('finds an imported class through the import when the index returns no hits', async () => {
      const reader = emptyReader();
      const { cap, fs } = buildOnDisk(reader);

      // cursor on "Widget" in `new Widget()` (line 2, col 21)
      const result = await cap.lsp.getDefinition(
        `${root}/src/consumer.ts`,
        2,
        21,
      );

      expect(reader.searchSymbols).toHaveBeenCalled();
      expect(result).toEqual([
        { file: `${root}/src/widget.ts`, line: 1, column: 13 },
      ]);
      // One read of the cursor file plus ONE resolved-file read.
      expect(fs.readFile).toHaveBeenCalledTimes(2);
    });

    it('also resolves without any symbol reader', async () => {
      const { cap } = buildOnDisk(undefined);
      const result = await cap.lsp.getDefinition(
        `${root}/src/consumer.ts`,
        2,
        21,
      );
      expect(result).toEqual([
        { file: `${root}/src/widget.ts`, line: 1, column: 13 },
      ]);
    });

    it('maps an ESM `./widget.js` specifier to the `.ts` source', async () => {
      const { cap } = buildOnDisk(emptyReader());
      const result = await cap.lsp.getDefinition(
        `${root}/src/esm-consumer.ts`,
        1,
        21,
      );
      expect(result).toEqual([
        { file: `${root}/src/widget.ts`, line: 1, column: 13 },
      ]);
    });

    it('returns the declaration in the cursor file itself without resolving imports', async () => {
      const { cap, fs } = buildOnDisk(emptyReader());
      // cursor on "Widget" in `export class Widget {`
      const result = await cap.lsp.getDefinition(
        `${root}/src/widget.ts`,
        1,
        15,
      );
      expect(result).toEqual([
        { file: `${root}/src/widget.ts`, line: 1, column: 13 },
      ]);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(fs.exists).not.toHaveBeenCalled();
    });

    it('never reads a file an import resolves to outside the workspace', async () => {
      const { cap, fs } = buildOnDisk(emptyReader());
      const result = await cap.lsp.getDefinition(`${root}/src/leak.ts`, 1, 21);
      expect(result).toEqual([]);
      expect(fs.exists).not.toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(fs.readFile).not.toHaveBeenCalledWith(
        expect.stringContaining('outside/secret'),
      );
    });

    it('reports a package import as unresolved', async () => {
      const { cap, fs } = buildOnDisk(emptyReader());
      const result = await cap.lsp.getDefinition(`${root}/src/pkg.ts`, 1, 17);
      expect(result).toEqual([]);
      expect(fs.exists).not.toHaveBeenCalled();
    });

    describe('revision 1 (batch-8-code-logic-review-r1.md)', () => {
      const noSecretRead = (fs: Required<Omit<Fs, 'stat'>>) =>
        expect(fs.readFile).not.toHaveBeenCalledWith(
          expect.stringContaining('secret'),
        );

      it('B1: never reads an import reached through an in-workspace junction that points outside', async () => {
        const { cap, fs } = buildOnDisk(emptyReader());
        const result = await cap.lsp.getDefinition(
          `${root}/src/junction-consumer.ts`,
          1,
          21,
        );
        expect(result).toEqual([]);
        // The lexical path exists (through the junction) but is never read.
        expect(fs.exists).toHaveBeenCalledWith(`${root}/linked/secret.ts`);
        expect(fs.readFile).toHaveBeenCalledTimes(1);
        noSecretRead(fs);
      });

      it('B1: never reads an import whose file is a symlink to a file outside the workspace', async () => {
        const outsideFile = `${tmp}/outside/secret.ts`;
        const { cap, fs } = buildOnDisk(emptyReader(), async (p) =>
          p.replace(/\\/g, '/').endsWith('/src/widget.ts')
            ? outsideFile
            : nodeFs.realpath(p),
        );
        const result = await cap.lsp.getDefinition(
          `${root}/src/consumer.ts`,
          2,
          21,
        );
        expect(result).toEqual([]);
        expect(fs.readFile).toHaveBeenCalledTimes(1);
        noSecretRead(fs);
      });

      it('B1: leaves the import unresolved when the target cannot be canonicalised', async () => {
        const { cap, fs } = buildOnDisk(emptyReader(), async (p) => {
          if (p.replace(/\\/g, '/').endsWith('/src/widget.ts')) {
            throw new Error('EACCES');
          }
          return nodeFs.realpath(p);
        });
        const result = await cap.lsp.getDefinition(
          `${root}/src/consumer.ts`,
          2,
          21,
        );
        expect(result).toEqual([]);
        expect(fs.readFile).toHaveBeenCalledTimes(1);
      });

      it('B3: a declaration inside a block comment is not a definition', async () => {
        const { cap, fs } = buildOnDisk(emptyReader());
        const result = await cap.lsp.getDefinition(
          `${root}/src/ghost.ts`,
          3,
          0,
        );
        expect(result).toEqual([]);
        expect(fs.readFile).toHaveBeenCalledTimes(1);
      });

      it('B3: a commented-out declaration does not shadow the real imported one', async () => {
        const { cap } = buildOnDisk(emptyReader());
        const result = await cap.lsp.getDefinition(
          `${root}/src/commented.ts`,
          4,
          21,
        );
        expect(result).toEqual([
          { file: `${root}/src/widget.ts`, line: 1, column: 13 },
        ]);
      });

      it('B3: a declaration inside a template literal does not shadow the real imported one', async () => {
        const { cap } = buildOnDisk(emptyReader());
        const result = await cap.lsp.getDefinition(
          `${root}/src/templated.ts`,
          4,
          21,
        );
        expect(result).toEqual([
          { file: `${root}/src/widget.ts`, line: 1, column: 13 },
        ]);
      });

      it('B3: a nested function-local declaration does not answer a top-level lookup', async () => {
        const { cap } = buildOnDisk(emptyReader());
        const result = await cap.lsp.getDefinition(
          `${root}/src/nested.ts`,
          5,
          21,
        );
        expect(result).toEqual([
          { file: `${root}/src/widget.ts`, line: 1, column: 13 },
        ]);
      });

      it('B3: a file with a syntax error leaves the lookup unresolved', async () => {
        const { cap } = build({
          reader: emptyReader(),
          fs: {
            readFile: jest.fn(async () => 'class Broken {\nBroken(;\n'),
          },
          ast: ast as unknown as Ast,
          treeSitter: parser as unknown as TreeSitter,
        });
        expect(await cap.lsp.getDefinition('C:/repo/src/b.ts', 1, 0)).toEqual(
          [],
        );
      });

      it('M2: resolves an extensionless import backed only by a .d.ts file', async () => {
        const { cap, fs } = buildOnDisk(emptyReader());
        const result = await cap.lsp.getDefinition(
          `${root}/src/ambient-consumer.ts`,
          1,
          16,
        );
        expect(result).toEqual([
          { file: `${root}/src/ambient.d.ts`, line: 0, column: 21 },
        ]);
        // Every source extension is probed before the declaration file.
        const probes = fs.exists.mock.calls.map(([p]) => p as string);
        expect(probes.indexOf(`${root}/src/ambient.d.ts`)).toBe(8);
        expect(fs.readFile).toHaveBeenCalledTimes(2);
      });

      it.each([
        ['JavaScript', 'src/plain.js', 1, 0, { line: 0, column: 16 }],
        ['Python', 'py/mod.py', 4, 0, { line: 0, column: 6 }],
        ['Go', 'go/main.go', 4, 14, { line: 2, column: 5 }],
      ])(
        'B3: finds a top-level %s declaration by parsing',
        async (_lang, rel, line, col, expected) => {
          const { cap } = buildOnDisk(emptyReader());
          const result = await cap.lsp.getDefinition(
            `${root}/${rel}`,
            line,
            col,
          );
          expect(result).toEqual([{ file: `${root}/${rel}`, ...expected }]);
        },
      );

      describe('M1: UNC workspace roots', () => {
        const uncRoot = '//server/share/repo';
        const files: Record<string, string> = {
          [`${uncRoot}/src/a.ts`]: [
            "import { Widget } from './foo';",
            'export const w = new Widget();',
            '',
          ].join('\n'),
          [`${uncRoot}/src/foo.ts`]: 'export class Widget {}\n',
        };

        function buildUnc(realpath?: (p: string) => Promise<string>) {
          const fs: Required<Omit<Fs, 'stat'>> = {
            readFile: jest.fn(async (p: string) => {
              if (p in files) return files[p];
              throw new Error('ENOENT');
            }),
            exists: jest.fn(async (p: string) => p in files),
          };
          const { cap } = build({
            reader: emptyReader(),
            fs,
            workspace: makeWorkspace(uncRoot),
            ast: ast as unknown as Ast,
            treeSitter: parser as unknown as TreeSitter,
            realpath,
          });
          return { cap, fs };
        }

        it('keeps the \\\\server\\share root when resolving a relative import', async () => {
          const { cap, fs } = buildUnc();
          const result = await cap.lsp.getDefinition(
            `${uncRoot}/src/a.ts`,
            1,
            21,
          );
          expect(result).toEqual([
            { file: `${uncRoot}/src/foo.ts`, line: 0, column: 13 },
          ]);
          const probes = fs.exists.mock.calls.map(([p]) => p as string);
          expect(probes).toEqual([`${uncRoot}/src/foo.ts`]);
        });

        it('rejects a UNC import whose real path is on another share', async () => {
          const { cap, fs } = buildUnc(async (p) =>
            p === `${uncRoot}/src/foo.ts` ? '\\\\other\\share\\foo.ts' : p,
          );
          const result = await cap.lsp.getDefinition(
            `${uncRoot}/src/a.ts`,
            1,
            21,
          );
          expect(result).toEqual([]);
          expect(fs.readFile).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe('revision 2 (batch-8-code-logic-review-r2.md)', () => {
      it('M1: finds a top-level Go type alias by parsing', async () => {
        const { cap } = buildOnDisk(emptyReader());
        // cursor on "Widget" in `var value Widget`
        const result = await cap.lsp.getDefinition(
          `${root}/go/alias.go`,
          2,
          10,
        );
        expect(result).toEqual([
          { file: `${root}/go/alias.go`, line: 1, column: 5 },
        ]);
      });

      it.each([
        ['a JSX arrow component', 'export const Widget = () => <div/>;\n'],
        [
          'a plain class beside unrelated JSX',
          'export class Widget {}\nconst view = <div/>;\n',
        ],
        ['a .tsx file with no JSX', 'export class Widget {}\n'],
      ])(
        'S1: a .tsx cursor file with %s is unresolved, never a wrong location',
        async (_case, content) => {
          const fs: Fs = { readFile: jest.fn(async () => content) };
          const query = jest.spyOn(parser, 'query');
          try {
            const { cap } = build({
              reader: emptyReader(),
              fs,
              ast: ast as unknown as Ast,
              treeSitter: parser as unknown as TreeSitter,
            });
            expect(
              await cap.lsp.getDefinition('C:/repo/src/view.tsx', 0, 13),
            ).toEqual([]);
            expect(fs.readFile).toHaveBeenCalledTimes(1);
            expect(query).not.toHaveBeenCalled();
          } finally {
            query.mockRestore();
          }
        },
      );

      it('S1: an import that resolves to a .tsx file is unresolved without reading it', async () => {
        const { cap, fs } = buildOnDisk(emptyReader());
        const result = await cap.lsp.getDefinition(
          `${root}/src/tsx-consumer.ts`,
          1,
          21,
        );
        expect(result).toEqual([]);
        expect(fs.exists).toHaveBeenCalledWith(`${root}/src/view.tsx`);
        expect(fs.readFile).toHaveBeenCalledTimes(1);
        expect(fs.readFile).not.toHaveBeenCalledWith(`${root}/src/view.tsx`);
      });

      it('S1: the symbol index still resolves a .tsx definition when it has a hit', async () => {
        const reader: Reader = {
          searchSymbols: jest.fn(async () => ({
            bm25Only: false,
            hits: [
              {
                id: '1',
                workspaceRoot: 'C:/repo',
                filePath: 'C:/repo/src/widget.tsx',
                kind: 'function',
                symbolName: 'Widget',
                subject: 'code:function:C:/repo/src/widget.tsx:Widget',
                text: 'function Widget in src/widget.tsx:3-5',
                tokenCount: 10,
                score: 0.9,
              },
            ],
          })),
        };
        const fs: Fs = {
          readFile: jest.fn(
            async () => 'export const App = () => <Widget/>;\nWidget();\n',
          ),
        };
        const { cap } = build({
          reader,
          fs,
          ast: ast as unknown as Ast,
          treeSitter: parser as unknown as TreeSitter,
        });
        // cursor on "Widget" in `Widget();` of a JSX-containing .tsx file
        const result = await cap.lsp.getDefinition('C:/repo/src/app.tsx', 1, 0);
        expect(result).toEqual([
          { file: 'C:/repo/src/widget.tsx', line: 3, column: 0 },
        ]);
      });
    });
  });

  describe('lsp.getDefinition — dotted module names', () => {
    it('disambiguates through an import of `./foo.service` (not the module `foo`)', async () => {
      const reader: Reader = {
        searchSymbols: jest.fn(async () => ({
          bm25Only: false,
          hits: [
            {
              id: '1',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/foo.ts',
              kind: 'class',
              symbolName: 'Foo',
              subject: 'code:class:C:/repo/src/foo.ts:Foo',
              text: 'class Foo in src/foo.ts:3-9',
              tokenCount: 10,
              score: 0.9,
            },
            {
              id: '2',
              workspaceRoot: 'C:/repo',
              filePath: 'C:/repo/src/foo.service.ts',
              kind: 'class',
              symbolName: 'Foo',
              subject: 'code:class:C:/repo/src/foo.service.ts:Foo',
              text: 'class Foo in src/foo.service.ts:7-20',
              tokenCount: 10,
              score: 0.8,
            },
          ],
        })),
      };
      const fs: Fs = {
        readFile: jest.fn(
          async () => "import { Foo } from './foo.service';\nnew Foo();",
        ),
      };
      const ast: Ast = {
        analyzeSource: jest.fn(async () =>
          ok({
            imports: [{ source: './foo.service', importedSymbols: ['Foo'] }],
            exports: [],
            functions: [],
            classes: [],
          }),
        ),
      };
      const { cap } = build({ reader, fs, ast });

      const result = await cap.lsp.getDefinition('C:/repo/src/a.ts', 1, 5);

      expect(result).toEqual([
        { file: 'C:/repo/src/foo.service.ts', line: 7, column: 0 },
      ]);
    });
  });

  describe('lsp.getReferences — dependency-graph scoping (Tier 1 #1)', () => {
    withTsScopeCompleteClaim();

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
      // Batch 26b: scoping also needs clean graph coverage (narrowing gate).
      const depGraph = builtGraph(graphCoverage(), {
        'C:/repo/src/foo.ts': ['C:/repo/src/consumer.ts'],
      });
      const indexer: Indexer = { findFiles: jest.fn() };
      const { cap } = build({ reader, fs, depGraph, indexer });

      // cursor on "doThing" in foo.ts (col 16)
      const result = await cap.lsp.getReferences('C:/repo/src/foo.ts', 0, 16);

      expect(result).toEqual([
        { file: 'C:/repo/src/foo.ts', line: 0, column: 16 },
        { file: 'C:/repo/src/consumer.ts', line: 0, column: 0 },
      ]);
      // Scoped path must NOT fall back to the full-workspace stream.
      expect(indexer.findFiles).not.toHaveBeenCalled();
      expect(depGraph.isBuilt).toHaveBeenCalledWith('C:/repo');
    });

    it('B2: keeps the full scan for an empty index so global-script references survive', async () => {
      const reader: Reader = {
        searchSymbols: jest.fn(async () => ({ bm25Only: false, hits: [] })),
      };
      const fs: Fs = {
        readFile: jest.fn(async (p: string) => {
          if (p === 'C:/repo/src/global.ts') return 'function GlobalThing() {}';
          if (p === 'C:/repo/src/script.ts') return 'GlobalThing();';
          return '';
        }),
      };
      // Graph built (and clean), but global scripts have no import edges.
      const depGraph = builtGraph(graphCoverage());
      const indexer: Indexer = {
        findFiles: jest.fn(() =>
          streamOf(['C:/repo/src/global.ts', 'C:/repo/src/script.ts']),
        ),
      };
      const { cap } = build({ reader, fs, depGraph, indexer });

      const result = await cap.lsp.getReferences('C:/repo/src/global.ts', 0, 9);

      expect(result).toEqual([
        { file: 'C:/repo/src/global.ts', line: 0, column: 9 },
        { file: 'C:/repo/src/script.ts', line: 0, column: 0 },
      ]);
      expect(indexer.findFiles).toHaveBeenCalledTimes(1);
      expect(depGraph.getDependents).not.toHaveBeenCalled();
    });

    it('B2: does not scope by a graph built for a different workspace', async () => {
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
        readFile: jest.fn(async () => 'export function doThing(){}'),
      };
      // Only another workspace's graph exists: isBuilt() is true, but
      // isBuilt('C:/repo') is false.
      const depGraph: DepGraph = {
        isBuilt: jest.fn((wsRoot?: string) => wsRoot === undefined),
        getDependents: jest.fn(() => []),
      };
      const indexer: Indexer = {
        findFiles: jest.fn(() => streamOf(['C:/repo/src/foo.ts'])),
      };
      const { cap } = build({ reader, fs, depGraph, indexer });

      await cap.lsp.getReferences('C:/repo/src/foo.ts', 0, 16);

      expect(depGraph.isBuilt).toHaveBeenCalledWith('C:/repo');
      expect(indexer.findFiles).toHaveBeenCalledTimes(1);
      expect(depGraph.getDependents).not.toHaveBeenCalled();
    });
  });

  describe('lsp.getReferences — string/comment filtering (Tier 1 #2)', () => {
    it('drops matches inside comment/string nodes reported by Tree-sitter', async () => {
      const fs: Fs = {
        readFile: jest.fn(async () => 'doThing(); // doThing in comment'),
      };
      const indexer: Indexer = {
        findFiles: jest.fn(() => streamOf(['C:/repo/src/b.ts'])),
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

  describe('TASK_2026_559 Batch 26b — reports, narrowing gate, C# fallback', () => {
    type Cap = ReturnType<typeof build>['cap'];

    function refsReport(cap: Cap, file: string, line: number, col: number) {
      const lookup = cap.lsp.getReferencesReport;
      if (!lookup) throw new Error('getReferencesReport is not implemented');
      return lookup(file, line, col);
    }

    function defsReport(cap: Cap, file: string, line: number, col: number) {
      const lookup = cap.lsp.getDefinitionReport;
      if (!lookup) throw new Error('getDefinitionReport is not implemented');
      return lookup(file, line, col);
    }

    function indexHit(file: string, name: string, line: number) {
      return {
        id: `${file}:${name}`,
        workspaceRoot: 'C:/repo',
        filePath: file,
        kind: 'function',
        symbolName: name,
        subject: `code:function:${file}:${name}`,
        text: `function ${name} in ${file.slice('C:/repo/'.length)}:${line}-${line + 2}`,
        tokenCount: 10,
        score: 0.9,
      };
    }

    function readerWith(...hits: ReturnType<typeof indexHit>[]): Reader {
      return {
        searchSymbols: jest.fn(async () => ({ bm25Only: false, hits })),
      };
    }

    /** In-memory files; any other path reads as empty. */
    function memoryFs(files: Record<string, string>): Fs {
      return {
        readFile: jest.fn(async (p: string) => files[p] ?? ''),
      };
    }

    function streamingIndexer(paths: string[]): Indexer {
      return { findFiles: jest.fn(() => streamOf(paths)) };
    }

    const DECL = 'C:/repo/src/foo.ts';
    const CONSUMER = 'C:/repo/src/consumer.ts';
    const PY_USER = 'C:/repo/py/use.py';
    const TS_FILES: Record<string, string> = {
      [DECL]: 'export function doThing() {}',
      [CONSUMER]: 'doThing();',
      // Python code calling the TS declaration (e.g. through a bridge): the
      // TS graph has no edge for it, so only a text scan finds it.
      [PY_USER]: 'doThing()',
    };
    const SCOPED_HITS = [
      { file: DECL, line: 0, column: 16 },
      { file: CONSUMER, line: 0, column: 0 },
    ];
    const TEXT_SCAN_HITS = [
      ...SCOPED_HITS,
      { file: PY_USER, line: 0, column: 0 },
    ];

    /** A TS declaration with one graph dependent and one Python user. */
    function tsScenario(
      coverage: LanguageCoverage | undefined,
      notInGraph: string[] = [],
    ) {
      const indexer = streamingIndexer([DECL, CONSUMER, PY_USER]);
      const depGraph = builtGraph(coverage, { [DECL]: [CONSUMER] }, notInGraph);
      const { cap } = build({
        reader: readerWith(indexHit(DECL, 'doThing', 0)),
        fs: memoryFs(TS_FILES),
        indexer,
        depGraph,
      });
      return { cap, indexer, depGraph };
    }

    const CLEAN_RESOLUTION = {
      external: 0,
      unresolvedInternal: 0,
      truncatedImports: 0,
      edgeCapHit: false,
      context: 'complete',
    } as const;

    it('r1 B2: with the shipped registry a clean TS graph never narrows (no reference-scope claim)', async () => {
      // Nothing grants the claim here: the real TS/JS registry values apply.
      const { cap, indexer } = tsScenario(graphCoverage());

      const report = await refsReport(cap, DECL, 0, 16);

      expect(report.mechanism).toBe('text-scan');
      expect(report.locations).toEqual(TEXT_SCAN_HITS);
      expect(indexer.findFiles).toHaveBeenCalledTimes(1);
    });

    describe('narrowing gate (Task 26b.2)', () => {
      withTsScopeCompleteClaim();

      it('narrows a clean, scope-complete graph to the declaration and its dependents', async () => {
        const { cap, indexer } = tsScenario(graphCoverage());

        await expect(refsReport(cap, DECL, 0, 16)).resolves.toEqual({
          locations: SCOPED_HITS,
          mechanism: 'graph-scoped-scan',
          language: 'typescript',
          languageSupported: true,
          approximations: [],
        });
        expect(indexer.findFiles).not.toHaveBeenCalled();
      });

      it('FB: complete-census graph with edgeCapHit is not used to narrow', async () => {
        const coverage = graphCoverage({
          resolution: { ...CLEAN_RESOLUTION, edgeCapHit: true },
        });
        expect(coverage.census).toBe('complete');
        const { cap, indexer } = tsScenario(coverage);

        // Behavioural (array API, present before 26b): the Python user is
        // only reachable by the text scan.
        expect(await cap.lsp.getReferences(DECL, 0, 16)).toEqual(
          TEXT_SCAN_HITS,
        );
        expect(indexer.findFiles).toHaveBeenCalledTimes(1);

        const report = await refsReport(cap, DECL, 0, 16);
        expect(report).toEqual({
          locations: TEXT_SCAN_HITS,
          mechanism: 'text-scan',
          language: 'typescript',
          languageSupported: true,
          approximations: ['text-scan'],
        });
      });

      it.each<[string, LanguageCoverage | undefined, string[]]>([
        [
          'a TS declaration imported by a Python file (Python is graph-unsupported)',
          graphCoverage({
            unsupported: 1,
            unsupportedByLanguage: { python: 1 },
          }),
          [],
        ],
        [
          'a capped graph (files dropped by the parse cap)',
          graphCoverage({ omittedByCap: 5 }),
          [],
        ],
        [
          'a vendor tree beyond the census limit sorted before normal code (census truncated)',
          graphCoverage({ census: 'truncated', censusLimit: 2 }),
          [],
        ],
        ['an unknown census', graphCoverage({ census: 'unknown' }), []],
        [
          'an unresolved internal import',
          graphCoverage({
            resolution: { ...CLEAN_RESOLUTION, unresolvedInternal: 1 },
          }),
          [],
        ],
        [
          'a partial resolver context',
          graphCoverage({
            resolution: { ...CLEAN_RESOLUTION, context: 'partial' },
          }),
          [],
        ],
        [
          'no resolution accounting',
          graphCoverage({ resolution: undefined }),
          [],
        ],
        [
          'a graphed language whose edges do not bound references',
          graphCoverage({
            supportedLanguages: ['typescript', 'javascript', 'go'],
          }),
          [],
        ],
        ['no published graph coverage', undefined, []],
        [
          'a declaration file that is not a node of the graph',
          graphCoverage(),
          [DECL],
        ],
      ])('does not narrow for %s', async (_case, coverage, notInGraph) => {
        const { cap, indexer } = tsScenario(coverage, notInGraph);

        const report = await refsReport(cap, DECL, 0, 16);

        expect(report.mechanism).toBe('text-scan');
        expect(report.approximations).toEqual(['text-scan']);
        expect(report.locations).toEqual(TEXT_SCAN_HITS);
        expect(indexer.findFiles).toHaveBeenCalledTimes(1);
      });

      it('reports the text-scan file cap as truncated when a vendor tree fills it first', async () => {
        const vendor = Array.from(
          { length: 8000 },
          (_, i) => `C:/repo/aaa-vendor/v${i}.js`,
        );
        const indexer = streamingIndexer([...vendor, CONSUMER]);
        const { cap } = build({ fs: memoryFs(TS_FILES), indexer });

        const report = await refsReport(cap, DECL, 0, 16);

        expect(report).toMatchObject({
          mechanism: 'text-scan',
          locations: [],
          truncated: true,
        });
      });

      it('r1 M3: discovery itself is bounded (one past the file cap) with the default excludes', async () => {
        const indexer = streamingIndexer([CONSUMER]);
        const { cap } = build({ fs: memoryFs(TS_FILES), indexer });

        await refsReport(cap, DECL, 0, 16);

        expect(indexer.findFiles).toHaveBeenCalledWith(
          expect.stringMatching(/^\{\*\*\/\*\.ts,/),
          expect.arrayContaining(['**/node_modules/**']),
          8001,
          'C:/repo',
        );
      });

      it('reports the match cap as truncated', async () => {
        const busy = 'C:/repo/src/busy.ts';
        const { cap } = build({
          fs: memoryFs({ [busy]: 'doThing '.repeat(600) }),
          indexer: streamingIndexer([busy]),
        });

        const report = await refsReport(cap, busy, 0, 0);

        expect(report.locations).toHaveLength(500);
        expect(report.truncated).toBe(true);
      });

      it('reports a scan that stopped on an error as truncated', async () => {
        const indexer: Indexer = {
          findFiles: jest.fn(() => {
            throw new Error('walk failed');
          }),
        };
        const { cap } = build({ fs: memoryFs(TS_FILES), indexer });

        await expect(refsReport(cap, DECL, 0, 16)).resolves.toMatchObject({
          mechanism: 'text-scan',
          locations: [],
          truncated: true,
        });
      });
    });

    describe('scan extensions from the registry (Task 26b.1)', () => {
      it('Kotlin scan: .kt and .kts files are read and named kotlin', async () => {
        const model = 'C:/repo/kt/Model.kt';
        const script = 'C:/repo/kt/build.kts';
        const indexer = streamingIndexer([model, script]);
        const { cap } = build({
          fs: memoryFs({
            [model]: 'data class Model(val id: Int)\n',
            [script]: 'val m = Model(1)\n',
          }),
          indexer,
        });

        const report = await refsReport(cap, model, 0, 11);

        const [pattern] = indexer.findFiles.mock.calls[0] as [string];
        const includePatterns = pattern.slice(1, -1).split(',');
        expect(includePatterns).toEqual(
          expect.arrayContaining([
            '**/*.kt',
            '**/*.kts',
            '**/*.java',
            '**/*.rs',
            '**/*.cs',
            '**/*.swift',
          ]),
        );
        expect(report).toEqual({
          locations: [
            { file: model, line: 0, column: 11 },
            { file: script, line: 0, column: 8 },
          ],
          mechanism: 'text-scan',
          language: 'kotlin',
          languageSupported: true,
          approximations: ['text-scan'],
        });
      });

      it('Java same-package references (no import edge) are found by the text scan', async () => {
        const widget = 'C:/repo/java/app/Widget.java';
        const shop = 'C:/repo/java/app/Shop.java';
        const { cap } = build({
          reader: readerWith(indexHit(widget, 'Widget', 2)),
          fs: memoryFs({
            [widget]: 'package app;\n\npublic class Widget {}\n',
            [shop]: 'package app;\n\nclass Shop { Widget w = new Widget(); }\n',
          }),
          indexer: streamingIndexer([widget, shop]),
          depGraph: builtGraph(
            graphCoverage({
              unsupported: 2,
              unsupportedByLanguage: { java: 2 },
            }),
          ),
        });

        await expect(refsReport(cap, shop, 2, 13)).resolves.toEqual({
          locations: [
            { file: widget, line: 2, column: 13 },
            { file: shop, line: 2, column: 13 },
            { file: shop, line: 2, column: 28 },
          ],
          mechanism: 'text-scan',
          language: 'java',
          languageSupported: true,
          approximations: ['text-scan'],
        });
      });
    });

    describe('report contract on the Electron path', () => {
      it('a definition from the symbol index says so', async () => {
        const { cap } = build({
          reader: readerWith(indexHit(DECL, 'doThing', 0)),
          fs: memoryFs({ [CONSUMER]: 'doThing();' }),
        });

        await expect(defsReport(cap, CONSUMER, 0, 0)).resolves.toEqual({
          locations: [{ file: DECL, line: 0, column: 0 }],
          mechanism: 'symbol-index',
          language: 'typescript',
          languageSupported: true,
          approximations: [],
        });
      });

      it('26a M2 holds: a zero-based line 0 / column 0 location is kept as 0', async () => {
        const { cap } = build({
          fs: memoryFs({ [CONSUMER]: 'doThing();' }),
          indexer: streamingIndexer([CONSUMER]),
        });

        const report = await refsReport(cap, CONSUMER, 0, 0);

        expect(report.locations).toEqual([
          { file: CONSUMER, line: 0, column: 0 },
        ]);
      });

      it('26a M1 holds: an empty answer is never an unqualified "none exist"', async () => {
        // Text scan with no match: qualified by its approximation.
        const empty = build({
          fs: memoryFs({ [CONSUMER]: 'doThing();' }),
          indexer: streamingIndexer([]),
        }).cap;
        const refs = await refsReport(empty, CONSUMER, 0, 0);
        expect(refs.locations).toEqual([]);
        expect(refs.approximations).toEqual(['text-scan']);

        // A language the definition fallback does not cover: not supported.
        const java = 'C:/repo/java/app/Shop.java';
        const noFallback = build({
          fs: memoryFs({ [java]: 'class Shop { Widget w; }\n' }),
        }).cap;
        await expect(defsReport(noFallback, java, 0, 13)).resolves.toEqual({
          locations: [],
          mechanism: 'declaration-scan',
          language: 'java',
          languageSupported: false,
          approximations: [],
        });
      });

      it('a .tsx cursor is not supported by the declaration scan', async () => {
        const view = 'C:/repo/src/view.tsx';
        const { cap } = build({
          fs: memoryFs({ [view]: 'export class Panel {}\n' }),
        });

        await expect(defsReport(cap, view, 0, 13)).resolves.toMatchObject({
          mechanism: 'declaration-scan',
          language: 'tsx',
          languageSupported: false,
          locations: [],
        });
      });

      it('never answers `none`; a lookup that cannot run is an error, not an empty report', async () => {
        const { cap } = build({ fs: memoryFs({ [CONSUMER]: '   = 1;' }) });

        await expect(defsReport(cap, CONSUMER, 0, 0)).rejects.toThrow(
          /Lookup could not answer: no identifier at C:\/repo\/src\/consumer\.ts:0:0/,
        );
        await expect(refsReport(cap, CONSUMER, 0, 0)).rejects.toThrow(
          /Lookup could not answer/,
        );
        // The array APIs keep their empty answer.
        expect(await cap.lsp.getDefinition(CONSUMER, 0, 0)).toEqual([]);
        expect(await cap.lsp.getReferences(CONSUMER, 0, 0)).toEqual([]);
      });

      it('a reference lookup without a workspace root is an error', async () => {
        const { cap } = build({
          fs: memoryFs({ [CONSUMER]: 'doThing();' }),
          workspace: {
            getWorkspaceRoot: jest.fn((): string | undefined => undefined),
          },
        });

        await expect(refsReport(cap, CONSUMER, 0, 0)).rejects.toThrow(
          /no workspace root is open/,
        );
      });
    });

    describe('C# on the shipped grammar (real tree-sitter)', () => {
      const silentLogger = (): Logger =>
        ({
          info: jest.fn(),
          debug: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          dispose: jest.fn(),
        }) as unknown as Logger;

      let parser: TreeSitterParserService;

      beforeAll(async () => {
        parser = new TreeSitterParserService(silentLogger());
        const init = await parser.initialize();
        if (init.isErr()) {
          throw init.error ?? new Error('tree-sitter initialisation failed');
        }
      });

      afterAll(() => {
        parser?.dispose();
      });

      function buildCs(
        files: Record<string, string>,
        extra: Parameters<typeof build>[0] = {},
      ) {
        return build({
          fs: memoryFs(files),
          treeSitter: parser as unknown as TreeSitter,
          ...extra,
        }).cap;
      }

      const SCOPED_CS = 'C:/repo/cs/Scoped.cs';
      const SCOPED_SOURCE = [
        'namespace Acme.Scoped;',
        '// class Ghost { }',
        'public record struct Point(int X);',
        'public delegate void Handler();',
        'public class Outer',
        '{',
        '    class Inner { }',
        '}',
        '',
      ].join('\n');

      it.each([
        [
          'a record struct in a file-scoped namespace',
          2,
          21,
          { line: 2, column: 21 },
        ],
        ['a delegate', 3, 21, { line: 3, column: 21 }],
        ['a class', 4, 13, { line: 4, column: 13 }],
      ])(
        'finds %s by parsing (definitionFallback)',
        async (_case, line, col, expected) => {
          const cap = buildCs({ [SCOPED_CS]: SCOPED_SOURCE });
          await expect(defsReport(cap, SCOPED_CS, line, col)).resolves.toEqual({
            locations: [{ file: SCOPED_CS, ...expected }],
            mechanism: 'declaration-scan',
            language: 'csharp',
            languageSupported: true,
            approximations: [],
          });
        },
      );

      it.each([
        ['a type nested in a class', 6, 10],
        ['a declaration inside a comment', 1, 9],
      ])('does not answer with %s', async (_case, line, col) => {
        const cap = buildCs({ [SCOPED_CS]: SCOPED_SOURCE });
        await expect(
          defsReport(cap, SCOPED_CS, line, col),
        ).resolves.toMatchObject({
          locations: [],
          mechanism: 'declaration-scan',
          truncated: true,
        });
      });

      it('finds a type in nested block namespaces', async () => {
        const file = 'C:/repo/cs/Deep.cs';
        const cap = buildCs({
          [file]:
            'namespace A\n{\n    namespace B\n    {\n        interface IDeep { }\n    }\n}\n',
        });
        await expect(defsReport(cap, file, 4, 18)).resolves.toMatchObject({
          locations: [{ file, line: 4, column: 18 }],
        });
      });

      it('r1 B1: a C# file with a syntax error is an error, never Found: 0', async () => {
        const file = 'C:/repo/cs/Broken.cs';
        const cap = buildCs({ [file]: 'class Broken {\n  Broken(;\n' });
        await expect(defsReport(cap, file, 1, 2)).rejects.toThrow(
          /Lookup could not answer: .*Broken\.cs could not be parsed reliably/,
        );
        expect(await cap.lsp.getDefinition(file, 1, 2)).toEqual([]);
      });

      it('r1 B1: a same-namespace type in another file is a bounded (truncated) empty answer', async () => {
        const billing = 'C:/repo/cs/Billing.cs';
        const cap = buildCs({
          [billing]:
            'namespace Acme\n{\n    class Biller { Invoice Make() => null; }\n}\n',
        });
        await expect(defsReport(cap, billing, 2, 19)).resolves.toEqual({
          locations: [],
          mechanism: 'declaration-scan',
          language: 'csharp',
          languageSupported: true,
          approximations: [],
          truncated: true,
        });
      });

      it('C# same-namespace references: found by the text scan, comments and string text dropped', async () => {
        const invoice = 'C:/repo/cs/Invoice.cs';
        const billing = 'C:/repo/cs/Billing.cs';
        const files = {
          [invoice]:
            'namespace Acme.Billing\n{\n    public class Invoice { }\n}\n',
          [billing]: [
            'namespace Acme.Billing',
            '{',
            '    class Biller',
            '    {',
            '        // Invoice in a comment',
            '        string label = "Invoice";',
            '        Invoice Make() => new Invoice();',
            '        string Name() => $"{nameof(Invoice)} Invoice";',
            '    }',
            '}',
            '',
          ].join('\n'),
        };
        const cap = buildCs(files, {
          reader: readerWith(indexHit(invoice, 'Invoice', 2)),
          indexer: streamingIndexer([invoice, billing]),
          depGraph: builtGraph(
            graphCoverage({
              unsupported: 2,
              unsupportedByLanguage: { csharp: 2 },
            }),
          ),
        });

        await expect(refsReport(cap, billing, 6, 8)).resolves.toEqual({
          locations: [
            { file: invoice, line: 2, column: 17 },
            { file: billing, line: 6, column: 8 },
            { file: billing, line: 6, column: 30 },
            { file: billing, line: 7, column: 35 },
          ],
          mechanism: 'text-scan',
          language: 'csharp',
          languageSupported: true,
          approximations: ['text-scan'],
        });
      });
    });

    describe('review r1 fixes (batch-26b-code-logic-review-r1.md)', () => {
      const silentLogger = (): Logger =>
        ({
          info: jest.fn(),
          debug: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          dispose: jest.fn(),
        }) as unknown as Logger;
      // Built by concatenation so no import-shaped literal appears in source.
      const FROM = 'fr' + 'om';

      let parser: TreeSitterParserService;
      let ast: AstAnalysisService;
      let tmp: string | undefined;

      beforeAll(async () => {
        parser = new TreeSitterParserService(silentLogger());
        const init = await parser.initialize();
        if (init.isErr()) {
          throw init.error ?? new Error('tree-sitter initialisation failed');
        }
        ast = new AstAnalysisService(silentLogger(), parser);
      });

      afterAll(() => {
        parser?.dispose();
      });

      afterEach(async () => {
        mockScopeComplete.clear();
        if (tmp) await nodeFs.rm(tmp, { recursive: true, force: true });
        tmp = undefined;
      });

      /** Writes `files` (relative to a fresh temp root) and returns the root. */
      async function writeWorkspace(
        files: Record<string, string>,
      ): Promise<string> {
        tmp = (
          await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'ptah-26b-r1-'))
        ).replace(/\\/g, '/');
        for (const [rel, text] of Object.entries(files)) {
          const abs = `${tmp}/${rel}`;
          await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
          await nodeFs.writeFile(abs, text, 'utf-8');
        }
        return tmp;
      }

      /** The real graph service over real files. */
      function realGraph(): DependencyGraphService {
        return new DependencyGraphService(
          ast,
          { readFile: (p: string) => nodeFs.readFile(p, 'utf-8') } as never,
          silentLogger(),
        );
      }

      /** On-disk IFileSystemProvider subset; discovery lists `files`. */
      function realFs(files: string[], onRead?: (p: string) => void) {
        return {
          fs: {
            readFile: jest.fn(async (p: string) => {
              onRead?.(p);
              return nodeFs.readFile(p, 'utf-8');
            }),
            stat: jest.fn(async (p: string) => nodeFs.stat(p)),
            exists: jest.fn(async (p: string) =>
              nodeFs.access(p).then(
                () => true,
                () => false,
              ),
            ),
          },
          indexer: { findFiles: jest.fn(async () => files) },
        };
      }

      function buildReal(
        root: string,
        graph: DependencyGraphService,
        files: string[],
        reader: Reader,
        onRead?: (p: string) => void,
      ) {
        const { fs, indexer } = realFs(files, onRead);
        return build({
          reader,
          fs,
          indexer,
          workspace: makeWorkspace(root),
          depGraph: graph as unknown as DepGraph,
          ast: ast as unknown as Ast,
          treeSitter: parser as unknown as TreeSitter,
        }).cap;
      }

      function hitAt(file: string, name: string, line: number) {
        return {
          ...indexHit(file, name, line),
          workspaceRoot: 'x',
          text: `function ${name} in f:${line}-${line + 1}`,
        };
      }

      describe('B1: uncertain declaration scans are never an unqualified zero', () => {
        it('a failed declaration query is an error (array API keeps [])', async () => {
          const { cap } = build({
            fs: memoryFs({ [CONSUMER]: 'doThing();' }),
            treeSitter: { query: jest.fn(async () => err()) },
          });

          await expect(defsReport(cap, CONSUMER, 0, 0)).rejects.toThrow(
            /could not be parsed reliably/,
          );
          expect(await cap.lsp.getDefinition(CONSUMER, 0, 0)).toEqual([]);
        });

        it('an import target that cannot be read is an error', async () => {
          const widget = 'C:/repo/src/widget.ts';
          const consumer = `import { Widget } ${FROM} './widget';\nnew Widget();\n`;
          const { cap } = build({
            fs: {
              readFile: jest.fn(async (p: string) => {
                if (p === CONSUMER) return consumer;
                throw new Error('EACCES');
              }),
              exists: jest.fn(async (p: string) => p === widget),
            },
            ast: ast as unknown as Ast,
            treeSitter: parser as unknown as TreeSitter,
          });

          await expect(defsReport(cap, CONSUMER, 1, 4)).rejects.toThrow(
            /import target C:\/repo\/src\/widget\.ts could not be read/,
          );
        });

        it('a clean scan that finds nothing in its bounded read set is truncated', async () => {
          const { cap } = build({
            fs: memoryFs({ [CONSUMER]: 'doThing();' }),
            ast: ast as unknown as Ast,
            treeSitter: parser as unknown as TreeSitter,
          });

          await expect(defsReport(cap, CONSUMER, 0, 0)).resolves.toEqual({
            locations: [],
            mechanism: 'declaration-scan',
            language: 'typescript',
            languageSupported: true,
            approximations: [],
            truncated: true,
          });
        });
      });

      describe('B2-B4 on the real dependency graph', () => {
        it('B2: a global-script reference is found (shipped registry: no narrowing)', async () => {
          const root = await writeWorkspace({
            'a.ts': 'function Foo() {}\n',
            'b.ts': 'Foo();\n',
          });
          const [a, b] = [`${root}/a.ts`, `${root}/b.ts`];
          const graph = realGraph();
          await graph.buildGraph([a, b], root);
          expect(graph.getCoverageReport(root)?.languages.clean).toBe(true);
          const cap = buildReal(
            root,
            graph,
            [a, b],
            readerWith(hitAt(a, 'Foo', 0)),
          );

          const report = await refsReport(cap, a, 0, 9);

          expect(report.mechanism).toBe('text-scan');
          expect(report.locations).toEqual([
            { file: a, line: 0, column: 9 },
            { file: b, line: 0, column: 0 },
          ]);
        });

        it('control: a clean real graph with the claim narrows to its dependents', async () => {
          mockScopeComplete.add('typescript');
          mockScopeComplete.add('javascript');
          mockScopeComplete.add('tsx');
          const root = await writeWorkspace({
            'a.ts': 'export function Foo() {}\n',
            'b.ts': `import { Foo } ${FROM} './a';\nFoo();\n`,
            'c.ts': 'const Foo = 1;\n',
          });
          const [a, b, c] = [`${root}/a.ts`, `${root}/b.ts`, `${root}/c.ts`];
          const graph = realGraph();
          await graph.buildGraph([a, b, c], root);
          const cap = buildReal(
            root,
            graph,
            [a, b, c],
            readerWith(hitAt(a, 'Foo', 0)),
          );

          const report = await refsReport(cap, a, 0, 16);

          expect(report.mechanism).toBe('graph-scoped-scan');
          expect(report.locations).toEqual([
            { file: a, line: 0, column: 16 },
            { file: b, line: 0, column: 9 },
            { file: b, line: 1, column: 0 },
          ]);
        });

        it('B3: an invalidation during the index lookup does not narrow on the old certificate', async () => {
          mockScopeComplete.add('typescript');
          mockScopeComplete.add('javascript');
          mockScopeComplete.add('tsx');
          const root = await writeWorkspace({
            'a.ts': 'export function Foo() {}\n',
            'b.ts': `import { Foo } ${FROM} './a';\nFoo();\n`,
          });
          const [a, b] = [`${root}/a.ts`, `${root}/b.ts`];
          const graph = realGraph();
          await graph.buildGraph([a, b], root);
          const reader: Reader = {
            searchSymbols: jest.fn(async () => {
              graph.invalidateFile(b); // a watcher fires mid-lookup
              return { bm25Only: false, hits: [hitAt(a, 'Foo', 0)] };
            }),
          };
          const cap = buildReal(root, graph, [a, b], reader);

          const report = await refsReport(cap, a, 0, 16);

          expect(report.mechanism).toBe('text-scan');
          expect(report.locations).toContainEqual({
            file: b,
            line: 1,
            column: 0,
          });
        });

        it('B3: an invalidation during the scoped reads falls back to a text scan', async () => {
          mockScopeComplete.add('typescript');
          mockScopeComplete.add('javascript');
          mockScopeComplete.add('tsx');
          const root = await writeWorkspace({
            'a.ts': 'export function Foo() {}\n',
            'b.ts': `import { Foo } ${FROM} './a';\nFoo();\n`,
          });
          const [a, b] = [`${root}/a.ts`, `${root}/b.ts`];
          const graph = realGraph();
          await graph.buildGraph([a, b], root);
          let fired = false;
          const cap = buildReal(
            root,
            graph,
            [a, b],
            readerWith(hitAt(a, 'Foo', 0)),
            (p) => {
              if (p === b && !fired) {
                fired = true;
                graph.invalidateFile(b);
              }
            },
          );

          const report = await refsReport(cap, a, 0, 16);

          expect(fired).toBe(true);
          expect(report.mechanism).toBe('text-scan');
          expect(report.locations).toContainEqual({
            file: b,
            line: 1,
            column: 0,
          });
        });

        it('B4: a nested root graph never stands in for the certified parent graph', async () => {
          mockScopeComplete.add('typescript');
          mockScopeComplete.add('javascript');
          mockScopeComplete.add('tsx');
          const root = await writeWorkspace({
            'pkg/decl.ts': 'export function Foo() {}\n',
            'use.ts': `import { Foo } ${FROM} './pkg/decl';\nFoo();\n`,
          });
          const [decl, use] = [`${root}/pkg/decl.ts`, `${root}/use.ts`];
          const graph = realGraph();
          await graph.buildGraph([decl, use], root);
          await graph.buildGraph([decl], `${root}/pkg`);
          expect(graph.getCoverageReport(root)?.languages.clean).toBe(true);
          const cap = buildReal(
            root,
            graph,
            [decl, use],
            readerWith(hitAt(decl, 'Foo', 0)),
          );

          const report = await refsReport(cap, decl, 0, 16);

          expect(report.mechanism).toBe('text-scan');
          expect(report.locations).toContainEqual({
            file: use,
            line: 1,
            column: 0,
          });
        });
      });

      describe('B5: skipped files are disclosed', () => {
        it('an unreadable file in the certified scope makes the scoped answer truncated', async () => {
          mockScopeComplete.add('typescript');
          mockScopeComplete.add('javascript');
          mockScopeComplete.add('tsx');
          const indexer = streamingIndexer([DECL, CONSUMER, PY_USER]);
          const { cap } = build({
            reader: readerWith(indexHit(DECL, 'doThing', 0)),
            fs: {
              readFile: jest.fn(async (p: string) => {
                if (p === CONSUMER) throw new Error('EACCES');
                return TS_FILES[p] ?? '';
              }),
            },
            indexer,
            depGraph: builtGraph(graphCoverage(), { [DECL]: [CONSUMER] }),
          });

          await expect(refsReport(cap, DECL, 0, 16)).resolves.toEqual({
            locations: [{ file: DECL, line: 0, column: 16 }],
            mechanism: 'graph-scoped-scan',
            language: 'typescript',
            languageSupported: true,
            approximations: [],
            truncated: true,
          });
        });

        it.each<[string, jest.Mock]>([
          [
            'a file that cannot be statted',
            jest.fn(async (p: string) => {
              if (p === CONSUMER) throw new Error('EPERM');
              return { size: 10 };
            }),
          ],
          [
            'a file over the 1 MiB scan limit',
            jest.fn(async (p: string) => ({
              size: p === CONSUMER ? 2 * 1024 * 1024 : 10,
            })),
          ],
        ])('the text scan discloses %s as truncated', async (_case, stat) => {
          const { cap } = build({
            fs: { ...memoryFs(TS_FILES), stat },
            indexer: streamingIndexer([DECL, CONSUMER, PY_USER]),
          });

          const report = await refsReport(cap, DECL, 0, 16);

          expect(report.locations).toEqual([
            { file: DECL, line: 0, column: 16 },
            { file: PY_USER, line: 0, column: 0 },
          ]);
          expect(report.truncated).toBe(true);
        });

        it('discovery that could not read part of the tree keeps its matches, truncated', async () => {
          const { cap } = build({
            fs: memoryFs(TS_FILES),
            indexer: {
              findFiles: jest.fn(async () => {
                throw new IncompleteFileSearchError([DECL, PY_USER], {
                  total: 1,
                  byCode: { EACCES: 1 },
                });
              }),
            },
          });

          const report = await refsReport(cap, DECL, 0, 16);

          expect(report.locations).toEqual([
            { file: DECL, line: 0, column: 16 },
            { file: PY_USER, line: 0, column: 0 },
          ]);
          expect(report.truncated).toBe(true);
        });
      });

      describe('closing R26B-C-M2: workspace ignore files bound the text scan', () => {
        const decl = 'C:/repo/src/decl.ts';
        const generated = 'C:/repo/aaa-generated/client.ts';
        const use = 'C:/repo/zsrc/use.ts';

        /** The real resolver over an in-memory root `.gitignore`. */
        function realIgnore(gitignore: string): IgnorePatternResolverService {
          return new IgnorePatternResolverService(
            {
              exists: jest.fn(
                async (p: string) =>
                  p.replace(/\\/g, '/') === 'C:/repo/.gitignore',
              ),
              readFile: jest.fn(async () => gitignore),
            } as never,
            {} as never,
          );
        }

        it('an ignored generated tree cannot use up the match cap before source, and is no truncation', async () => {
          // The discovery mock returns the ignored file too (as an adapter
          // that did not prune it would): the exact matcher must drop it.
          const indexer = streamingIndexer([generated, decl, use]);
          const { cap } = build({
            fs: memoryFs({
              [decl]: 'export function Foo() {}',
              [generated]: 'Foo '.repeat(501),
              [use]: 'Foo();',
            }),
            indexer,
            ignoreResolver: realIgnore('aaa-generated/\n'),
          });

          const report = await refsReport(cap, decl, 0, 16);

          expect(report.locations).toEqual([
            { file: decl, line: 0, column: 16 },
            { file: use, line: 0, column: 0 },
          ]);
          expect(report.truncated).toBeUndefined();
          // The ignored tree is also pruned inside the bounded walk.
          expect(indexer.findFiles).toHaveBeenCalledWith(
            expect.any(String),
            expect.arrayContaining(['**/node_modules/**', 'aaa-generated/**']),
            8001,
            'C:/repo',
          );
        });

        it('a negated pattern re-includes a file, so the walk is not pruned by its directory', async () => {
          const keep = 'C:/repo/gen/keep.ts';
          const other = 'C:/repo/gen/other.ts';
          const indexer = streamingIndexer([decl, keep, other]);
          const { cap } = build({
            fs: memoryFs({
              [decl]: 'export function Foo() {}',
              [keep]: 'Foo();',
              [other]: 'Foo();',
            }),
            indexer,
            ignoreResolver: realIgnore('gen/\n!gen/keep.ts\n'),
          });

          const report = await refsReport(cap, decl, 0, 16);

          expect(report.locations).toEqual([
            { file: decl, line: 0, column: 16 },
            { file: keep, line: 0, column: 0 },
          ]);
          const [, excludes] = indexer.findFiles.mock.calls[0] as [
            string,
            string[],
          ];
          expect(excludes).not.toContain('gen/**');
        });
      });

      describe('B6: interpolated expressions are references, literal text is not', () => {
        it.each([
          [
            'TypeScript template',
            'C:/repo/src/t.ts',
            'const s = `Foo ${Foo()} x`;',
            17,
          ],
          [
            'JavaScript template',
            'C:/repo/src/t.js',
            'const s = `Foo ${Foo()} x`;',
            17,
          ],
          ['Python f-string', 'C:/repo/py/t.py', 's = f"Foo {Foo()} x"', 11],
        ])('%s', async (_case, file, text, column) => {
          const decl = 'C:/repo/src/decl.ts';
          const { cap } = build({
            fs: memoryFs({ [decl]: 'export function Foo() {}', [file]: text }),
            indexer: streamingIndexer([decl, file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, decl, 0, 16);

          expect(report.locations).toEqual([
            { file: decl, line: 0, column: 16 },
            { file, line: 0, column },
          ]);
        });
      });

      describe('Batch 29b r1 R29b-01: .tsx references are filtered with the TSX grammar', () => {
        const app = 'C:/repo/src/App.tsx';

        it.each([
          ['quoted JSX text', '<div>"{needle}"</div>'],
          ['line-comment-shaped JSX text', '<div>// {needle}</div>'],
          ['block-comment-shaped JSX text', '<div>/* {needle} */</div>'],
        ])('keeps a JSX expression reference inside %s', async (_case, jsx) => {
          const use = `export function App() { return ${jsx}; }`;
          const { cap } = build({
            fs: memoryFs({ [app]: `export const needle = 1;\n${use}\n` }),
            indexer: streamingIndexer([app]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, app, 0, 14);

          expect(report.language).toBe('tsx');
          expect(report.locations).toEqual([
            { file: app, line: 0, column: 13 },
            { file: app, line: 1, column: use.indexOf('needle') },
          ]);
        });

        it('still excludes real comments and strings in a .tsx file (contrast)', async () => {
          const source = [
            'export const needle = 1;',
            '// needle in a comment',
            "const s = 'needle in a string';",
            'export const App = () => <b>{needle}</b>;',
            '',
          ].join('\n');
          const { cap } = build({
            fs: memoryFs({ [app]: source }),
            indexer: streamingIndexer([app]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, app, 0, 14);

          expect(report.locations).toEqual([
            { file: app, line: 0, column: 13 },
            {
              file: app,
              line: 3,
              column: 'export const App = () => <b>{'.length,
            },
          ]);
        });
      });

      // Batch 30: `.java` and `.rs` now select their own grammars through the
      // shared map, so the comment/string filter runs for them instead of
      // keeping every name-shaped match.
      describe('Batch 30: .java and .rs references are filtered with their own grammars', () => {
        it('drops Java comment and string matches and keeps a string-template expression', async () => {
          const file = 'C:/repo/src/App.java';
          const lines = [
            'class App {',
            '  static int needle = 1;',
            '  // needle in a comment',
            '  /* needle */ /** needle */',
            '  String s = "needle in a string";',
            '  String block = """',
            '    needle in a text block',
            '    """;',
            "  char c = 'n';",
            '  String t = STR."value \\{needle}";',
            '  int use() { return needle; }',
            '}',
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, file, 1, 14);

          expect(report.language).toBe('java');
          expect(report.locations).toEqual([
            { file, line: 1, column: 13 },
            { file, line: 9, column: lines[9].indexOf('needle') },
            { file, line: 10, column: lines[10].indexOf('needle') },
          ]);
        });

        it('drops Rust comment and plain string matches and keeps a braced string (possible format argument)', async () => {
          const file = 'C:/repo/src/main.rs';
          const lines = [
            'fn needle() -> u32 { 1 }',
            '// needle in a comment',
            '/* needle */',
            'fn main() {',
            '    let s = "needle in a string";',
            '    let r = r#"needle raw"#;',
            '    println!("{needle:?}");',
            '    let v = needle();',
            '}',
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, file, 0, 4);

          expect(report.language).toBe('rust');
          expect(report.locations).toEqual([
            { file, line: 0, column: 3 },
            { file, line: 6, column: lines[6].indexOf('needle') },
            { file, line: 7, column: lines[7].indexOf('needle') },
          ]);
        });

        // Batch 30 r1 R30-03: the reviewer's triggers, plus the pinned
        // decisions for byte strings and brace-free strings.
        it('keeps Rust format uses: dynamic width `{0:needle$}`, escaped braces, and a line-continued escaped format string', async () => {
          const file = 'C:/repo/src/fmt.rs';
          const lines = [
            'const needle: usize = 5;',
            'fn main() {',
            '    println!("{0:needle$}", 1);',
            // Cooked value `{needle}`; the raw text holds no brace. (A name
            // glued to an escape, `\x7bneedle`, has no identifier boundary in
            // the raw text and stays a known text-scan miss.)
            '    println!("\\x7b\\',
            '        needle\\x7d");',
            '    let w = format!("{needle:?}");',
            '}',
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, file, 0, 8);

          expect(report.language).toBe('rust');
          expect(report.truncated).toBeUndefined();
          expect(report.locations).toEqual([
            { file, line: 0, column: 6 },
            { file, line: 2, column: lines[2].indexOf('needle') },
            { file, line: 4, column: lines[4].indexOf('needle') },
            { file, line: 5, column: lines[5].indexOf('needle') },
          ]);
        });

        it('the cursor on `needle$` in a Rust format string resolves to `needle` (no `$` in Rust identifiers)', async () => {
          const file = 'C:/repo/src/width.rs';
          const lines = [
            'const needle: usize = 5;',
            'fn main() { println!("{0:needle$}", 1); }',
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(
            cap,
            file,
            1,
            lines[1].indexOf('needle') + 2,
          );

          expect(report.locations).toEqual([
            { file, line: 0, column: 6 },
            { file, line: 1, column: lines[1].indexOf('needle') },
          ]);
        });

        it('pins the string decisions: byte strings and strings with no format argument are excluded (Batch 31 r1 R31-04: read by the format rules)', async () => {
          const file = 'C:/repo/src/strings.rs';
          const lines = [
            'fn needle() {}',
            'fn main() {',
            '    let a = "needle plain";',
            '    let b = r#"needle raw"#;',
            '    let c = b"needle bytes {x}";',
            '    let d = br"needle rawbytes {x}";',
            '    let e = "needle \\n with an escape";',
            '    let f = r"needle {raw brace}";',
            '    needle();',
            '}',
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, file, 0, 4);

          // Every string is read by the format rules: none of them names
          // `needle` as an argument (`e` is an escape without a brace, `f`
          // names `raw brace`), so only the declaration and the call stay.
          expect(report.locations).toEqual([
            { file, line: 0, column: 3 },
            { file, line: 8, column: lines[8].indexOf('needle') },
          ]);
        });

        // Batch 31 r1 R31-04: a capture glued to an escaped brace, or after
        // escaped `{{`, is a use; `{{needle}}` is literal text.
        it.each([
          ['an escaped brace glued to the name', '"\\x7bneedle\\x7d"', true],
          ['a unicode-escaped brace', '"\\u{7b}needle\\u{7d}"', true],
          ['escaped `{{` followed by a capture', '"{{{needle}"', true],
          ['a capture followed by escaped `}}`', '"{needle}}}"', true],
          ['a width argument after an escape', '"\\x7b0:needle$}"', true],
          ['a precision argument', '"{:.needle$}"', true],
          ['a raw string capture', 'r#"{needle}"#', true],
          ['literal braces `{{needle}}`', '"{{needle}}"', false],
          ['a byte string', 'b"{needle}"', false],
        ])(
          'Rust format string with %s: %s is a use: %s',
          async (_label, literal, isUse) => {
            const file = 'C:/repo/src/escaped.rs';
            const lines = [
              'const needle: i32 = 1;',
              `fn main() { println!(${literal}); }`,
              '',
            ];
            const { cap } = build({
              fs: memoryFs({ [file]: lines.join('\n') }),
              indexer: streamingIndexer([file]),
              treeSitter: parser as unknown as TreeSitter,
            });

            const report = await refsReport(cap, file, 0, 8);

            expect(report.truncated).toBeUndefined();
            expect(report.locations).toEqual([
              { file, line: 0, column: 6 },
              ...(isUse
                ? [
                    {
                      file,
                      line: 1,
                      column: lines[1].indexOf('needle'),
                    },
                  ]
                : []),
            ]);
          },
        );
      });

      // Batch 31: `.php`, `.rb` and `.c/.h/.cpp` select their own grammars
      // (C through the C++ one). Interpolated names stay references.
      describe('Batch 31: PHP, Ruby and C/C++ references are filtered with their own grammars', () => {
        function positions(
          file: string,
          lines: readonly string[],
          rows: readonly number[],
        ): Array<{ file: string; line: number; column: number }> {
          return rows.map((line) => ({
            file,
            line,
            column: lines[line].indexOf('needle'),
          }));
        }

        it('PHP: drops HTML text, comments, single-quoted strings and nowdocs; keeps `$needle` interpolations and heredoc variables', async () => {
          const file = 'C:/repo/app/page.php';
          const lines = [
            '<p>needle in the page</p>', // 0 HTML text
            '<?php', // 1
            'function needle() { return 1; }', // 2
            '// needle comment', // 3
            '# needle hash comment', // 4
            "$a = 'needle single';", // 5
            '$b = "value $needle";', // 6 interpolated variable
            '$c = "value {$needle}";', // 7
            '$d = <<<EOT', // 8
            'heredoc $needle', // 9 heredoc variable
            'EOT;', // 10
            "$e = <<<'EOT'", // 11
            'nowdoc needle', // 12
            'EOT;', // 13
            'needle();', // 14
            '?>', // 15
            '<div><?= needle() ?></div>', // 16 PHP inside HTML
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, file, 2, 10);

          expect(report.language).toBe('php');
          expect(report.locations).toEqual(
            positions(file, lines, [2, 6, 7, 9, 14, 16]),
          );
        });

        it('PHP: the cursor on `$needle` resolves to `needle` (`$` is a sigil, not part of the name)', async () => {
          const file = 'C:/repo/app/vars.php';
          const lines = [
            '<?php',
            '$needle = 1;',
            'echo $needle + needle();',
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          // The cursor sits on the `n` of `$needle`.
          const report = await refsReport(cap, file, 1, 1);

          expect(report.locations).toEqual([
            { file, line: 1, column: 1 },
            { file, line: 2, column: 6 },
            { file, line: 2, column: lines[2].lastIndexOf('needle') },
          ]);
        });

        it('Ruby: drops comments and literal string text (heredoc, regex, %w included); keeps `#{needle}` interpolations and symbols', async () => {
          const file = 'C:/repo/lib/widget.rb';
          const lines = [
            'def needle; 1; end', // 0
            '# needle comment', // 1
            "a = 'needle single'", // 2
            'b = "value #{needle}"', // 3 interpolation
            'c = <<~EOT', // 4
            '  heredoc #{needle}', // 5 heredoc interpolation
            '  heredoc needle text', // 6
            'EOT', // 7
            'd = /needle #{needle}/', // 8 regex: text dropped, interpolation kept
            'e = %w[needle words]', // 9
            'f = :needle', // 10 a symbol can name the method (send, respond_to?)
            'needle', // 11
            '',
          ];
          const { cap } = build({
            fs: memoryFs({ [file]: lines.join('\n') }),
            indexer: streamingIndexer([file]),
            treeSitter: parser as unknown as TreeSitter,
          });

          const report = await refsReport(cap, file, 0, 5);

          expect(report.language).toBe('ruby');
          expect(report.locations).toEqual([
            { file, line: 0, column: 4 },
            { file, line: 3, column: lines[3].indexOf('needle') },
            { file, line: 5, column: lines[5].indexOf('needle') },
            { file, line: 8, column: lines[8].lastIndexOf('needle') },
            { file, line: 10, column: lines[10].indexOf('needle') },
            { file, line: 11, column: 0 },
          ]);
        });

        it.each([
          ['C', 'C:/repo/native/widget.c'],
          ['a C header', 'C:/repo/native/widget.h'],
          ['C++', 'C:/repo/native/widget.cpp'],
        ])(
          '%s: drops comments, strings, chars and system include paths; keeps macro bodies',
          async (_label, file) => {
            const lines = [
              'int needle(void) { return 1; }', // 0
              '// needle comment', // 1
              '/* needle block */', // 2
              'const char *s = "needle string";', // 3
              "char c = 'n';", // 4
              '#include <needle.h>', // 5
              '#define CALL_NEEDLE needle()', // 6 a real use
              'int use(void) { return needle(); }', // 7
              '',
            ];
            const { cap } = build({
              fs: memoryFs({ [file]: lines.join('\n') }),
              indexer: streamingIndexer([file]),
              treeSitter: parser as unknown as TreeSitter,
            });

            const report = await refsReport(cap, file, 0, 5);

            expect(report.language).toBe('cpp');
            // Batch 31 r1 R31-01: C read with the C++ grammar says so, clean
            // answer or not; C++ does not.
            expect(report.approximations).toEqual(
              file.endsWith('.cpp')
                ? ['text-scan']
                : ['text-scan', 'c:parsed-as-cpp'],
            );
            expect(report.locations).toEqual([
              { file, line: 0, column: 4 },
              { file, line: 6, column: lines[6].lastIndexOf('needle') },
              { file, line: 7, column: lines[7].indexOf('needle') },
            ]);
          },
        );
      });

      describe('M1: a full symbol-index page', () => {
        const fullPage = Array.from({ length: 25 }, (_, i) =>
          indexHit(`C:/repo/src/m${i}.ts`, 'doThing', 0),
        );

        it('qualifies the definition answer as truncated', async () => {
          const { cap } = build({
            reader: readerWith(...fullPage),
            fs: memoryFs({ [CONSUMER]: 'doThing();' }),
          });

          const report = await defsReport(cap, CONSUMER, 0, 0);

          expect(report.mechanism).toBe('symbol-index');
          expect(report.locations).toHaveLength(25);
          expect(report.truncated).toBe(true);
        });

        it('closing R26B-C-M1: a saturated page of same-file (local) candidates stays truncated', async () => {
          // 25 same-named declarations in the cursor file: more may be cut off.
          const sameFile = Array.from({ length: 25 }, (_, i) =>
            indexHit(CONSUMER, 'doThing', i * 3),
          );
          const { cap } = build({
            reader: readerWith(...sameFile),
            fs: memoryFs({ [CONSUMER]: 'doThing();' }),
          });

          const report = await defsReport(cap, CONSUMER, 0, 0);

          expect(report.locations).toHaveLength(25);
          expect(report.locations.every((l) => l.file === CONSUMER)).toBe(true);
          expect(report.truncated).toBe(true);
        });

        it('closing R26B-C-M1: a saturated page picked through the imported file stays truncated', async () => {
          const imported = 'C:/repo/src/foo.ts';
          const page = [
            indexHit(imported, 'doThing', 0),
            indexHit(imported, 'doThing', 9),
            ...fullPage.slice(2),
          ];
          const { cap } = build({
            reader: readerWith(...page),
            fs: memoryFs({ [CONSUMER]: 'doThing();' }),
            ast: {
              analyzeSource: jest.fn(async () =>
                ok({
                  imports: [{ source: './foo', importedSymbols: ['doThing'] }],
                  exports: [],
                  functions: [],
                  classes: [],
                }),
              ),
            },
          });

          const report = await defsReport(cap, CONSUMER, 0, 0);

          expect(report.locations).toEqual([
            { file: imported, line: 0, column: 0 },
            { file: imported, line: 9, column: 0 },
          ]);
          expect(report.truncated).toBe(true);
        });

        it('keeps a local pick from a page that was not full unqualified', async () => {
          const { cap } = build({
            reader: readerWith(
              indexHit(CONSUMER, 'doThing', 0),
              ...fullPage.slice(1, 10),
            ),
            fs: memoryFs({ [CONSUMER]: 'doThing();' }),
          });

          const report = await defsReport(cap, CONSUMER, 0, 0);

          expect(report.locations).toEqual([
            { file: CONSUMER, line: 0, column: 0 },
          ]);
          expect(report.truncated).toBeUndefined();
        });

        it('never narrows on an incomplete candidate set', async () => {
          mockScopeComplete.add('typescript');
          mockScopeComplete.add('javascript');
          mockScopeComplete.add('tsx');
          const indexer = streamingIndexer([DECL, CONSUMER, PY_USER]);
          const { cap } = build({
            reader: readerWith(
              indexHit(DECL, 'doThing', 0),
              ...fullPage.slice(1),
            ),
            fs: memoryFs(TS_FILES),
            indexer,
            depGraph: builtGraph(graphCoverage(), { [DECL]: [CONSUMER] }),
          });

          const report = await refsReport(cap, DECL, 0, 16);

          expect(report.mechanism).toBe('text-scan');
          expect(report.locations).toEqual(TEXT_SCAN_HITS);
        });
      });

      describe('M2: identifier boundaries include $', () => {
        it('matches $-prefixed identifiers whole, and never inside another identifier', async () => {
          const file = 'C:/repo/src/d.ts';
          const text = 'const $Foo = 1;\n$Foo; x$Foo; $FooBar;\nFoo; $Foo';
          const { cap } = build({
            fs: memoryFs({ [file]: text }),
            indexer: streamingIndexer([file]),
          });

          await expect(refsReport(cap, file, 0, 6)).resolves.toMatchObject({
            locations: [
              { file, line: 0, column: 6 },
              { file, line: 1, column: 0 },
              { file, line: 2, column: 5 },
            ],
          });
          await expect(refsReport(cap, file, 2, 0)).resolves.toMatchObject({
            locations: [{ file, line: 2, column: 0 }],
          });
        });
      });
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
