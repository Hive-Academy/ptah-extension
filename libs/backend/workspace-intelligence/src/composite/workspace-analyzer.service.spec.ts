import 'reflect-metadata';
import { WorkspaceAnalyzerService } from './workspace-analyzer.service';
import { FileSystemService } from '../services/file-system.service';
import { ProjectDetectorService } from '../project-analysis/project-detector.service';
import { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { ContextService } from '../context/context.service';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { GenericAstNode } from '../ast/ast.types';
import { CodeInsights } from '../ast/ast-analysis.interfaces';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as vscode from 'vscode';

// Mock VS Code API
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: undefined,
    onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  },
}));

describe('WorkspaceAnalyzerService - AST Integration', () => {
  let service: WorkspaceAnalyzerService;
  let mockFileSystem: jest.Mocked<FileSystemService>;
  let mockProjectDetector: jest.Mocked<ProjectDetectorService>;
  let mockFrameworkDetector: jest.Mocked<FrameworkDetectorService>;
  let mockDependencyAnalyzer: jest.Mocked<DependencyAnalyzerService>;
  let mockWorkspaceService: jest.Mocked<WorkspaceService>;
  let mockContextService: jest.Mocked<ContextService>;
  let mockIndexer: jest.Mocked<WorkspaceIndexerService>;
  let mockTreeSitterParser: jest.Mocked<TreeSitterParserService>;
  let mockAstAnalyzer: jest.Mocked<AstAnalysisService>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Create mocks for all dependencies
    mockFileSystem = {
      readFile: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    mockProjectDetector = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    mockFrameworkDetector = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    mockDependencyAnalyzer = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    mockWorkspaceService = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    mockContextService = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    mockIndexer = {} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    mockTreeSitterParser = {
      parse: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    mockAstAnalyzer = {
      analyzeAst: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    // Create service with mocked dependencies
    service = new WorkspaceAnalyzerService(
      mockFileSystem,
      mockProjectDetector,
      mockFrameworkDetector,
      mockDependencyAnalyzer,
      mockWorkspaceService,
      mockContextService,
      mockIndexer,
      mockTreeSitterParser,
      mockAstAnalyzer,
      mockLogger
    );
  });

  afterEach(() => {
    service.dispose();
  });

  describe('extractCodeInsights - AST Integration', () => {
    it('should extract code insights from TypeScript file using AST parsing', async () => {
      // Arrange
      const filePath = 'D:\\test\\sample.ts';
      const fileContent = 'function hello() { return "world"; }';

      const mockAst: GenericAstNode = {
        type: 'program',
        text: fileContent,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [
          {
            type: 'function_declaration',
            text: 'function hello() { return "world"; }',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 1, column: 0 },
            isNamed: true,
            fieldName: null,
            children: [],
          },
        ],
      };

      const mockInsights: CodeInsights = {
        functions: [
          {
            name: 'hello',
            parameters: [],
          },
        ],
        classes: [],
        imports: [],
      };

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockTreeSitterParser.parse.mockReturnValue(Result.ok(mockAst));
      mockAstAnalyzer.analyzeAst.mockResolvedValue(Result.ok(mockInsights));

      // Act
      const result = await service.extractCodeInsights(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.functions).toHaveLength(1);
      expect(result?.functions[0].name).toBe('hello');
      expect(result?.functions[0].parameters).toEqual([]);
      expect(result?.classes).toHaveLength(0);
      expect(result?.imports).toHaveLength(0);

      // Verify the integration chain
      expect(mockFileSystem.readFile).toHaveBeenCalled();
      expect(mockTreeSitterParser.parse).toHaveBeenCalledWith(
        fileContent,
        'typescript'
      );
      expect(mockAstAnalyzer.analyzeAst).toHaveBeenCalledWith(
        mockAst,
        filePath
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Extracting code insights')
      );
    });

    it('should detect language from file extension (TypeScript)', async () => {
      // Arrange
      const filePath = 'D:\\test\\component.tsx';
      const fileContent = 'const Component = () => <div>Hello</div>;';
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockTreeSitterParser.parse.mockReturnValue(Result.ok(mockAst));
      mockAstAnalyzer.analyzeAst.mockResolvedValue(
        Result.ok({ functions: [], classes: [], imports: [] })
      );

      // Act
      await service.extractCodeInsights(filePath);

      // Assert
      expect(mockTreeSitterParser.parse).toHaveBeenCalledWith(
        fileContent,
        'typescript'
      );
    });

    it('should detect language from file extension (JavaScript)', async () => {
      // Arrange
      const filePath = 'D:\\test\\script.js';
      const fileContent = 'function test() {}';
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockTreeSitterParser.parse.mockReturnValue(Result.ok(mockAst));
      mockAstAnalyzer.analyzeAst.mockResolvedValue(
        Result.ok({ functions: [], classes: [], imports: [] })
      );

      // Act
      await service.extractCodeInsights(filePath);

      // Assert
      expect(mockTreeSitterParser.parse).toHaveBeenCalledWith(
        fileContent,
        'javascript'
      );
    });

    it('should return null when AST parsing fails', async () => {
      // Arrange
      const filePath = 'D:\\test\\invalid.ts';
      const fileContent = 'invalid syntax {{{';

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockTreeSitterParser.parse.mockReturnValue(
        Result.err(new Error('Parse error: unexpected token'))
      );

      // Act
      const result = await service.extractCodeInsights(filePath);

      // Assert
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AST parsing failed'),
        expect.any(Error)
      );
      expect(mockAstAnalyzer.analyzeAst).not.toHaveBeenCalled();
    });

    it('should return null when AST analysis fails', async () => {
      // Arrange
      const filePath = 'D:\\test\\problematic.ts';
      const fileContent = 'const x = 1;';
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockTreeSitterParser.parse.mockReturnValue(Result.ok(mockAst));
      mockAstAnalyzer.analyzeAst.mockResolvedValue(
        Result.err(new Error('Analysis failed'))
      );

      // Act
      const result = await service.extractCodeInsights(filePath);

      // Assert
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AST analysis failed'),
        expect.any(Error)
      );
    });

    it('should handle file read errors gracefully', async () => {
      // Arrange
      const filePath = 'D:\\test\\nonexistent.ts';

      mockFileSystem.readFile.mockRejectedValue(
        new Error('ENOENT: File not found')
      );

      // Act
      const result = await service.extractCodeInsights(filePath);

      // Assert
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error extracting code insights'),
        expect.any(Error)
      );
      expect(mockTreeSitterParser.parse).not.toHaveBeenCalled();
      expect(mockAstAnalyzer.analyzeAst).not.toHaveBeenCalled();
    });

    it('should extract complex code insights with multiple functions and classes', async () => {
      // Arrange
      const filePath = 'D:\\test\\complex.ts';
      const fileContent = `
        class Calculator {
          add(a: number, b: number): number {
            return a + b;
          }
        }

        function multiply(x: number, y: number): number {
          return x * y;
        }

        import { Component } from '@angular/core';
      `;

      const mockAst: GenericAstNode = {
        type: 'program',
        text: fileContent,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 12, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      const mockInsights: CodeInsights = {
        functions: [
          {
            name: 'multiply',
            parameters: ['x: number', 'y: number'],
          },
        ],
        classes: [
          {
            name: 'Calculator',
          },
        ],
        imports: [
          {
            source: '@angular/core',
          },
        ],
      };

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockTreeSitterParser.parse.mockReturnValue(Result.ok(mockAst));
      mockAstAnalyzer.analyzeAst.mockResolvedValue(Result.ok(mockInsights));

      // Act
      const result = await service.extractCodeInsights(filePath);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.functions).toHaveLength(1);
      expect(result?.classes).toHaveLength(1);
      expect(result?.imports).toHaveLength(1);

      expect(result?.functions[0].name).toBe('multiply');
      expect(result?.functions[0].parameters).toEqual([
        'x: number',
        'y: number',
      ]);
      expect(result?.classes[0].name).toBe('Calculator');
      expect(result?.imports[0].source).toBe('@angular/core');
    });

    it('should log debug messages at each integration step', async () => {
      // Arrange
      const filePath = 'D:\\test\\debug-test.ts';
      const fileContent = 'const x = 1;';
      const mockAst: GenericAstNode = {
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      };

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockTreeSitterParser.parse.mockReturnValue(Result.ok(mockAst));
      mockAstAnalyzer.analyzeAst.mockResolvedValue(
        Result.ok({ functions: [], classes: [], imports: [] })
      );

      // Act
      await service.extractCodeInsights(filePath);

      // Assert
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Extracting code insights')
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('AST parsed successfully')
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Code insights extracted')
      );
    });
  });
});
