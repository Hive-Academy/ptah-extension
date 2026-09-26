import 'reflect-metadata';

import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  AstAnalysisService,
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

type Reader = {
  searchSymbols: jest.Mock;
};
type Indexer = {
  indexWorkspaceStream: jest.Mock;
};
type Fs = {
  readFile: jest.Mock;
  exists?: jest.Mock;
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
  realpath?: (p: string) => Promise<string>;
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
  // Virtual paths (C:/repo, //server/share) do not exist on disk: the default
  // canonicalisation is the identity; on-disk suites pass the real realpath.
  const realpath = overrides.realpath ?? (async (p: string) => p);

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
    function diskFs(): Required<Fs> {
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
      const noSecretRead = (fs: Required<Fs>) =>
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
          const fs: Required<Fs> = {
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
      // Graph built, but global scripts have no import edges.
      const depGraph: DepGraph = {
        isBuilt: jest.fn(() => true),
        getDependents: jest.fn(() => []),
      };
      const indexer: Indexer = {
        indexWorkspaceStream: jest.fn(() =>
          streamOf(['C:/repo/src/global.ts', 'C:/repo/src/script.ts']),
        ),
      };
      const { cap } = build({ reader, fs, depGraph, indexer });

      const result = await cap.lsp.getReferences('C:/repo/src/global.ts', 0, 9);

      expect(result).toEqual([
        { file: 'C:/repo/src/global.ts', line: 0, column: 9 },
        { file: 'C:/repo/src/script.ts', line: 0, column: 0 },
      ]);
      expect(indexer.indexWorkspaceStream).toHaveBeenCalledTimes(1);
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
        indexWorkspaceStream: jest.fn(() => streamOf(['C:/repo/src/foo.ts'])),
      };
      const { cap } = build({ reader, fs, depGraph, indexer });

      await cap.lsp.getReferences('C:/repo/src/foo.ts', 0, 16);

      expect(depGraph.isBuilt).toHaveBeenCalledWith('C:/repo');
      expect(indexer.indexWorkspaceStream).toHaveBeenCalledTimes(1);
      expect(depGraph.getDependents).not.toHaveBeenCalled();
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
