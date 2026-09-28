/**
 * Specs for buildAstNamespace.
 *
 * Covers ptah.ast.* methods:
 *   - shape round-trip
 *   - analyze / parse / queryFunctions / queryClasses / queryImports
 *     / queryExports — each must resolve a workspace-relative path, read the
 *     file, detect language from the file extension, and forward content to
 *     the right service method
 *   - error path — service returning `isErr()` surfaces as a thrown Error
 *   - getSupportedLanguages — returns the de-duplicated EXTENSION_LANGUAGE_MAP
 *     values
 *   - Batch 24c: parse and the three structural queries lead with parse
 *     status and coverage, proven on the REAL parser with a JSX `.tsx` file
 *     (the TypeScript grammar has no JSX, so it recovers)
 */

// Use the real registry for capability/coverage assertions and stub service
// instances at the boundary. The project's Jest mappings supply vscode and
// the WASM path shim when the workspace-intelligence barrel is loaded.
import 'reflect-metadata';

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ...jest.requireActual('@ptah-extension/workspace-intelligence'),
  EXTENSION_LANGUAGE_MAP: {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    // A parsed language without public-symbol extraction (Java's, Task
    // 34.2, is deferred: User Decision 27). C# has them since Batch 34.
    '.java': 'java',
  },
  // Service classes are used as types only by the SUT — expose as stubs.
  TreeSitterParserService: class {},
  AstAnalysisService: class {},
}));

// Real grammars for the Batch 24c real-parser specs: the shims
// `ast-analyze-result.spec.ts` documents (the lib-wide wasm-bundle-dir stub
// throws on purpose, and web-tree-sitter must load grammars from bytes).
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

import { Result } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AstAnalysisService,
  TreeSitterParserService,
} from '@ptah-extension/workspace-intelligence';
import {
  FileType,
  isCleanAnswer,
  type LanguageCoverage,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  buildAstNamespace,
  type AstNamespaceDependencies,
} from './ast-namespace.builder';
import type { AstNamespace } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParserMock {
  parse: jest.Mock;
  queryMulti: jest.Mock;
  queryExports: jest.Mock;
}

interface AnalysisMock {
  analyzeSource: jest.Mock;
}

interface FsMock {
  readFile: jest.Mock;
  stat: jest.Mock;
}

interface WsMock {
  getWorkspaceRoot: jest.Mock;
}

function createParser(): ParserMock {
  return {
    parse: jest.fn(),
    queryMulti: jest.fn(),
    queryExports: jest.fn(),
  };
}

type ParseQualityFields = {
  parseStatus?: 'ok' | 'recovered';
  errorNodeCount?: number;
  errorNodeCountCapped?: boolean;
};

const CLEAN_PARSE: ParseQualityFields = {
  parseStatus: 'ok',
  errorNodeCount: 0,
  errorNodeCountCapped: false,
};

/**
 * `queryMulti` answering every requested query with `matches`, carrying
 * `quality` the way the real service attaches it to its result map.
 */
function answerQueryMulti(
  parser: ParserMock,
  matches: unknown[],
  quality: ParseQualityFields = CLEAN_PARSE,
): void {
  parser.queryMulti.mockImplementation(
    async (
      _content: string,
      _language: string,
      queries: Array<{ key: string }>,
    ) =>
      Result.ok(
        Object.assign(
          new Map(queries.map((query) => [query.key, matches])),
          quality,
        ),
      ),
  );
}

