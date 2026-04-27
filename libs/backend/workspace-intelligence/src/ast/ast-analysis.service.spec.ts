import 'reflect-metadata';
import { AstAnalysisService } from './ast-analysis.service';
import {
  TreeSitterParserService,
  QueryMatch,
} from './tree-sitter-parser.service';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { GenericAstNode } from './ast.types';

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
      queryFunctions: jest.fn(),
      queryClasses: jest.fn(),
      queryImports: jest.fn(),
      queryExports: jest.fn(),
      initialize: jest.fn(),
      parse: jest.fn(),
    } as unknown as jest.Mocked<TreeSitterParserService>;

    // Default mock implementations - return empty arrays for all queries.
    // Query* methods return Promise<Result<...>>, so use mockResolvedValue.
    mockParserService.queryFunctions.mockResolvedValue(Result.ok([]));
    mockParserService.queryClasses.mockResolvedValue(Result.ok([]));
    mockParserService.queryImports.mockResolvedValue(Result.ok([]));
    mockParserService.queryExports.mockResolvedValue(Result.ok([]));

    // Create service with mock logger and parser service
    service = new AstAnalysisService(mockLogger, mockParserService);
  });

  describe('analyzeAst (traversal-based fallback)', () => {
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

      mockParserService.queryFunctions.mockResolvedValue(
        Result.ok(mockFunctionMatches),
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

      mockParserService.queryClasses.mockResolvedValue(
        Result.ok(mockClassMatches),
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

      mockParserService.queryImports.mockResolvedValue(
        Result.ok(mockImportMatches),
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

      mockParserService.queryExports.mockResolvedValue(
        Result.ok(mockExportMatches),
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

    it('should handle query errors gracefully', async () => {
      mockParserService.queryFunctions.mockResolvedValue(
        Result.err(new Error('Query failed')),
      );

      const result = await service.analyzeSource(
        'function broken() {}',
        'typescript',
      );

      // Should still succeed with empty functions array when query fails
      expect(result.isOk()).toBe(true);
      expect(result.value?.functions).toEqual([]);
    });

    it('should log debug info about analysis', async () => {
      await service.analyzeSource('const x = 1;', 'typescript', 'test.ts');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('analyzeSource'),
      );
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
