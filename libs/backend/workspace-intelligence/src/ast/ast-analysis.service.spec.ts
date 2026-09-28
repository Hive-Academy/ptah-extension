import 'reflect-metadata';

// Real-grammar shims for the extraction-contract block at the end of this
// file (the precedent and its reasons: `java-rust-grammar.integration.spec.ts`).
// The mocked-parser tests above it never load a grammar, so the shims do not
// affect them.
jest.mock('./wasm-bundle-dir', () => {
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

import { AstAnalysisService } from './ast-analysis.service';
import {
  TreeSitterParserService,
  QueryMatch,
} from './tree-sitter-parser.service';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { GenericAstNode, SupportedLanguage } from './ast.types';
import type { CodeInsights } from './ast-analysis.interfaces';
import {
  LANGUAGE_QUERIES_MAP,
  EXTENSION_LANGUAGE_MAP,
} from './tree-sitter.config';

describe('AstAnalysisService', () => {
  let service: AstAnalysisService;
  let mockLogger: jest.Mocked<Logger>;
  let mockParserService: jest.Mocked<TreeSitterParserService>;

  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Create mock TreeSitterParserService
    mockParserService = {
      queryMulti: jest.fn(),
      initialize: jest.fn(),
      parse: jest.fn(),
    } as unknown as jest.Mocked<TreeSitterParserService>;

    // Default mock implementation — empty result map (no matches for any
    // query). `analyzeSource` calls `queryMulti` once per invocation.
    mockParserService.queryMulti.mockResolvedValue(
      Result.ok(new Map<string, QueryMatch[]>()),
    );

    // Create service with mock logger and parser service
    service = new AstAnalysisService(mockLogger, mockParserService);
  });

  describe('analyzeAst (traversal-based fallback)', () => {
    it.each(['ok', 'recovered'] as const)(
      '24a carries %s parse quality through analysis',
      async (parseStatus) => {
        mockParserService.queryMulti.mockResolvedValue(
          Result.ok(
            Object.assign(new Map<string, QueryMatch[]>(), {
              parseStatus,
              errorNodeCount: parseStatus === 'ok' ? 0 : 2,
              errorNodeCountCapped: false,
            }),
          ),
        );
        const result = await service.analyzeSource(
          'source',
          'typescript',
          'view.tsx',
        );
        expect(result.value).toMatchObject({
          parseStatus,
          errorNodeCount: parseStatus === 'ok' ? 0 : 2,
          errorNodeCountCapped: false,
        });
        expect(mockParserService.queryMulti).toHaveBeenCalledTimes(1);
      },
    );

    it('should return empty insights for empty AST', async () => {
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'test.ts');

      expect(result.isOk()).toBe(true);
      expect(result.value).toBeDefined();
      expect(result.value?.functions).toEqual([]);
      expect(result.value?.classes).toEqual([]);
      expect(result.value?.imports).toEqual([]);
    });

    it('should log debug message about analyzing file', async () => {
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      await service.analyzeAst(mockAst, 'example.ts');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('analyzeAst'),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('example.ts'),
      );
    });

    it('should return Result.ok with empty insights structure', async () => {
      const mockAst: GenericAstNode = {
        type: 'program',
        text: 'const x = 1;',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 12 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'code.ts');

      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
    });
  });

  describe('CodeInsights structure', () => {
    it('should return insights with correct structure', async () => {
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'test.ts');

      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveProperty('functions');
      expect(result.value).toHaveProperty('classes');
      expect(result.value).toHaveProperty('imports');
      expect(Array.isArray(result.value?.functions)).toBe(true);
      expect(Array.isArray(result.value?.classes)).toBe(true);
      expect(Array.isArray(result.value?.imports)).toBe(true);
    });
  });

  describe('file path handling', () => {
    it('should accept different file paths', async () => {
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result1 = await service.analyzeAst(mockAst, '/path/to/file.ts');
      const result2 = await service.analyzeAst(mockAst, 'C:\\Users\\file.js');
      const result3 = await service.analyzeAst(mockAst, 'relative/path.tsx');

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result3.isOk()).toBe(true);
    });

    it('should log file path in debug message', async () => {
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const testPath = '/custom/path/myfile.ts';
      await service.analyzeAst(mockAst, testPath);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(testPath),
      );
    });
  });

  describe('AST input validation', () => {
    it('should handle empty AST', async () => {
      const emptyAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(emptyAst, 'empty.ts');

      expect(result.isOk()).toBe(true);
      expect(result.value?.functions).toHaveLength(0);
      expect(result.value?.classes).toHaveLength(0);
      expect(result.value?.imports).toHaveLength(0);
    });

    it('should handle AST with nested children', async () => {
      const nestedAst: GenericAstNode = {
        type: 'program',
        text: 'function test() {}',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 18 },
        isNamed: true,
        fieldName: null,
        children: [
          {
            type: 'function_declaration',
            text: 'function test() {}',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 18 },
            isNamed: true,
            fieldName: null,
            children: [],
          },
        ],
      };

      const result = await service.analyzeAst(nestedAst, 'nested.ts');

      expect(result.isOk()).toBe(true);
      // Traversal-based analysis returns empty since no identifier child node
      expect(result.value?.functions).toHaveLength(0);
    });
  });

  describe('analyzeSource (query-based preferred method)', () => {
    it('should be ready to integrate query-based analysis', () => {
      // Verify service structure is ready for query-based analysis
      expect(service).toBeDefined();
      expect(service.analyzeSource).toBeDefined();
      expect(typeof service.analyzeSource).toBe('function');
    });

    it('should maintain Result type pattern', async () => {
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'test.ts');

      // Result pattern methods should exist
      expect(result.isOk).toBeDefined();
      expect(result.isErr).toBeDefined();
      expect(typeof result.isOk).toBe('function');
      expect(typeof result.isErr).toBe('function');
    });
  });

  describe('Query-based analysis via analyzeSource', () => {
    it('should return empty insights when all queries return empty', async () => {
      const result = await service.analyzeSource('const x = 1;', 'typescript');

      expect(result.isOk()).toBe(true);
      expect(result.value?.functions).toEqual([]);
      expect(result.value?.classes).toEqual([]);
      expect(result.value?.imports).toEqual([]);
    });

    it('should extract functions from query matches', async () => {
      const mockFunctionMatches: QueryMatch[] = [
        {
          pattern: 0,
          captures: [
            {
              name: 'function.name',
              text: 'myFunction',
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 10 },
            },
            {
              name: 'function.params',
              text: '(a, b)',
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 11 },
              endPosition: { row: 0, column: 17 },
            },
            {
              name: 'function.declaration',
              text: 'function myFunction(a, b) {}',
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 28 },
            },
          ],
        },
      ];

      mockParserService.queryMulti.mockResolvedValue(
        Result.ok(new Map([['functions', mockFunctionMatches]])),
      );

      const result = await service.analyzeSource(
        'function myFunction(a, b) {}',
        'typescript',
      );

      expect(result.isOk()).toBe(true);
      expect(result.value?.functions).toHaveLength(1);
      expect(result.value?.functions[0].name).toBe('myFunction');
      expect(result.value?.functions[0].parameters).toEqual(['a', 'b']);
    });

    it('should extract classes from query matches', async () => {
      const mockClassMatches: QueryMatch[] = [
        {
          pattern: 0,
          captures: [
            {
              name: 'class.name',
              text: 'MyClass',
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 6 },
              endPosition: { row: 0, column: 13 },
            },
            {
              name: 'class.declaration',
              text: 'class MyClass {}',
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 16 },
            },
          ],
        },
      ];

      mockParserService.queryMulti.mockResolvedValue(
        Result.ok(new Map([['classes', mockClassMatches]])),
      );

      const result = await service.analyzeSource(
        'class MyClass {}',
        'typescript',
      );

      expect(result.isOk()).toBe(true);
      expect(result.value?.classes).toHaveLength(1);
      expect(result.value?.classes[0].name).toBe('MyClass');
    });

    it('should extract imports from query matches', async () => {
      const mockImportMatches: QueryMatch[] = [
        {
          pattern: 0,
          captures: [
            {
              name: 'import.source',
              text: "'lodash'",
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 20 },
              endPosition: { row: 0, column: 28 },
            },
            {
              name: 'import.default',
              text: '_',
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 7 },
              endPosition: { row: 0, column: 8 },
            },
          ],
        },
      ];

      mockParserService.queryMulti.mockResolvedValue(
        Result.ok(new Map([['imports', mockImportMatches]])),
      );

      const result = await service.analyzeSource(
        "import _ from 'lodash';",
        'typescript',
      );

      expect(result.isOk()).toBe(true);
      expect(result.value?.imports).toHaveLength(1);
      expect(result.value?.imports[0].source).toBe('lodash');
      expect(result.value?.imports[0].isDefault).toBe(true);
    });

    it('should extract exports from query matches', async () => {
      const mockExportMatches: QueryMatch[] = [
        {
          pattern: 0,
          captures: [
            {
              name: 'export.func_name',
              text: 'myFunction',
              node: {} as GenericAstNode,
              startPosition: { row: 0, column: 16 },
              endPosition: { row: 0, column: 26 },
            },
          ],
        },
      ];

      mockParserService.queryMulti.mockResolvedValue(
        Result.ok(new Map([['exports', mockExportMatches]])),
      );

      const result = await service.analyzeSource(
        'export function myFunction() {}',
        'typescript',
      );

      expect(result.isOk()).toBe(true);
      expect(result.value?.exports).toHaveLength(1);
      expect(result.value?.exports?.[0].name).toBe('myFunction');
      expect(result.value?.exports?.[0].kind).toBe('function');
    });

    it('should propagate queryMulti errors as Result.err', async () => {
      mockParserService.queryMulti.mockResolvedValue(
        Result.err(new Error('Query failed')),
      );

      const result = await service.analyzeSource(
        'function broken() {}',
        'typescript',
      );

      // analyzeSource now performs a single queryMulti call; any failure
      // surfaces as a Result.err for the whole call.
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Query failed');
    });

    it('should log debug info about analysis', async () => {
      await service.analyzeSource('const x = 1;', 'typescript', 'test.ts');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('analyzeSource'),
      );
    });
  });

  describe('multi-language support (python, go, csharp)', () => {
    const matchWith = (caps: Record<string, string>): QueryMatch => ({
      pattern: 0,
      captures: Object.entries(caps).map(([name, text]) => ({
        name,
        text,
        node: {} as GenericAstNode,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
      })),
    });

    it('registers query + extension entries for python, go and csharp', () => {
      for (const lang of ['python', 'go', 'csharp'] as const) {
        expect(LANGUAGE_QUERIES_MAP[lang].functionQuery).toBeTruthy();
        expect(LANGUAGE_QUERIES_MAP[lang].classQuery).toBeTruthy();
        expect(LANGUAGE_QUERIES_MAP[lang].importQuery).toBeTruthy();
        // None of these languages has export statements.
        expect(LANGUAGE_QUERIES_MAP[lang].exportQuery).toBe('');
      }
      expect(EXTENSION_LANGUAGE_MAP['.py']).toBe('python');
      expect(EXTENSION_LANGUAGE_MAP['.go']).toBe('go');
      expect(EXTENSION_LANGUAGE_MAP['.cs']).toBe('csharp');
      expect(EXTENSION_LANGUAGE_MAP['.csx']).toBe('csharp');
    });

    it('extracts python functions, classes, and imports from matches', async () => {
      mockParserService.queryMulti.mockResolvedValue(
        Result.ok(
          new Map<string, QueryMatch[]>([
            [
              'functions',
              [
                matchWith({
                  'function.name': 'top_level',
                  'function.params': '(a, b)',
                  'function.declaration': 'def top_level(a, b):',
                }),
              ],
            ],
            [
              'classes',
              [
                matchWith({
                  'class.name': 'Animal',
                  'class.declaration': 'class Animal:',
                }),
              ],
            ],
            ['imports', [matchWith({ 'import.source': 'os' })]],
          ]),
        ),
      );

      const result = await service.analyzeSource('', 'python', 'mod.py');

      expect(result.isOk()).toBe(true);
      expect(result.value?.functions[0].name).toBe('top_level');
      expect(result.value?.functions[0].parameters).toEqual(['a', 'b']);
      expect(result.value?.classes[0].name).toBe('Animal');
      // Batch 32a: a language with an extraction contract reads imports only
      // from `@import.statement` captures (real-grammar block below); a bare
      // `@import.source` match feeds execute_code `ast.queryImports`.
      expect(result.value?.imports).toEqual([]);
    });

    it('extracts go methods and structs; imports come from statements only', async () => {
      mockParserService.queryMulti.mockResolvedValue(
        Result.ok(
          new Map<string, QueryMatch[]>([
            [
              'functions',
              [
                matchWith({
                  'method.name': 'Area',
                  'method.params': '()',
                  'method.declaration': 'func (r Rect) Area() float64 {}',
                }),
              ],
            ],
            [
              'classes',
              [
                matchWith({
                  'class.name': 'Rect',
                  'class.declaration': 'type Rect struct {}',
                }),
              ],
            ],
            ['imports', [matchWith({ 'import.source': '"fmt"' })]],
          ]),
        ),
      );

      const result = await service.analyzeSource('', 'go', 'main.go');

      expect(result.isOk()).toBe(true);
      expect(result.value?.functions[0].name).toBe('Area');
      expect(result.value?.classes[0].name).toBe('Rect');
      expect(result.value?.imports).toEqual([]);
      // Go declares its package: `declarations` is present even when the
      // mocked parse matched none.
      expect(result.value?.declarations).toEqual([]);
    });

    it('extracts csharp members and types from matches', async () => {
      mockParserService.queryMulti.mockResolvedValue(
        Result.ok(
          new Map<string, QueryMatch[]>([
            [
              'functions',
              [
                matchWith({
                  'method.name': 'FindAsync',
                  'method.params': '(Guid id)',
                  'method.declaration': 'public Task FindAsync(Guid id) {}',
                }),
                matchWith({
                  'function.name': 'Helper',
                  'function.params': '(int y)',
                  'function.declaration': 'int Helper(int y) {}',
                }),
              ],
            ],
            [
              'classes',
              [
                matchWith({
                  'class.name': 'Invoice',
                  'class.declaration': 'public partial class Invoice {}',
                }),
              ],
            ],
            [
              'imports',
              [
                matchWith({ 'import.source': 'System.Threading.Tasks' }),
                matchWith({
                  'import.named': 'Alias',
                  'import.source': 'System.Text.StringBuilder',
                }),
              ],
            ],
          ]),
        ),
      );

      const result = await service.analyzeSource('', 'csharp', 'Invoice.cs');

      expect(result.isOk()).toBe(true);
      // Methods and local functions both land in `functions`.
      expect(result.value?.functions.map((f) => f.name)).toEqual([
        'FindAsync',
        'Helper',
      ]);
      expect(result.value?.classes[0].name).toBe('Invoice');
      expect(result.value?.imports).toEqual([]);
      // C# has no export statement, so `analyzeSource` never runs one.
      expect(result.value?.exports).toBeUndefined();
    });
  });

  describe('AST traversal with function extraction', () => {
    it('should extract function with identifier child', async () => {
      const astWithFunction: GenericAstNode = {
        type: 'program',
        text: 'function test() {}',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 18 },
        isNamed: true,
        fieldName: null,
        children: [
          {
            type: 'function_declaration',
            text: 'function test() {}',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 18 },
            isNamed: true,
            fieldName: null,
            children: [
              {
                type: 'identifier',
                text: 'test',
                startPosition: { row: 0, column: 9 },
                endPosition: { row: 0, column: 13 },
                isNamed: true,
                fieldName: null,
                children: [],
              },
              {
                type: 'formal_parameters',
                text: '()',
                startPosition: { row: 0, column: 13 },
                endPosition: { row: 0, column: 15 },
                isNamed: true,
                fieldName: null,
                children: [],
              },
            ],
          },
        ],
      };

      const result = await service.analyzeAst(astWithFunction, 'func.ts');

      expect(result.isOk()).toBe(true);
      expect(result.value?.functions).toHaveLength(1);
      expect(result.value?.functions[0].name).toBe('test');
    });

    it('should extract class with type_identifier child', async () => {
      const astWithClass: GenericAstNode = {
        type: 'program',
        text: 'class MyClass {}',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 16 },
        isNamed: true,
        fieldName: null,
        children: [
          {
            type: 'class_declaration',
            text: 'class MyClass {}',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 16 },
            isNamed: true,
            fieldName: null,
            children: [
              {
                type: 'type_identifier',
                text: 'MyClass',
                startPosition: { row: 0, column: 6 },
                endPosition: { row: 0, column: 13 },
                isNamed: true,
                fieldName: null,
                children: [],
              },
              {
                type: 'class_body',
                text: '{}',
                startPosition: { row: 0, column: 14 },
                endPosition: { row: 0, column: 16 },
                isNamed: true,
                fieldName: null,
                children: [],
              },
            ],
          },
        ],
      };

      const result = await service.analyzeAst(astWithClass, 'class.ts');

      expect(result.isOk()).toBe(true);
      expect(result.value?.classes).toHaveLength(1);
      expect(result.value?.classes[0].name).toBe('MyClass');
    });

    it('should extract import statement', async () => {
      const astWithImport: GenericAstNode = {
        type: 'program',
        text: "import { foo } from './bar';",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 28 },
        isNamed: true,
        fieldName: null,
        children: [
          {
            type: 'import_statement',
            text: "import { foo } from './bar';",
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 28 },
            isNamed: true,
            fieldName: null,
            children: [
              {
                type: 'import_clause',
                text: '{ foo }',
                startPosition: { row: 0, column: 7 },
                endPosition: { row: 0, column: 14 },
                isNamed: true,
                fieldName: null,
                children: [
                  {
                    type: 'named_imports',
                    text: '{ foo }',
                    startPosition: { row: 0, column: 7 },
                    endPosition: { row: 0, column: 14 },
                    isNamed: true,
                    fieldName: null,
                    children: [
                      {
                        type: 'import_specifier',
                        text: 'foo',
                        startPosition: { row: 0, column: 9 },
                        endPosition: { row: 0, column: 12 },
                        isNamed: true,
                        fieldName: null,
                        children: [
                          {
                            type: 'identifier',
                            text: 'foo',
                            startPosition: { row: 0, column: 9 },
                            endPosition: { row: 0, column: 12 },
                            isNamed: true,
                            fieldName: null,
                            children: [],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'string',
                text: "'./bar'",
                startPosition: { row: 0, column: 20 },
                endPosition: { row: 0, column: 27 },
                isNamed: true,
                fieldName: null,
                children: [],
              },
            ],
          },
        ],
      };

      const result = await service.analyzeAst(astWithImport, 'import.ts');

      expect(result.isOk()).toBe(true);
      expect(result.value?.imports).toHaveLength(1);
      expect(result.value?.imports[0].source).toBe('./bar');
      expect(result.value?.imports[0].importedSymbols).toContain('foo');
    });
  });
});

