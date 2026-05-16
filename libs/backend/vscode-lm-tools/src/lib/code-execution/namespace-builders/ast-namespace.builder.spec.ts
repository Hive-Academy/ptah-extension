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
 */

// The SUT imports `EXTENSION_LANGUAGE_MAP` as a value from
// `@ptah-extension/workspace-intelligence`, which transitively loads
// `vscode-core` → `vscode`. Replace the whole module at the boundary so only
// the symbols our SUT reads are materialized, keeping `vscode` out of the
// graph entirely. Mirrors the stubbing pattern used by
// `code-execution-mcp.service.spec.ts`.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  EXTENSION_LANGUAGE_MAP: {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
  },
  // Service classes are used as types only by the SUT — expose as stubs.
  TreeSitterParserService: class {},
  AstAnalysisService: class {},
}));

import { Result } from '@ptah-extension/shared';
import type {
  AstAnalysisService,
  TreeSitterParserService,
} from '@ptah-extension/workspace-intelligence';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  buildAstNamespace,
  type AstNamespaceDependencies,
} from './ast-namespace.builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParserMock {
  parse: jest.Mock;
  queryFunctions: jest.Mock;
  queryClasses: jest.Mock;
  queryImports: jest.Mock;
  queryExports: jest.Mock;
}

interface AnalysisMock {
  analyzeSource: jest.Mock;
}

interface FsMock {
  readFile: jest.Mock;
}

interface WsMock {
  getWorkspaceRoot: jest.Mock;
}

function createParser(): ParserMock {
  return {
    parse: jest.fn(),
    queryFunctions: jest.fn(),
    queryClasses: jest.fn(),
    queryImports: jest.fn(),
    queryExports: jest.fn(),
  };
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
  const fs: FsMock = { readFile: jest.fn().mockResolvedValue('code') };
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
      file: 'src/a.ts',
      language: 'typescript',
      functions: [{ name: 'f' }],
      classes: [],
      imports: [],
      exports: [],
    });
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
    parser.queryFunctions.mockResolvedValue(
      Result.ok([
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
      ]),
    );

    const out = await buildAstNamespace(deps).queryFunctions('src/a.ts');
    expect(out).toEqual([
      { name: 'myFunc', parameters: ['a', 'b'], startLine: 2, endLine: 7 },
    ]);
  });

  it('queryClasses dedupes by name+startLine and extracts endLine', async () => {
    const { deps, parser } = makeDeps();
    parser.queryClasses.mockResolvedValue(
      Result.ok([
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
      ]),
    );

    const out = await buildAstNamespace(deps).queryClasses('src/a.ts');
    expect(out).toEqual([{ name: 'C', startLine: 1, endLine: 9 }]);
  });

  it('queryImports strips quotes around source and dedupes', async () => {
    const { deps, parser } = makeDeps();
    parser.queryImports.mockResolvedValue(
      Result.ok([
        {
          captures: [
            { name: 'import.source', text: '"lodash"' },
            { name: 'import.default', text: '_' },
          ],
        },
      ]),
    );

    const out = await buildAstNamespace(deps).queryImports('src/a.ts');
    expect(out).toEqual([
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
    parser.queryExports.mockResolvedValue(
      Result.ok([
        {
          captures: [
            { name: 'export.func_name', text: 'doIt' },
            { name: 'export.is_default', text: 'default' },
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
    parser.queryFunctions.mockResolvedValue(Result.err(new Error('bad')));
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
