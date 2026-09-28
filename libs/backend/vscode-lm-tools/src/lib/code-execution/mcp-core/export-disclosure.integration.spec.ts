/**
 * Export-extraction gaps reach every consumer (TASK_2026_559 Batch 24d,
 * carried findings R5-01 and R5-02 of the Batch 20.2 r5 review), measured on
 * the REAL parser.
 *
 * - R5-01: a file with `exports[key] = 1` used to vanish from
 *   `ptah_get_symbol_index` (no extracted export, so no entry) while the
 *   graph counted it analysed and clean; `ptah.ast.queryExports` returned a
 *   bare array without the disclosure. Now the symbol index keeps the file
 *   with `unextractedExports`, its coverage says `unsupported-syntax`, on an
 *   empty page and on a mixed one, and `queryExports` refuses a partial
 *   extraction.
 * - R5-02: `module["exports"].actual = 1` was not seen at all, so
 *   `ptah_ast_analyze` answered clean-empty.
 *
 * Real `TreeSitterParserService` + `AstAnalysisService` +
 * `DependencyGraphService` + namespace builders + `handleMCPRequest`; only
 * the file system, the workspace provider and the logger are adapters.
 *
 * The two shims are the ones `code-outliner.adapter.spec.ts` documents.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  AstAnalysisService,
  DependencyGraphService,
  TreeSitterParserService,
  type FileSystemService,
} from '@ptah-extension/workspace-intelligence';
import {
  FileType,
  isCleanAnswer,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { handleMCPRequest } from './protocol-dispatcher';
import type { ProtocolHandlerDependencies } from './protocol-dispatcher';
import { buildAstNamespace } from '../namespace-builders/ast-namespace.builder';
import {
  buildDependencyNamespace,
  type AnalysisNamespaceDependencies,
} from '../namespace-builders/analysis-namespace.builders';
import type { MCPResponse, PtahAPI } from '../types';

jest.mock('wasm-bundle-dir', () => {
  const nodePath = require('path');
  const grammarDir = nodePath.join(
    nodePath.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = nodePath.dirname(require.resolve('web-tree-sitter'));
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? nodePath.join(runtimeDir, filename)
        : nodePath.join(grammarDir, filename),
  };
});

jest.mock('web-tree-sitter', () => {
  const actual =
    jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
  const nodeFs = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(nodeFs.readFileSync(input))
        : input,
    );
  return actual;
});

// Rooted without a device, so the path is absolute on POSIX (`/ws-24d`) and on
// Windows (drive-less rooted) alike: `buildGraph` passes files through
// `toAbsoluteWorkspacePath`, whose `path.isAbsolute` is host-scoped, and a
// `D:/...` literal is not absolute to a POSIX runner — the root was then
// prefixed onto the already-absolute fixture and every read failed (CI Linux:
// `failedByReason: { read: N }` instead of `unsupported-syntax`).
const ROOT = '/ws-24d';

/** The r5 probe: a computed CommonJS key the extractor cannot name. */
const COMPUTED_ONLY = 'const key = "actual";\nexports[key] = 1;';
const MIXED = 'exports.known = 1;\nconst key = "actual";\nexports[key] = 2;';

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function bodyOf(response: MCPResponse): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('export-extraction gaps reach every consumer (real tree-sitter WASM)', () => {
  let parser: TreeSitterParserService;
  let astAnalysis: AstAnalysisService;
  const files = new Map<string, string>();

  beforeAll(async () => {
    parser = new TreeSitterParserService(silentLogger());
    const init = await parser.initialize();
    if (init.isErr()) {
      throw init.error ?? new Error('tree-sitter initialisation failed');
    }
    astAnalysis = new AstAnalysisService(silentLogger(), parser);
    // Loading the WASM grammars exceeds Jest's 5 s default under parallel load.
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  afterEach(() => {
    files.clear();
  });

  const readFile = async (p: string): Promise<string> => {
    const content = files.get(p);
    if (content === undefined) throw new Error(`no such file: ${p}`);
    return content;
  };

  /** `ptah_get_symbol_index` over a graph built from `sources`. */
  async function symbolIndexOf(
    sources: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    for (const [relative, content] of Object.entries(sources)) {
      files.set(`${ROOT}/${relative}`, content);
    }
    const graph = new DependencyGraphService(
      astAnalysis,
      { readFile } as unknown as FileSystemService,
      silentLogger(),
    );
    const dependencies = buildDependencyNamespace({
      dependencyGraph: graph,
      workspaceProvider: { getWorkspaceRoot: () => ROOT },
      fileSystemProvider: {
        findFiles: jest.fn().mockResolvedValue([...files.keys()]),
      } as unknown as IFileSystemProvider,
    } as unknown as AnalysisNamespaceDependencies);
    // Built before the call, so the answer never waits on the bounded build.
    await dependencies.buildGraph([...files.keys()], ROOT);

    const deps: ProtocolHandlerDependencies = {
      ptahAPI: {
        workspace: { getInfo: jest.fn().mockResolvedValue({ path: ROOT }) },
        dependencies,
      } as unknown as PtahAPI,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
      logger: silentLogger(),
    };
    return bodyOf(
      await handleMCPRequest(
        {
          jsonrpc: '2.0',
          id: 'r5-01',
          method: 'tools/call',
          params: { name: 'ptah_get_symbol_index', arguments: {} },
        },
        deps,
      ),
    );
  }

  it('R5-01: a file with only a computed CommonJS export is listed and the empty-symbol page is not clean', async () => {
    const body = await symbolIndexOf({ 'src/computed.js': COMPUTED_ONLY });

    expect(body['coverage']).toMatchObject({
      clean: false,
      failed: 1,
      failedByReason: { 'unsupported-syntax': 1 },
    });
    expect(body['files']).toEqual([
      {
        file: `${ROOT}/src/computed.js`,
        symbols: [],
        unextractedExports: ['line 2: exports'],
      },
    ]);
  }, 60_000);

  it('R5-01: a mixed page keeps the known symbols, names the partial file and is not clean', async () => {
    const body = await symbolIndexOf({
      'src/mixed.js': MIXED,
      'src/clean.js': 'exports.whole = 1;',
    });

    expect(body['coverage']).toMatchObject({
      clean: false,
      analyzed: 1,
      failed: 1,
      failedByReason: { 'unsupported-syntax': 1 },
    });
    const byFile = new Map(
      (body['files'] as Array<Record<string, unknown>>).map((entry) => [
        entry['file'],
        entry,
      ]),
    );
    expect(byFile.get(`${ROOT}/src/mixed.js`)).toEqual({
      file: `${ROOT}/src/mixed.js`,
      symbols: ['known'],
      unextractedExports: ['line 3: exports'],
    });
    expect(byFile.get(`${ROOT}/src/clean.js`)).toEqual({
      file: `${ROOT}/src/clean.js`,
      symbols: ['whole'],
    });
  }, 60_000);

  describe('the AST namespace', () => {
    function astNamespace() {
      return buildAstNamespace({
        treeSitterParser: parser,
        astAnalysis,
        fileSystemProvider: {
          stat: async () => ({ type: FileType.File }),
          readFile,
        } as unknown as IFileSystemProvider,
        workspaceProvider: {
          getWorkspaceRoot: () => ROOT,
        } as unknown as IWorkspaceProvider,
      });
    }

    it('R5-01: queryExports refuses a partial extraction instead of returning a bare array', async () => {
      files.set(`${ROOT}/src/mixed.js`, MIXED);

      await expect(
        astNamespace().queryExports(`${ROOT}/src/mixed.js`),
      ).rejects.toThrow(
        /unsupported-syntax[\s\S]*line 3: exports[\s\S]*ptah\.ast\.analyze/,
      );
    }, 60_000);

    it('R5-01: queryExports still returns the array for a complete extraction', async () => {
      files.set(`${ROOT}/src/clean.js`, 'exports.whole = 1;');

      await expect(
        astNamespace().queryExports(`${ROOT}/src/clean.js`),
      ).resolves.toEqual([{ name: 'whole', kind: 'variable' }]);
    }, 60_000);

    it.each([['src/bracket.ts'], ['src/bracket.js']])(
      'R5-02: module["exports"].actual in %s is never a clean empty answer',
      async (relative) => {
        files.set(`${ROOT}/${relative}`, 'module["exports"].actual = 1;');

        const result = await astNamespace().analyze(`${ROOT}/${relative}`);

        expect(result.parseStatus).toBe('ok');
        expect(result.exports).toEqual([{ name: 'actual', kind: 'variable' }]);
        expect(
          result.exports.length > 0 || !isCleanAnswer(result.coverage),
        ).toBe(true);
      },
      60_000,
    );

    // Review r1 R24d-01: the whole decoded key decides, through analyze and
    // queryExports alike.
    it('R24d-01: an escaped key that evaluates to "exports" is read as the export object', async () => {
      files.set(
        `${ROOT}/src/escaped.js`,
        'module["\\u0065xports"].actual = 1;',
      );
      const ns = astNamespace();

      const result = await ns.analyze(`${ROOT}/src/escaped.js`);
      expect(result.exports).toEqual([{ name: 'actual', kind: 'variable' }]);
      await expect(ns.queryExports(`${ROOT}/src/escaped.js`)).resolves.toEqual([
        { name: 'actual', kind: 'variable' },
      ]);
    }, 60_000);

    it('R24d-01: a computed module key is never a clean empty answer', async () => {
      files.set(
        `${ROOT}/src/computed-key.js`,
        'const k = "exports";\nmodule[k].actual = 1;',
      );
      const ns = astNamespace();

      const result = await ns.analyze(`${ROOT}/src/computed-key.js`);
      expect(result.exports).toEqual([]);
      expect(result.unextractedExports).toEqual(['line 2: module[k].actual']);
      expect(isCleanAnswer(result.coverage)).toBe(false);
      await expect(
        ns.queryExports(`${ROOT}/src/computed-key.js`),
      ).rejects.toThrow(/unsupported-syntax/);
    }, 60_000);

    it('R24d-01: a key that only contains "exports" fabricates no export', async () => {
      files.set(
        `${ROOT}/src/other-key.js`,
        'module["exports\\x78"].actual = 1;',
      );

      const result = await astNamespace().analyze(`${ROOT}/src/other-key.js`);
      expect(result.exports).toEqual([]);
      expect(result.unextractedExports).toBeUndefined();
    }, 60_000);
  });

  it('R24d-01: the symbol index discloses a computed module key instead of an empty clean page', async () => {
    const body = await symbolIndexOf({
      'src/computed-key.js': 'const k = "exports";\nmodule[k].actual = 1;',
    });

    expect(body['coverage']).toMatchObject({
      clean: false,
      failedByReason: { 'unsupported-syntax': 1 },
    });
    expect(body['files']).toEqual([
      {
        file: `${ROOT}/src/computed-key.js`,
        symbols: [],
        unextractedExports: ['line 2: module[k].actual'],
      },
    ]);
  }, 60_000);
});