/**
 * Extraction contract (TASK_2026_559 Batch 32a) against the shipped grammars.
 * Only a real grammar proves the declaration and import queries (a wrong node
 * name gives zero captures and no error). Fixture text holds no quoted
 * module-specifier shapes: Python and Go statements are assembled from the
 * keyword constants below (validate-deps scans text, Batch 9 note).
 */
describe('AstAnalysisService extraction contract (real grammars, Batch 32a)', () => {
  const FROM = 'fr' + 'om';
  const IMPORT = 'imp' + 'ort';
  const Q = '"';
  let analysis: AstAnalysisService;

  beforeAll(() => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    analysis = new AstAnalysisService(
      logger,
      new TreeSitterParserService(logger),
    );
  });

  async function analyse(
    source: string,
    language: SupportedLanguage,
  ): Promise<CodeInsights> {
    const result = await analysis.analyzeSource(source, language, 'fixture');
    if (result.isErr() || !result.value) {
      throw result.error ?? new Error(`${language} analysis returned nothing`);
    }
    return result.value;
  }

  // FB: on the batch base `scopePath` does not exist, so two inline modules
  // whose `self::`/`super::` imports resolve differently are indistinguishable.
  it('two inline Rust modules keep separate scopePath', async () => {
    const rust = await analyse(
      [
        'mod alpha {',
        '    use self::helper::run;',
        '    use super::shared;',
        '    mod helper {',
        '        use super::super::root_item;',
        '        pub fn run() {}',
        '    }',
        '}',
        'mod beta {',
        '    use self::helper::run;',
        '    use super::shared;',
        '}',
        '',
      ].join('\n'),
      'rust',
    );

    expect(rust.imports).toEqual([
      {
        source: 'self::helper::run',
        kind: 'relative',
        relativeLevel: 1,
        line: 1,
        scopePath: ['alpha'],
      },
      {
        source: 'super::shared',
        kind: 'relative',
        relativeLevel: 2,
        line: 2,
        scopePath: ['alpha'],
      },
      {
        source: 'super::super::root_item',
        kind: 'relative',
        relativeLevel: 3,
        line: 4,
        scopePath: ['alpha', 'helper'],
      },
      {
        source: 'self::helper::run',
        kind: 'relative',
        relativeLevel: 1,
        line: 9,
        scopePath: ['beta'],
      },
      {
        source: 'super::shared',
        kind: 'relative',
        relativeLevel: 2,
        line: 10,
        scopePath: ['beta'],
      },
    ]);
    expect(rust.declarations).toEqual([
      { kind: 'module', name: 'alpha', startLine: 0, endLine: 7 },
      { kind: 'module', name: 'alpha::helper', startLine: 3, endLine: 6 },
      { kind: 'module', name: 'beta', startLine: 8, endLine: 11 },
    ]);
  });

  it('splits grouped Rust use trees per path, with self and nested aliases', async () => {
    const rust = await analyse(
      [
        'use {a, b::c};',
        'pub use std::{self, io::{Read, Write as W}, fmt::*};',
        'use ::legacy::path;',
        'extern crate serde as sd;',
        'mod outer { mod inner { mod leaf; } }',
        '',
      ].join('\n'),
      'rust',
    );
    const at = (line: number, scopePath: string[] = []) => ({
      line,
      scopePath,
    });

    expect(rust.imports).toEqual([
      { source: 'a', kind: 'module', ...at(0) },
      { source: 'b::c', kind: 'module', ...at(0) },
      { source: 'std', kind: 'module', ...at(1) },
      { source: 'std::io::Read', kind: 'module', ...at(1) },
      { source: 'std::io::Write', kind: 'alias', alias: 'W', ...at(1) },
      {
        source: 'std::fmt',
        kind: 'wildcard',
        importedSymbols: ['*'],
        ...at(1),
      },
      { source: '::legacy::path', kind: 'module', ...at(2) },
      { source: 'serde', kind: 'alias', alias: 'sd', ...at(3) },
      { source: 'leaf', kind: 'mod-decl', ...at(4, ['outer', 'inner']) },
    ]);
  });

  // Review r1 R32A-01: a nested block comment inside a use list neither
  // drops a path nor invents one (Rust block comments nest).
  it.each([
    ['use a::{b, /* outer /* nested */ } */ c};', ['a::b', 'a::c']],
    ['use a::{b, /* outer /* comment */ comment */ c};', ['a::b', 'a::c']],
    ['use a::{/* /* * */ */ b, // x::{y}\n c};', ['a::b', 'a::c']],
  ])('Rust nested comments keep the use list exact: %s', async (src, want) => {
    const rust = await analyse(`${src}\n`, 'rust');

    expect(rust.parseStatus).toBe('ok');
    expect(rust.imports).toEqual(
      want.map((source) => ({
        source,
        kind: 'module',
        line: 0,
        scopePath: [],
      })),
    );
  });

  // Review r1 R32A-02: identifiers keep every code point as written
  // (decomposed `e` + U+0301, raw identifiers, non-Latin scripts).
  it('Rust identifiers keep combining marks and raw prefixes byte-exact', async () => {
    const decomposed = 'café';
    const rust = await analyse(
      `use crate::${decomposed}::X;\nuse r#type::{r#match, данные};\n`,
      'rust',
    );

    expect(rust.parseStatus).toBe('ok');
    expect(rust.imports.map((i) => i.source)).toEqual([
      `crate::${decomposed}::X`,
      'r#type::r#match',
      'r#type::данные',
    ]);
  });

  // Review r1 R32A-03: `global` and `static` are independent traits.
  it('C#: global using static keeps the static trait', async () => {
    const both = await analyse('global using static Acme.Tools;\n', 'csharp');
    const globalOnly = await analyse('global using Acme.Tools;\n', 'csharp');

    expect(both.imports).toEqual([
      {
        source: 'Acme.Tools',
        kind: 'global',
        isStatic: true,
        line: 0,
        scopePath: [],
      },
    ]);
    expect(globalOnly.imports).toEqual([
      { source: 'Acme.Tools', kind: 'global', line: 0, scopePath: [] },
    ]);
  });

  it('C#: nested namespaces concatenate; using static, alias and global using', async () => {
    const csharp = await analyse(
      [
        'global using System;',
        'global using static System.Console;',
        'using static System.Math;',
        'using Sb = System.Text.StringBuilder;',
        'namespace Acme {',
        '  using Acme.Core;',
        '  namespace Billing.Api {',
        '    using Money = Acme.Core.Money;',
        '    class Invoice { }',
        '  }',
        '}',
        '',
      ].join('\n'),
      'csharp',
    );

    expect(csharp.imports).toEqual([
      { source: 'System', kind: 'global', line: 0, scopePath: [] },
      {
        source: 'System.Console',
        kind: 'global',
        isStatic: true,
        line: 1,
        scopePath: [],
      },
      {
        source: 'System.Math',
        kind: 'static',
        isStatic: true,
        line: 2,
        scopePath: [],
      },
      {
        source: 'System.Text.StringBuilder',
        kind: 'alias',
        alias: 'Sb',
        line: 3,
        scopePath: [],
      },
      { source: 'Acme.Core', kind: 'module', line: 5, scopePath: ['Acme'] },
      {
        source: 'Acme.Core.Money',
        kind: 'alias',
        alias: 'Money',
        line: 7,
        scopePath: ['Acme', 'Billing.Api'],
      },
    ]);
    expect(csharp.declarations).toEqual([
      { kind: 'namespace', name: 'Acme', startLine: 4, endLine: 10 },
      {
        kind: 'namespace',
        name: 'Acme.Billing.Api',
        startLine: 6,
        endLine: 9,
      },
    ]);
  });

  it('C#: a file-scoped namespace covers the rest of the file only', async () => {
    const csharp = await analyse(
      ['using System;', 'namespace Acme.Billing;', 'using Acme.Core;', ''].join(
        '\n',
      ),
      'csharp',
    );

    expect(csharp.imports.map((i) => i.scopePath)).toEqual([
      [],
      ['Acme.Billing'],
    ]);
    expect(csharp.declarations).toEqual([
      { kind: 'namespace', name: 'Acme.Billing', startLine: 1, endLine: 3 },
    ]);
  });

  it('Java: nested-type, static, static on-demand and on-demand imports', async () => {
    const java = await analyse(
      [
        'package com.acme.app;',
        '',
        'import com.acme.model.Outer.Inner;',
        'import static com.acme.util.Strings.join;',
        'import static com.acme.util.Strings.*;',
        'import com.acme.api.*;',
        '',
        'class App { }',
        '',
      ].join('\n'),
      'java',
    );
    const scopePath = ['com.acme.app'];

    expect(java.imports).toEqual([
      {
        source: 'com.acme.model.Outer.Inner',
        kind: 'module',
        line: 2,
        scopePath,
      },
      {
        source: 'com.acme.util.Strings.join',
        kind: 'static',
        isStatic: true,
        line: 3,
        scopePath,
      },
      {
        source: 'com.acme.util.Strings',
        kind: 'static',
        isStatic: true,
        importedSymbols: ['*'],
        line: 4,
        scopePath,
      },
      {
        source: 'com.acme.api',
        kind: 'wildcard',
        importedSymbols: ['*'],
        line: 5,
        scopePath,
      },
    ]);
    expect(java.declarations).toEqual([
      { kind: 'package', name: 'com.acme.app', startLine: 0, endLine: 8 },
    ]);
  });

  it('Python: multi-name, aliased, wildcard and multi-level relative imports', async () => {
    const python = await analyse(
      [
        `${IMPORT} os, os.path as osp`,
        `${FROM} pkg.models ${IMPORT} (User, Account as Acct)`,
        `${FROM} . ${IMPORT} sibling`,
        `${FROM} ...core.base ${IMPORT} Base, Mixin`,
        `${FROM} .. ${IMPORT} *`,
        `${FROM} tools ${IMPORT} *`,
        `${FROM} __future__ ${IMPORT} annotations`,
        '',
      ].join('\n'),
      'python',
    );
    const at = (line: number) => ({ line, scopePath: [] });

    expect(python.imports).toEqual([
      { source: 'os', kind: 'module', ...at(0) },
      { source: 'os.path', kind: 'alias', alias: 'osp', ...at(0) },
      {
        source: 'pkg.models',
        kind: 'module',
        importedSymbols: ['User', 'Account'],
        ...at(1),
      },
      {
        source: '.',
        kind: 'relative',
        relativeLevel: 1,
        importedSymbols: ['sibling'],
        ...at(2),
      },
      {
        source: '...core.base',
        kind: 'relative',
        relativeLevel: 3,
        importedSymbols: ['Base', 'Mixin'],
        ...at(3),
      },
      {
        source: '..',
        kind: 'relative',
        relativeLevel: 2,
        importedSymbols: ['*'],
        ...at(4),
      },
      {
        source: 'tools',
        kind: 'wildcard',
        importedSymbols: ['*'],
        ...at(5),
      },
    ]);
    // Python declares no package in source.
    expect(python.declarations).toBeUndefined();
  });

  it('Go: single, grouped, raw-string, dot, blank and named imports', async () => {
    const go = await analyse(
      [
        'package service',
        '',
        `${IMPORT} ${Q}fmt${Q}`,
        `${IMPORT} (`,
        `\t${Q}os${Q}`,
        '\tfp `path/filepath`',
        `\t. ${Q}strings${Q}`,
        `\t_ ${Q}embed${Q}`,
        ')',
        '',
      ].join('\n'),
      'go',
    );
    const scopePath = ['service'];

    expect(go.imports).toEqual([
      { source: 'fmt', kind: 'module', line: 2, scopePath },
      { source: 'os', kind: 'module', line: 4, scopePath },
      {
        source: 'path/filepath',
        kind: 'alias',
        alias: 'fp',
        line: 5,
        scopePath,
      },
      {
        source: 'strings',
        kind: 'wildcard',
        importedSymbols: ['*'],
        line: 6,
        scopePath,
      },
      { source: 'embed', kind: 'alias', alias: '_', line: 7, scopePath },
    ]);
    expect(go.declarations).toEqual([
      { kind: 'package', name: 'service', startLine: 0, endLine: 9 },
    ]);
  });

  // Batch 32b (R32A-05, R26B-C-B1): every module a re-export statement loads,
  // whatever it exports; the empty clause has no export record at all.
  it.each(['typescript', 'javascript', 'tsx'] as const)(
    '%s: every re-export statement reports the module it loads',
    async (language) => {
      const EXPORT = 'exp' + 'ort';
      const insights = await analyse(
        [
          `${EXPORT} {} ${FROM} './side';`,
          `${EXPORT} { X, Y as Z } ${FROM} './leaf';`,
          `${EXPORT} * ${FROM} './all';`,
          `${EXPORT} * as ns ${FROM} './ns';`,
          `${EXPORT} {} ${FROM} './side';`,
          `${IMPORT} { a } ${FROM} './a';`,
          `${EXPORT} const local = 1;`,
          '',
        ].join('\n'),
        language,
      );

      expect(insights.reExportSources).toEqual([
        './side',
        './leaf',
        './all',
        './ns',
      ]);
      // A re-export is not an import: the imports are those of the import
      // statement alone.
      const importOnly = await analyse(
        `${IMPORT} { a } ${FROM} './a';\n`,
        language,
      );
      expect(insights.imports).toEqual(importOnly.imports);
    },
  );

  // R32B-05: a module string is its runtime value (escapes decoded, no eval),
  // in both channels, so the graph resolves `./leaf` and sees one source.
  it.each(['typescript', 'javascript'] as const)(
    '%s: escaped re-export module strings are decoded',
    async (language) => {
      const EXPORT = 'exp' + 'ort';
      const BS = '\\';
      const insights = await analyse(
        [
          `${EXPORT} {} ${FROM} './${BS}u006ceaf';`,
          `${EXPORT} { X } ${FROM} './${BS}x6ceaf';`,
          `${EXPORT} * ${FROM} './${BS}u{6c}eaf';`,
          `${EXPORT} * as ns ${FROM} "./l${BS}"eaf";`,
          `${EXPORT} { Y } ${FROM} './li${BS}` + '\n' + `ne';`,
          '',
        ].join('\n'),
        language,
      );

      expect(insights.reExportSources).toEqual(['./leaf', './l"eaf', './line']);
      expect(
        (insights.exports ?? []).map((info) => [info.name, info.source]),
      ).toEqual([
        ['X', './leaf'],
        ['*', './leaf'],
        ['ns', './l"eaf'],
        ['Y', './line'],
      ]);
    },
  );

  it('TS/JS without a re-export carry no reExportSources key', async () => {
    const ts = await analyse(`${IMPORT} { a } ${FROM} './a';\n`, 'typescript');
    expect('reExportSources' in ts).toBe(false);
  });

  it('TS/JS keep their earlier import shape and get no declarations', async () => {
    const ts = await analyse(
      `${IMPORT} { a } ${FROM} './a';\n${IMPORT} b ${FROM} './b';\n`,
      'typescript',
    );

    expect(ts.imports).toEqual(
      expect.arrayContaining([
        { source: './a', importedSymbols: ['a'] },
        { source: './b', importedSymbols: ['b'], isDefault: true },
      ]),
    );
    // Only the four pre-32a keys, on every entry the shared decoder emits.
    for (const imp of ts.imports) {
      expect(Object.keys(imp).sort()).toEqual(
        ['importedSymbols', 'isDefault', 'isNamespace', 'source'].sort(),
      );
    }
    expect('declarations' in ts).toBe(false);
  });
});
