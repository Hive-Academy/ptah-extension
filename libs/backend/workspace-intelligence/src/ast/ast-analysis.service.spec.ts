import 'reflect-metadata';
import { AstAnalysisService } from './ast-analysis.service';
import { Logger } from '@ptah-extension/vscode-core';
import { GenericAstNode } from './ast.types';

describe('AstAnalysisService', () => {
  let service: AstAnalysisService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as any;

    // Create service with mock logger
    service = new AstAnalysisService(mockLogger);
  });

  describe('Phase 2 stub implementation', () => {
    it('should return empty insights', async () => {
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
      expect(result.value!.functions).toEqual([]);
      expect(result.value!.classes).toEqual([]);
      expect(result.value!.imports).toEqual([]);
    });

    it('should log warning about Phase 2 stub', async () => {
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

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Phase 2 stub')
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('TODO Phase 3')
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
      expect(Array.isArray(result.value!.functions)).toBe(true);
      expect(Array.isArray(result.value!.classes)).toBe(true);
      expect(Array.isArray(result.value!.imports)).toBe(true);
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

    it('should log file path in warning message', async () => {
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

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(testPath)
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
      expect(result.value!.functions).toHaveLength(0);
      expect(result.value!.classes).toHaveLength(0);
      expect(result.value!.imports).toHaveLength(0);
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
      // Phase 2 stub still returns empty arrays
      expect(result.value!.functions).toHaveLength(0);
    });
  });

  describe('Phase 3 preparation', () => {
    it('should be ready to integrate LLM service', () => {
      // Verify service structure is ready for Phase 3 LLM integration
      expect(service).toBeDefined();
      expect(service.analyzeAst).toBeDefined();
      expect(typeof service.analyzeAst).toBe('function');
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
});
