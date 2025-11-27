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

  describe('LLM Integration (Phase 3 - NOT YET IMPLEMENTED)', () => {
    /**
     * IMPORTANT: These tests document planned LLM integration for Phase 3.
     * Current implementation is a stub that returns empty insights.
     *
     * Phase 3 Implementation Plan:
     * 1. Inject ILlmService via constructor
     * 2. Condense AST using _condenseAst() method
     * 3. Call llmService.getStructuredCompletion() with condensed AST
     * 4. Parse response using Zod schema validation
     * 5. Return CodeInsights or handle LlmProviderError
     */

    it('TODO Phase 3: should use LLM to analyze function complexity', async () => {
      // This test is a placeholder for future LLM integration
      const mockAst: GenericAstNode = {
        type: 'function_declaration',
        text: 'function complex() { for(let i=0;i<10;i++) { console.log(i); } }',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 5, column: 1 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'complex.ts');

      // Current stub behavior: returns empty insights
      expect(result.isOk()).toBe(true);
      expect(result.value?.functions).toEqual([]);
      expect(result.value?.classes).toEqual([]);
      expect(result.value?.imports).toEqual([]);

      // Verify stub warning is logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Phase 2 stub')
      );

      // TODO Phase 3: When LLM is integrated, expect:
      // - result.value.functions to contain extracted function insights
      // - LLM service to have been called with condensed AST
      // - Zod schema validation to pass
    });

    it('TODO Phase 3: should handle LLM errors gracefully', async () => {
      // This test is a placeholder for future LLM error handling
      const mockAst: GenericAstNode = {
        type: 'program',
        text: 'const x = 1;',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 1 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'simple.ts');

      // Current stub behavior: always succeeds with empty insights
      expect(result.isOk()).toBe(true);

      // TODO Phase 3: When LLM is integrated, mock LLM failure:
      // - mockLlmService.getStructuredCompletion.mockResolvedValue(Result.err(new LlmProviderError()))
      // - Expect service to handle error gracefully
      // - Expect Result.err() with descriptive error message
      // - Expect error to be logged
    });

    it('TODO Phase 3: should validate LLM response with Zod schema', async () => {
      // This test is a placeholder for Zod schema validation
      const mockAst: GenericAstNode = {
        type: 'class_declaration',
        text: 'class Calculator { add(a, b) { return a + b; } }',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 3, column: 1 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'calculator.ts');

      // Current stub behavior
      expect(result.isOk()).toBe(true);
      expect(result.value?.classes).toEqual([]);

      // TODO Phase 3: When LLM is integrated:
      // - Mock LLM to return invalid schema
      // - Expect Zod validation to fail
      // - Expect Result.err() with validation error
      // - Expect error to contain schema mismatch details
    });

    it('TODO Phase 3: should extract imports from condensed AST via LLM', async () => {
      // This test is a placeholder for import extraction
      const mockAst: GenericAstNode = {
        type: 'program',
        text: "import { Component } from '@angular/core';",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'component.ts');

      // Current stub behavior
      expect(result.isOk()).toBe(true);
      expect(result.value?.imports).toEqual([]);

      // TODO Phase 3: When LLM is integrated:
      // - Expect result.value.imports to contain:
      //   [{ source: '@angular/core' }]
      // - Verify LLM was called with condensed import node
    });

    it('should document current Phase 2 stub behavior', async () => {
      // This test verifies the current stub implementation
      const mockAst: GenericAstNode = {
        type: 'program',
        text: `
          class User {
            constructor(name) { this.name = name; }
            greet() { return 'Hello ' + this.name; }
          }

          function createUser(name) {
            return new User(name);
          }

          import { Logger } from './logger';
        `,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 12, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const result = await service.analyzeAst(mockAst, 'user.ts');

      // Current Phase 2 stub: Always returns empty insights
      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual({
        functions: [],
        classes: [],
        imports: [],
      });

      // Verifies stub warning is logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Phase 2 stub')
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('TODO Phase 3')
      );

      // Phase 3 Expectation: Would extract:
      // - functions: [{ name: 'createUser', parameters: ['name'] }]
      // - classes: [{ name: 'User' }]
      // - imports: [{ source: './logger' }]
    });
  });
});