function makeDeps(): {
  deps: AstNamespaceDependencies;
  parser: ParserMock;
  analysis: AnalysisMock;
  fs: FsMock;
  ws: WsMock;
} {
  const parser = createParser();
  const analysis: AnalysisMock = { analyzeSource: jest.fn() };
  const fs: FsMock = {
    readFile: jest.fn().mockResolvedValue('code'),
    stat: jest.fn().mockResolvedValue({ type: FileType.File }),
  };
  const ws: WsMock = { getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws') };

  const deps: AstNamespaceDependencies = {
    treeSitterParser: parser as unknown as TreeSitterParserService,
    astAnalysis: analysis as unknown as AstAnalysisService,
    fileSystemProvider: fs as unknown as IFileSystemProvider,
    workspaceProvider: ws as unknown as IWorkspaceProvider,
  };

  return { deps, parser, analysis, fs, ws };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildAstNamespace — shape', () => {
  it('exposes the documented seven methods', () => {
    const { deps } = makeDeps();
    const ns = buildAstNamespace(deps);

    expect(typeof ns.analyze).toBe('function');
    expect(typeof ns.parse).toBe('function');
    expect(typeof ns.queryFunctions).toBe('function');
    expect(typeof ns.queryClasses).toBe('function');
    expect(typeof ns.queryImports).toBe('function');
    expect(typeof ns.queryExports).toBe('function');
    expect(typeof ns.getSupportedLanguages).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------

describe('buildAstNamespace — analyze', () => {
  it.each(['ok', 'recovered'])(
    '24a exposes %s status and coverage before unbounded fields',
    async (parseStatus) => {
      const { deps, analysis } = makeDeps();
      analysis.analyzeSource.mockResolvedValue(
        Result.ok({
          parseStatus,
          errorNodeCount: parseStatus === 'ok' ? 0 : 1,
          errorNodeCountCapped: false,
          functions: [],
          classes: [],
          imports: [],
          exports: [],
        }),
      );
      const out = await buildAstNamespace(deps).analyze(
        'a'.repeat(10000) + '.tsx',
      );
      expect(out).toMatchObject({
        parseStatus,
        coverage: {
          census: 'complete',
          analyzed: parseStatus === 'ok' ? 1 : 0,
          failed: parseStatus === 'ok' ? 0 : 1,
        },
      });
      const coverage = Reflect.get(out, 'coverage') as LanguageCoverage;
      expect(isCleanAnswer(coverage)).toBe(parseStatus === 'ok');
      expect(JSON.stringify(out).slice(0, 1000)).toContain('"coverage"');
      expect(Object.keys(out).indexOf('coverage')).toBeLessThan(
        Object.keys(out).indexOf('file'),
      );
    },
  );

  // Batch 22c: the coverage in the message is the compact block, so it names
  // `supportedLanguages` only when the file's language is unsupported; an
  // unrecognised file still gets the supported list in the message itself.
  it.each([
    ['sample.swift', 'unsupported'],
    ['sample.xyz', 'unrecognised'],
    ['sample.mjs', 'unsupported'],
  ])(
    '24a rejects %s with shared coverage ahead of the path',
    async (file, bucket) => {
      const { deps } = makeDeps();
      const failure = await buildAstNamespace(deps)
        .analyze(file)
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : '';
      const coverage: unknown = JSON.parse(
        message.slice(0, message.indexOf('} ') + 1),
      );
      expect(coverage).toEqual({
        coverage: {
          clean: false,
          reasons: [bucket],
          ...(bucket === 'unsupported'
            ? { supportedLanguages: expect.any(Array) }
            : {}),
          [bucket]: 1,
          ...(bucket === 'unsupported'
            ? { unsupportedByLanguage: expect.any(Object) }
            : {}),
        },
      });
      expect(message).toMatch(/Supported: /);
    },
  );

  // Python and Go public declarations are extracted since Batch 33, C#
  // since Batch 34; Java's (Task 34.2) are deferred.
  it('24a rejects Java exports instead of a silent empty list', async () => {
    const { deps, parser } = makeDeps();
    parser.queryExports.mockResolvedValue(Result.ok([]));
    await expect(
      buildAstNamespace(deps).queryExports('Main.java'),
    ).rejects.toThrow(/java.*typescript.*javascript/);
    expect(parser.queryExports).not.toHaveBeenCalled();
  });

  it('resolves workspace-relative paths, reads the file and delegates to analyzeSource', async () => {
    const { deps, analysis, fs } = makeDeps();
    analysis.analyzeSource.mockResolvedValue(
      Result.ok({
        functions: [{ name: 'f' }],
        classes: [],
        imports: [],
        exports: [],
      }),
    );

    const out = await buildAstNamespace(deps).analyze('src/a.ts');

    expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('a.ts'));
    expect(analysis.analyzeSource).toHaveBeenCalledWith(
      'code',
      'typescript',
      expect.stringContaining('a.ts'),
    );
    expect(out).toEqual({
      parseStatus: 'unknown',
      errorNodeCount: null,
      errorNodeCountCapped: false,
      coverage: expect.objectContaining({ unchecked: 1, analyzed: 0 }),
      file: 'src/a.ts',
      language: 'typescript',
      functions: [{ name: 'f' }],
      classes: [],
      imports: [],
      exports: [],
    });
  });

  it('throws a clear error when the path is a directory instead of reading it', async () => {
    const { deps, fs } = makeDeps();
    fs.stat.mockResolvedValue({ type: FileType.Directory });

    await expect(
      buildAstNamespace(deps).analyze('src/some.dir'),
    ).rejects.toThrow(/is a directory, not a file/);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('throws when the file extension is not in EXTENSION_LANGUAGE_MAP', async () => {
    const { deps } = makeDeps();
    await expect(
      buildAstNamespace(deps).analyze('README.unknown'),
    ).rejects.toThrow(/Unsupported file type/);
  });

  it('throws with the Result error message when analyzeSource fails', async () => {
    const { deps, analysis } = makeDeps();
    analysis.analyzeSource.mockResolvedValue(
      Result.err(new Error('bad parse')),
    );

    await expect(buildAstNamespace(deps).analyze('src/a.ts')).rejects.toThrow(
      /bad parse/,
    );
  });

  it('throws when there is no workspace root for a relative path', async () => {
    const { deps, ws } = makeDeps();
    ws.getWorkspaceRoot.mockReturnValue(undefined);

    await expect(buildAstNamespace(deps).analyze('src/a.ts')).rejects.toThrow(
      /No workspace folder/,
    );
  });

  it('resolves a relative path against the explicit workspaceRoot instead of the active workspace', async () => {
    const { deps, analysis, fs, ws } = makeDeps();
    analysis.analyzeSource.mockResolvedValue(
      Result.ok({ functions: [], classes: [], imports: [], exports: [] }),
    );

    await buildAstNamespace(deps).analyze('src/a.ts', 'D:/other-ws');

    // The active-workspace root must be bypassed entirely.
    expect(ws.getWorkspaceRoot).not.toHaveBeenCalled();
    const readPath = fs.readFile.mock.calls[0][0] as string;
    expect(readPath.replace(/\\/g, '/')).toBe('D:/other-ws/src/a.ts');
  });

  it('falls back to the active workspace root when workspaceRoot is blank', async () => {
    const { deps, analysis, fs, ws } = makeDeps();
    analysis.analyzeSource.mockResolvedValue(
      Result.ok({ functions: [], classes: [], imports: [], exports: [] }),
    );

    await buildAstNamespace(deps).analyze('src/a.ts', '   ');

    expect(ws.getWorkspaceRoot).toHaveBeenCalled();
    const readPath = fs.readFile.mock.calls[0][0] as string;
    expect(readPath.replace(/\\/g, '/')).toBe('D:/ws/src/a.ts');
  });

  it('ignores workspaceRoot when the file path is already absolute', async () => {
    const { deps, analysis, fs, ws } = makeDeps();
    analysis.analyzeSource.mockResolvedValue(
      Result.ok({ functions: [], classes: [], imports: [], exports: [] }),
    );

    await buildAstNamespace(deps).analyze('D:/abs/a.ts', 'D:/other-ws');

    expect(ws.getWorkspaceRoot).not.toHaveBeenCalled();
    expect(fs.readFile).toHaveBeenCalledWith('D:/abs/a.ts');
  });
});

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

describe('buildAstNamespace — parse', () => {
  const fakeNode = {
    type: 'program',
    text: 'program text',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 5, column: 0 },
    children: [
      {
        type: 'ident',
        text: 'foo',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 3 },
        children: [],
      },
    ],
  };

  it('simplifies the AST and reports nodeCount including children', async () => {
    const { deps, parser } = makeDeps();
    parser.parse.mockResolvedValue(Result.ok(fakeNode));
    answerQueryMulti(parser, []);

    const result = await buildAstNamespace(deps).parse('src/a.ts');
    expect(result.language).toBe('typescript');
    expect(result.nodeCount).toBe(2);
    expect(result.ast.children?.[0].type).toBe('ident');
  });

  it('surfaces Result.err as a thrown error', async () => {
    const { deps, parser } = makeDeps();
    parser.parse.mockResolvedValue(Result.err(new Error('nope')));
    await expect(buildAstNamespace(deps).parse('src/a.ts')).rejects.toThrow(
      /nope/,
    );
  });
});

// ---------------------------------------------------------------------------
// queryFunctions / queryClasses / queryImports / queryExports
// ---------------------------------------------------------------------------

describe('buildAstNamespace — query methods', () => {
  it('queryFunctions extracts name + params + line range from captures', async () => {
    const { deps, parser } = makeDeps();
    answerQueryMulti(parser, [
      {
        captures: [
          {
            name: 'function.name',
            text: 'myFunc',
            startPosition: { row: 2 },
          },
          {
            name: 'function.params',
            text: '(a, b: number)',
            startPosition: { row: 2 },
          },
          {
            name: 'function.declaration',
            text: 'full',
            startPosition: { row: 2 },
            endPosition: { row: 7 },
          },
        ],
      },
    ]);

    const out = await buildAstNamespace(deps).queryFunctions('src/a.ts');
    expect(out.functions).toEqual([
      { name: 'myFunc', parameters: ['a', 'b'], startLine: 2, endLine: 7 },
    ]);
  });

  it('queryClasses dedupes by name+startLine and extracts endLine', async () => {
    const { deps, parser } = makeDeps();
    answerQueryMulti(parser, [
      {
        captures: [
          { name: 'class.name', text: 'C' },
          {
            name: 'class.declaration',
            startPosition: { row: 1 },
            endPosition: { row: 9 },
          },
        ],
      },
      {
        captures: [
          { name: 'class.name', text: 'C' },
          {
            name: 'class.declaration',
            startPosition: { row: 1 },
            endPosition: { row: 9 },
          },
        ],
      },
    ]);

    const out = await buildAstNamespace(deps).queryClasses('src/a.ts');
    expect(out.classes).toEqual([{ name: 'C', startLine: 1, endLine: 9 }]);
  });

  it('queryImports strips quotes around source and dedupes', async () => {
    const { deps, parser } = makeDeps();
    answerQueryMulti(parser, [
      {
        captures: [
          { name: 'import.source', text: '"lodash"' },
          { name: 'import.default', text: '_' },
        ],
      },
    ]);

    const out = await buildAstNamespace(deps).queryImports('src/a.ts');
    expect(out.imports).toEqual([
      {
        source: 'lodash',
        importedSymbols: ['_'],
        isDefault: true,
        isNamespace: undefined,
      },
    ]);
  });

  it('queryExports identifies function/class kinds', async () => {
    const { deps, parser } = makeDeps();
    // The shared decoder reads the `default` keyword from the statement node.
    parser.queryExports.mockResolvedValue(
      Result.ok([
        {
          captures: [
            {
              name: 'export.func_name',
              text: 'doIt',
              startPosition: { row: 0, column: 24 },
              endPosition: { row: 0, column: 28 },
            },
            {
              name: 'export.statement',
              text: 'export default function doIt() {}',
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 33 },
              node: {
                children: [{ type: 'export' }, { type: 'default' }],
              },
            },
          ],
        },
      ]),
    );

    const out = await buildAstNamespace(deps).queryExports('src/a.ts');
    expect(out[0]).toMatchObject({
      name: 'doIt',
      kind: 'function',
      isDefault: true,
    });
  });

  it('query methods surface Result.err as thrown errors', async () => {
    const { deps, parser } = makeDeps();
    parser.queryMulti.mockResolvedValue(Result.err(new Error('bad')));
    await expect(
      buildAstNamespace(deps).queryFunctions('src/a.ts'),
    ).rejects.toThrow(/bad/);
  });
});

// ---------------------------------------------------------------------------
// getSupportedLanguages
// ---------------------------------------------------------------------------

describe('buildAstNamespace — getSupportedLanguages', () => {
  it('returns a de-duplicated list that includes typescript and javascript', () => {
    const { deps } = makeDeps();
    const langs = buildAstNamespace(deps).getSupportedLanguages();
    expect(Array.isArray(langs)).toBe(true);
    expect(langs).toEqual(Array.from(new Set(langs))); // de-duplicated
    expect(langs).toEqual(expect.arrayContaining(['typescript', 'javascript']));
  });
});

// ---------------------------------------------------------------------------
// Batch 24c (24a r1 M2): parse honesty on parse and the structural queries
// ---------------------------------------------------------------------------

type ParsingOperation =
  'parse' | 'queryFunctions' | 'queryClasses' | 'queryImports';

const PARSING_OPERATIONS: readonly ParsingOperation[] = [
  'parse',
  'queryFunctions',
  'queryClasses',
  'queryImports',
];

/** The list field each operation returns after its honesty fields. */
const LIST_FIELD: Record<ParsingOperation, string> = {
  parse: 'ast',
  queryFunctions: 'functions',
  queryClasses: 'classes',
  queryImports: 'imports',
};

function runOperation(
  ns: AstNamespace,
  operation: ParsingOperation,
  file: string,
): Promise<object> {
  return ns[operation](file);
}

describe('buildAstNamespace — 24c parse honesty (stubbed parser)', () => {
  const tree = {
    type: 'program',
    text: 'program',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 1, column: 0 },
    children: [],
  };

  it.each(PARSING_OPERATIONS)(
    '%s reports a recovered parse as failed coverage, ahead of the file and list',
    async (operation) => {
      const { deps, parser } = makeDeps();
      parser.parse.mockResolvedValue(Result.ok(tree));
      answerQueryMulti(parser, [], {
        parseStatus: 'recovered',
        errorNodeCount: 3,
        errorNodeCountCapped: false,
      });
      const out = await runOperation(
        buildAstNamespace(deps),
        operation,
        'src/a.ts',
      );
      expect(out).toMatchObject({
        parseStatus: 'recovered',
        errorNodeCount: 3,
        coverage: { census: 'complete', analyzed: 0, failed: 1 },
      });
      const coverage = Reflect.get(out, 'coverage') as LanguageCoverage;
      expect(isCleanAnswer(coverage)).toBe(false);
      const keys = Object.keys(out);
      expect(keys.indexOf('coverage')).toBeLessThan(keys.indexOf('file'));
      expect(keys.indexOf('file')).toBeLessThan(
        keys.indexOf(LIST_FIELD[operation]),
      );
    },
  );

  it.each(PARSING_OPERATIONS)(
    '%s reports missing parser metadata as unknown, never clean',
    async (operation) => {
      const { deps, parser } = makeDeps();
      parser.parse.mockResolvedValue(Result.ok(tree));
      answerQueryMulti(parser, [], {});
      const out = await runOperation(
        buildAstNamespace(deps),
        operation,
        'src/a.ts',
      );
      expect(out).toMatchObject({
        parseStatus: 'unknown',
        errorNodeCount: null,
        coverage: { unchecked: 1, analyzed: 0 },
      });
      const coverage = Reflect.get(out, 'coverage') as LanguageCoverage;
      expect(isCleanAnswer(coverage)).toBe(false);
    },
  );

  it.each(PARSING_OPERATIONS)(
    '%s reports a clean parse as clean',
    async (operation) => {
      const { deps, parser } = makeDeps();
      parser.parse.mockResolvedValue(Result.ok(tree));
      answerQueryMulti(parser, []);
      const out = await runOperation(
        buildAstNamespace(deps),
        operation,
        'src/a.ts',
      );
      expect(out).toMatchObject({ parseStatus: 'ok', file: 'src/a.ts' });
      const coverage = Reflect.get(out, 'coverage') as LanguageCoverage;
      expect(isCleanAnswer(coverage)).toBe(true);
    },
  );

  it('runs each structural query on the same parse that reports its quality', async () => {
    const { deps, parser } = makeDeps();
    answerQueryMulti(parser, []);
    await buildAstNamespace(deps).queryClasses('src/a.ts');
    expect(parser.queryMulti).toHaveBeenCalledTimes(1);
    const [, language, queries] = parser.queryMulti.mock.calls[0] as [
      string,
      string,
      Array<{ key: string; queryString: string }>,
    ];
    expect(language).toBe('typescript');
    expect(queries).toHaveLength(1);
    expect(queries[0].queryString).toContain('class');
  });
});

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** Valid TSX: the bundled TypeScript grammar has no JSX, so it recovers. */
const JSX_TSX_SOURCE = [
  "import { render } from './render';",
  '',
  'export class Card {',
  '  title = "card";',
  '}',
  '',
  'export function View(props: { name: string }) {',
  '  return <div className="view">{props.name}</div>;',
  '}',
  '',
].join('\n');

describe('buildAstNamespace — 24c parse honesty (REAL parser, .tsx with JSX)', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/workspace-intelligence')
  >('@ptah-extension/workspace-intelligence');
  let parser: InstanceType<typeof actual.TreeSitterParserService>;
  let ns: AstNamespace;

  beforeAll(async () => {
    parser = new actual.TreeSitterParserService(silentLogger());
    const init = await parser.initialize();
    if (init.isErr()) {
      throw init.error ?? new Error('tree-sitter initialisation failed');
    }
    ns = buildAstNamespace({
      treeSitterParser: parser,
      astAnalysis: new actual.AstAnalysisService(silentLogger(), parser),
      fileSystemProvider: {
        stat: async () => ({ type: FileType.File }),
        readFile: async () => JSX_TSX_SOURCE,
      } as unknown as IFileSystemProvider,
      workspaceProvider: {
        getWorkspaceRoot: () => 'D:/ws',
      } as unknown as IWorkspaceProvider,
    });
    // Loading the WASM grammars exceeds Jest's 5 s default under parallel load.
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  it.each(PARSING_OPERATIONS)(
    '%s reports recovered, not a clean-looking result',
    async (operation) => {
      const out = await runOperation(ns, operation, 'src/view.tsx');
      expect(out).toMatchObject({
        parseStatus: 'recovered',
        coverage: { failed: 1, analyzed: 0 },
      });
      expect(Reflect.get(out, 'errorNodeCount')).toBeGreaterThan(0);
      const coverage = Reflect.get(out, 'coverage') as LanguageCoverage;
      expect(isCleanAnswer(coverage)).toBe(false);
    },
  );

  it('analyze agrees with the four operations on the same file', async () => {
    const out = await ns.analyze('src/view.tsx');
    expect(out.parseStatus).toBe('recovered');
  });
});
