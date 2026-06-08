import 'reflect-metadata';
import { WorkspaceAnalyzerService } from './workspace-analyzer.service';
import { FileSystemService } from '../services/file-system.service';
import { ProjectDetectorService } from '../project-analysis/project-detector.service';
import { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { ContextService } from '../context/context.service';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { CodeInsights } from '../ast/ast-analysis.interfaces';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

describe('WorkspaceAnalyzerService - AST Integration', () => {
  let service: WorkspaceAnalyzerService;
  let mockFileSystem: jest.Mocked<FileSystemService>;
  let mockProjectDetector: jest.Mocked<ProjectDetectorService>;
  let mockFrameworkDetector: jest.Mocked<FrameworkDetectorService>;
  let mockDependencyAnalyzer: jest.Mocked<DependencyAnalyzerService>;
  let mockWorkspaceService: jest.Mocked<WorkspaceService>;
  let mockContextService: jest.Mocked<ContextService>;
  let mockIndexer: jest.Mocked<WorkspaceIndexerService>;
  // Suite is .skip'd pending rewrite for analyzeSource() API.
  // Mocks typed as `any` to avoid TS drift noise until tests are re-authored.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTreeSitterParser: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAstAnalyzer: any;
  let mockLogger: jest.Mocked<Logger>;
  let mockWorkspaceProvider: jest.Mocked<IWorkspaceProvider>;

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
      analyzeSource: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    mockWorkspaceProvider = {
      getWorkspaceFolders: jest.fn().mockReturnValue([]),
      getWorkspaceRoot: jest.fn().mockReturnValue(undefined),
      getConfiguration: jest.fn(),
      onDidChangeConfiguration: jest.fn(),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as jest.Mocked<IWorkspaceProvider>;

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
      mockLogger,
      mockWorkspaceProvider,
    );
  });

  afterEach(() => {
    service.dispose();
  });

  describe('extractCodeInsights - AST Integration', () => {
    it('should extract code insights from TypeScript file using query-based AST analysis', async () => {
      // Arrange
      const filePath = 'D:\\test\\sample.ts';
      const fileContent = 'function hello() { return "world"; }';

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
      mockAstAnalyzer.analyzeSource.mockResolvedValue(Result.ok(mockInsights));

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
      expect(mockAstAnalyzer.analyzeSource).toHaveBeenCalledWith(
        fileContent,
        'typescript',
        filePath,
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Extracting code insights'),
      );
    });

    it('should detect language from file extension (TypeScript .tsx)', async () => {
      // Arrange
      const filePath = 'D:\\test\\component.tsx';
      const fileContent = 'const Component = () => <div>Hello</div>;';

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockAstAnalyzer.analyzeSource.mockResolvedValue(
        Result.ok({ functions: [], classes: [], imports: [] }),
      );

      // Act
      await service.extractCodeInsights(filePath);

      // Assert
      expect(mockAstAnalyzer.analyzeSource).toHaveBeenCalledWith(
        fileContent,
        'typescript',
        filePath,
      );
    });

    it('should detect language from file extension (JavaScript)', async () => {
      // Arrange
      const filePath = 'D:\\test\\script.js';
      const fileContent = 'function test() {}';

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockAstAnalyzer.analyzeSource.mockResolvedValue(
        Result.ok({ functions: [], classes: [], imports: [] }),
      );

      // Act
      await service.extractCodeInsights(filePath);

      // Assert
      expect(mockAstAnalyzer.analyzeSource).toHaveBeenCalledWith(
        fileContent,
        'javascript',
        filePath,
      );
    });

    it('should return null when AST analysis fails', async () => {
      // Arrange
      const filePath = 'D:\\test\\problematic.ts';
      const fileContent = 'const x = 1;';

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockAstAnalyzer.analyzeSource.mockResolvedValue(
        Result.err(new Error('Analysis failed')),
      );

      // Act
      const result = await service.extractCodeInsights(filePath);

      // Assert
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('AST analysis failed'),
        expect.any(Error),
      );
    });

    it('should handle file read errors gracefully', async () => {
      // Arrange
      const filePath = 'D:\\test\\nonexistent.ts';

      mockFileSystem.readFile.mockRejectedValue(
        new Error('ENOENT: File not found'),
      );

      // Act
      const result = await service.extractCodeInsights(filePath);

      // Assert
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error extracting code insights'),
        expect.any(Error),
      );
      expect(mockAstAnalyzer.analyzeSource).not.toHaveBeenCalled();
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
      mockAstAnalyzer.analyzeSource.mockResolvedValue(Result.ok(mockInsights));

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

    it('should log debug messages around analysis', async () => {
      // Arrange
      const filePath = 'D:\\test\\debug-test.ts';
      const fileContent = 'const x = 1;';

      mockFileSystem.readFile.mockResolvedValue(fileContent);
      mockAstAnalyzer.analyzeSource.mockResolvedValue(
        Result.ok({ functions: [], classes: [], imports: [] }),
      );

      // Act
      await service.extractCodeInsights(filePath);

      // Assert
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Extracting code insights'),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Code insights extracted successfully'),
      );
    });
  });
});
