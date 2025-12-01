/**
 * Unit Tests for PtahAPIBuilder Service
 *
 * Tests comprehensive namespace construction, service delegation, and error handling
 * for the Ptah API builder that exposes 12 namespaces to code execution context.
 *
 * Test Coverage:
 * - Constructor and dependency injection
 * - build() method with all 12 namespaces
 * - Core namespaces: workspace, search, symbols, diagnostics, git
 * - System namespaces: ai, files, commands
 * - Analysis namespaces: context, project, relevance
 * - AST namespace: ast
 * - Error handling for all operations
 */

import 'reflect-metadata';
import { PtahAPIBuilder } from './ptah-api-builder.service';
import {
  Logger,
  FileSystemManager,
  CommandManager,
} from '@ptah-extension/vscode-core';
import {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
  ContextSizeOptimizerService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FileRelevanceScorerService,
  TokenCounterService,
  WorkspaceIndexerService,
  ProjectDetectorService,
  TreeSitterParserService,
  AstAnalysisService,
} from '@ptah-extension/workspace-intelligence';
import * as vscode from 'vscode';

// Mock vscode module
jest.mock('vscode', () => ({
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  SymbolKind: {
    Class: 4,
    Function: 11,
    Method: 5,
    Interface: 10,
    Variable: 12,
  },
  FileType: {
    Directory: 2,
    File: 1,
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, toString: () => path }),
    joinPath: (uri: any, path: string) => ({
      fsPath: `${uri.fsPath}/${path}`,
      toString: () => `${uri.fsPath}/${path}`,
    }),
  },
  LanguageModelChatMessage: {
    User: (msg: string) => ({ role: 'user', content: msg }),
  },
  commands: {
    executeCommand: jest.fn(),
    getCommands: jest.fn(),
  },
  languages: {
    getDiagnostics: jest.fn(),
  },
  extensions: {
    getExtension: jest.fn(),
  },
  lm: {
    selectChatModels: jest.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
  },
}));

describe('PtahAPIBuilder', () => {
  let service: PtahAPIBuilder;
  let mockWorkspaceAnalyzer: jest.Mocked<WorkspaceAnalyzerService>;
  let mockContextOrchestration: jest.Mocked<ContextOrchestrationService>;
  let mockLogger: jest.Mocked<Logger>;
  let mockFileSystemManager: jest.Mocked<FileSystemManager>;
  let mockCommandManager: jest.Mocked<CommandManager>;
  let mockContextOptimizer: jest.Mocked<ContextSizeOptimizerService>;
  let mockMonorepoDetector: jest.Mocked<MonorepoDetectorService>;
  let mockDependencyAnalyzer: jest.Mocked<DependencyAnalyzerService>;
  let mockRelevanceScorer: jest.Mocked<FileRelevanceScorerService>;
  let mockTokenCounter: jest.Mocked<TokenCounterService>;
  let mockWorkspaceIndexer: jest.Mocked<WorkspaceIndexerService>;
  let mockProjectDetector: jest.Mocked<ProjectDetectorService>;
  let mockTreeSitterParser: jest.Mocked<TreeSitterParserService>;
  let mockAstAnalysis: jest.Mocked<AstAnalysisService>;

  beforeEach(() => {
    // Create mock services with proper jest.fn() typing
    mockWorkspaceAnalyzer = {
      getCurrentWorkspaceInfo: jest.fn() as any,
      analyzeWorkspaceStructure: jest.fn() as any,
    } as any;

    mockContextOrchestration = {
      searchFiles: jest.fn() as any,
      getFileSuggestions: jest.fn() as any,
    } as any;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    mockFileSystemManager = {
      readFile: jest.fn(),
      readDirectory: jest.fn(),
    } as any;

    mockCommandManager = {
      executeCommand: jest.fn(),
    } as any;

    // Analysis service mocks
    mockContextOptimizer = {
      optimizeContext: jest.fn(),
      getRecommendedBudget: jest.fn(),
    } as any;

    mockMonorepoDetector = {
      detectMonorepo: jest.fn(),
    } as any;

    mockDependencyAnalyzer = {
      analyzeDependencies: jest.fn(),
    } as any;

    mockRelevanceScorer = {
      scoreFile: jest.fn(),
      getTopFiles: jest.fn(),
    } as any;

    mockTokenCounter = {
      countTokens: jest.fn(),
    } as any;

    mockWorkspaceIndexer = {
      indexWorkspace: jest.fn(),
    } as any;

    mockProjectDetector = {
      detectProjectType: jest.fn(),
    } as any;

    // AST service mocks
    mockTreeSitterParser = {
      parse: jest.fn(),
      queryFunctions: jest.fn(),
      queryClasses: jest.fn(),
      queryImports: jest.fn(),
      queryExports: jest.fn(),
    } as any;

    mockAstAnalysis = {
      analyzeSource: jest.fn(),
    } as any;

    // Create service with all mocked dependencies
    service = new PtahAPIBuilder(
      mockWorkspaceAnalyzer,
      mockContextOrchestration,
      mockLogger,
      mockFileSystemManager,
      mockCommandManager,
      mockContextOptimizer,
      mockMonorepoDetector,
      mockDependencyAnalyzer,
      mockRelevanceScorer,
      mockTokenCounter,
      mockWorkspaceIndexer,
      mockProjectDetector,
      mockTreeSitterParser,
      mockAstAnalysis
    );

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Constructor and Dependency Injection', () => {
    it('should be instantiated with all required dependencies', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(PtahAPIBuilder);
    });

    it('should be injectable via @injectable() decorator', () => {
      expect(Reflect.hasMetadata('design:paramtypes', PtahAPIBuilder)).toBe(
        true
      );
    });
  });

  describe('build() Method', () => {
    it('should return complete PtahAPI object with all 12 namespaces', () => {
      const api = service.build();

      expect(api).toBeDefined();
      // Core namespaces
      expect(api).toHaveProperty('workspace');
      expect(api).toHaveProperty('search');
      expect(api).toHaveProperty('symbols');
      expect(api).toHaveProperty('diagnostics');
      expect(api).toHaveProperty('git');
      // System namespaces
      expect(api).toHaveProperty('ai');
      expect(api).toHaveProperty('files');
      expect(api).toHaveProperty('commands');
      // Analysis namespaces
      expect(api).toHaveProperty('context');
      expect(api).toHaveProperty('project');
      expect(api).toHaveProperty('relevance');
      // AST namespace
      expect(api).toHaveProperty('ast');
    });

    it('should have workspace namespace with all methods', () => {
      const api = service.build();

      expect(api.workspace).toHaveProperty('analyze');
      expect(api.workspace).toHaveProperty('getInfo');
      expect(api.workspace).toHaveProperty('getProjectType');
      expect(api.workspace).toHaveProperty('getFrameworks');
    });

    it('should have search namespace with all methods', () => {
      const api = service.build();

      expect(api.search).toHaveProperty('findFiles');
      expect(api.search).toHaveProperty('getRelevantFiles');
    });

    it('should have symbols namespace with find method', () => {
      const api = service.build();

      expect(api.symbols).toHaveProperty('find');
    });

    it('should have diagnostics namespace with all methods', () => {
      const api = service.build();

      expect(api.diagnostics).toHaveProperty('getErrors');
      expect(api.diagnostics).toHaveProperty('getWarnings');
      expect(api.diagnostics).toHaveProperty('getAll');
    });

    it('should have git namespace with getStatus method', () => {
      const api = service.build();

      expect(api.git).toHaveProperty('getStatus');
    });

    it('should have ai namespace with all methods', () => {
      const api = service.build();

      expect(api.ai).toHaveProperty('chat');
      expect(api.ai).toHaveProperty('selectModel');
    });

    it('should have files namespace with all methods', () => {
      const api = service.build();

      expect(api.files).toHaveProperty('read');
      expect(api.files).toHaveProperty('list');
    });

    it('should have commands namespace with all methods', () => {
      const api = service.build();

      expect(api.commands).toHaveProperty('execute');
      expect(api.commands).toHaveProperty('list');
    });

    it('should have context namespace with all methods', () => {
      const api = service.build();

      expect(api.context).toHaveProperty('optimize');
      expect(api.context).toHaveProperty('countTokens');
      expect(api.context).toHaveProperty('getRecommendedBudget');
    });

    it('should have project namespace with all methods', () => {
      const api = service.build();

      expect(api.project).toHaveProperty('detectMonorepo');
      expect(api.project).toHaveProperty('detectType');
      expect(api.project).toHaveProperty('analyzeDependencies');
    });

    it('should have relevance namespace with all methods', () => {
      const api = service.build();

      expect(api.relevance).toHaveProperty('scoreFile');
      expect(api.relevance).toHaveProperty('rankFiles');
    });

    it('should have ast namespace with all methods', () => {
      const api = service.build();

      expect(api.ast).toHaveProperty('analyze');
      expect(api.ast).toHaveProperty('parse');
      expect(api.ast).toHaveProperty('queryFunctions');
      expect(api.ast).toHaveProperty('queryClasses');
      expect(api.ast).toHaveProperty('queryImports');
      expect(api.ast).toHaveProperty('queryExports');
      expect(api.ast).toHaveProperty('getSupportedLanguages');
    });
  });

  describe('Workspace Namespace', () => {
    it('workspace.analyze() should delegate to WorkspaceAnalyzerService', async () => {
      const mockInfo = { projectType: 'angular', frameworks: ['Angular'] };
      const mockStructure = { totalFiles: 100 };

      (mockWorkspaceAnalyzer.getCurrentWorkspaceInfo as any).mockResolvedValue(
        mockInfo
      );
      (
        mockWorkspaceAnalyzer.analyzeWorkspaceStructure as any
      ).mockResolvedValue(mockStructure);

      const api = service.build();
      const result = await api.workspace.analyze();

      expect(mockWorkspaceAnalyzer.getCurrentWorkspaceInfo).toHaveBeenCalled();
      expect(
        mockWorkspaceAnalyzer.analyzeWorkspaceStructure
      ).toHaveBeenCalled();
      expect(result).toEqual({ info: mockInfo, structure: mockStructure });
    });

    it('workspace.getInfo() should delegate to getCurrentWorkspaceInfo', async () => {
      const mockInfo = { projectType: 'react', name: 'MyProject' };
      (mockWorkspaceAnalyzer.getCurrentWorkspaceInfo as any).mockResolvedValue(
        mockInfo
      );

      const api = service.build();
      const result = await api.workspace.getInfo();

      expect(mockWorkspaceAnalyzer.getCurrentWorkspaceInfo).toHaveBeenCalled();
      expect(result).toEqual(mockInfo);
    });

    it('workspace.getProjectType() should extract projectType from info', async () => {
      const mockInfo = { projectType: 'nestjs' };
      (mockWorkspaceAnalyzer.getCurrentWorkspaceInfo as any).mockResolvedValue(
        mockInfo
      );

      const api = service.build();
      const result = await api.workspace.getProjectType();

      expect(result).toBe('nestjs');
    });

    it('workspace.getProjectType() should return "unknown" if no info', async () => {
      (mockWorkspaceAnalyzer.getCurrentWorkspaceInfo as any).mockResolvedValue(
        null
      );

      const api = service.build();
      const result = await api.workspace.getProjectType();

      expect(result).toBe('unknown');
    });

    it('workspace.getFrameworks() should extract frameworks array', async () => {
      const mockInfo = { frameworks: ['Jest', 'TypeScript', 'React'] };
      (mockWorkspaceAnalyzer.getCurrentWorkspaceInfo as any).mockResolvedValue(
        mockInfo
      );

      const api = service.build();
      const result = await api.workspace.getFrameworks();

      expect(result).toEqual(['Jest', 'TypeScript', 'React']);
    });

    it('workspace.getFrameworks() should return empty array if no frameworks', async () => {
      const mockInfo = { projectType: 'node' };
      (mockWorkspaceAnalyzer.getCurrentWorkspaceInfo as any).mockResolvedValue(
        mockInfo
      );

      const api = service.build();
      const result = await api.workspace.getFrameworks();

      expect(result).toEqual([]);
    });
  });

  describe('Search Namespace', () => {
    it('search.findFiles() should delegate to contextOrchestration.searchFiles', async () => {
      const mockResults = {
        success: true,
        results: [
          { relativePath: 'src/app.ts' },
          { relativePath: 'src/main.ts' },
        ],
      };
      (mockContextOrchestration.searchFiles as any).mockResolvedValue(
        mockResults
      );

      const api = service.build();
      const result = await api.search.findFiles('*.ts', 20);

      expect(mockContextOrchestration.searchFiles).toHaveBeenCalledWith({
        requestId: expect.stringContaining('mcp-search-'),
        query: '*.ts',
        includeImages: false,
        maxResults: 20,
      });
      expect(result).toEqual(mockResults.results);
    });

    it('search.findFiles() should use default limit of 20', async () => {
      (mockContextOrchestration.searchFiles as any).mockResolvedValue({
        success: true,
        results: [],
      });

      const api = service.build();
      await api.search.findFiles('*.js');

      expect(mockContextOrchestration.searchFiles).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 20 })
      );
    });

    it('search.getRelevantFiles() should delegate to getFileSuggestions', async () => {
      const mockSuggestions = {
        success: true,
        suggestions: [{ path: 'auth.ts', score: 0.9 }],
      };
      (mockContextOrchestration.getFileSuggestions as any).mockResolvedValue(
        mockSuggestions
      );

      const api = service.build();
      const result = await api.search.getRelevantFiles('authentication', 10);

      expect(mockContextOrchestration.getFileSuggestions).toHaveBeenCalledWith({
        requestId: expect.stringContaining('mcp-relevant-'),
        query: 'authentication',
        limit: 10,
      });
      expect(result).toEqual(mockSuggestions.suggestions);
    });

    it('search.getRelevantFiles() should use default maxFiles of 10', async () => {
      (mockContextOrchestration.getFileSuggestions as any).mockResolvedValue({
        success: true,
        suggestions: [],
      });

      const api = service.build();
      await api.search.getRelevantFiles('test query');

      expect(mockContextOrchestration.getFileSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });
  });

  describe('Symbols Namespace', () => {
    it('symbols.find() should delegate to vscode.commands.executeCommand', async () => {
      const mockSymbols = [
        { name: 'UserService', kind: 4 },
        { name: 'UserController', kind: 4 },
      ];
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(
        mockSymbols
      );

      const api = service.build();
      const result = await api.symbols.find('User');

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.executeWorkspaceSymbolProvider',
        'User'
      );
      expect(result).toEqual(mockSymbols);
    });

    it('symbols.find() should filter by type when provided', async () => {
      const mockSymbols = [
        { name: 'UserService', kind: 4 }, // Class
        { name: 'createUser', kind: 11 }, // Function
      ];
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(
        mockSymbols
      );

      const api = service.build();
      const result = await api.symbols.find('User', 'class');

      expect(result).toEqual([{ name: 'UserService', kind: 4 }]);
    });

    it('symbols.find() should return empty array if no symbols found', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(null);

      const api = service.build();
      const result = await api.symbols.find('NonExistent');

      expect(result).toEqual([]);
    });
  });

  describe('Diagnostics Namespace', () => {
    beforeEach(() => {
      const mockDiagnostics = new Map([
        [
          { fsPath: 'file1.ts' },
          [
            {
              severity: 0,
              message: 'Syntax error',
              range: { start: { line: 10 } },
            },
            {
              severity: 1,
              message: 'Unused variable',
              range: { start: { line: 15 } },
            },
          ],
        ],
        [
          { fsPath: 'file2.ts' },
          [
            {
              severity: 0,
              message: 'Type error',
              range: { start: { line: 5 } },
            },
          ],
        ],
      ]);
      (vscode.languages.getDiagnostics as jest.Mock).mockReturnValue(
        mockDiagnostics
      );
    });

    it('diagnostics.getErrors() should filter by Error severity', async () => {
      const api = service.build();
      const result = await api.diagnostics.getErrors();

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { file: 'file1.ts', message: 'Syntax error', line: 10 },
        { file: 'file2.ts', message: 'Type error', line: 5 },
      ]);
    });

    it('diagnostics.getWarnings() should filter by Warning severity', async () => {
      const api = service.build();
      const result = await api.diagnostics.getWarnings();

      expect(result).toHaveLength(1);
      expect(result).toEqual([
        { file: 'file1.ts', message: 'Unused variable', line: 15 },
      ]);
    });

    it('diagnostics.getAll() should return all diagnostics with severity', async () => {
      const api = service.build();
      const result = await api.diagnostics.getAll();

      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          {
            file: 'file1.ts',
            message: 'Syntax error',
            line: 10,
            severity: 'error',
          },
          {
            file: 'file1.ts',
            message: 'Unused variable',
            line: 15,
            severity: 'warning',
          },
          {
            file: 'file2.ts',
            message: 'Type error',
            line: 5,
            severity: 'error',
          },
        ])
      );
    });
  });

  describe('Git Namespace', () => {
    it('git.getStatus() should delegate to VS Code git extension', async () => {
      const mockGitAPI = {
        repositories: [
          {
            state: {
              HEAD: { name: 'main' },
              workingTreeChanges: [
                { uri: { fsPath: 'file1.ts' }, status: 5 },
                { uri: { fsPath: 'file2.ts' }, status: 7 },
              ],
              indexChanges: [{ uri: { fsPath: 'file3.ts' } }],
            },
          },
        ],
      };
      const mockExtension = {
        exports: {
          getAPI: jest.fn().mockReturnValue(mockGitAPI),
        },
      };
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
        mockExtension
      );

      const api = service.build();
      const result = await api.git.getStatus();

      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('vscode.git');
      expect(mockExtension.exports.getAPI).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        branch: 'main',
        modified: ['file1.ts', 'file2.ts'],
        staged: ['file3.ts'],
        untracked: ['file2.ts'],
      });
    });

    it('git.getStatus() should throw error if git extension not available', async () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

      const api = service.build();

      await expect(api.git.getStatus()).rejects.toThrow(
        'Git extension not available'
      );
    });

    it('git.getStatus() should throw error if no repository found', async () => {
      const mockExtension = {
        exports: {
          getAPI: jest.fn().mockReturnValue({ repositories: [] }),
        },
      };
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
        mockExtension
      );

      const api = service.build();

      await expect(api.git.getStatus()).rejects.toThrow(
        'No git repository found'
      );
    });
  });

  describe('AI Namespace', () => {
    it('ai.chat() should delegate to vscode.lm.selectChatModels', async () => {
      const mockModel = {
        id: 'claude-3.5-sonnet',
        family: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        sendRequest: jest.fn().mockResolvedValue({
          text: (async function* () {
            yield 'Hello ';
            yield 'from ';
            yield 'Claude!';
          })(),
        }),
      };
      (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([mockModel]);

      const api = service.build();
      const result = await api.ai.chat('Test message', 'claude-3.5-sonnet');

      expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({
        family: 'claude-3.5-sonnet',
      });
      expect(mockModel.sendRequest).toHaveBeenCalled();
      expect(result).toBe('Hello from Claude!');
    });

    it('ai.chat() should throw error if no models found', async () => {
      (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue([]);

      const api = service.build();

      await expect(api.ai.chat('Test')).rejects.toThrow(
        'No language model found'
      );
    });

    it('ai.selectModel() should return available models metadata', async () => {
      const mockModels = [
        {
          id: 'claude-3.5-sonnet',
          family: 'claude-3.5-sonnet',
          name: 'Claude 3.5 Sonnet',
        },
        { id: 'claude-3-opus', family: 'claude-3-opus', name: 'Claude 3 Opus' },
      ];
      (vscode.lm.selectChatModels as jest.Mock).mockResolvedValue(mockModels);

      const api = service.build();
      const result = await api.ai.selectModel('claude');

      expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({
        family: 'claude',
      });
      expect(result).toEqual([
        {
          id: 'claude-3.5-sonnet',
          family: 'claude-3.5-sonnet',
          name: 'Claude 3.5 Sonnet',
        },
        { id: 'claude-3-opus', family: 'claude-3-opus', name: 'Claude 3 Opus' },
      ]);
    });
  });

  describe('Files Namespace', () => {
    it('files.read() should delegate to FileSystemManager', async () => {
      const mockContent = new TextEncoder().encode('file content');
      mockFileSystemManager.readFile.mockResolvedValue(mockContent);

      const api = service.build();
      const result = await api.files.read('/path/to/file.ts');

      expect(mockFileSystemManager.readFile).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: '/path/to/file.ts' })
      );
      expect(result).toBe('file content');
    });

    it('files.list() should delegate to FileSystemManager', async () => {
      const mockEntries: [string, vscode.FileType][] = [
        ['file1.ts', 1],
        ['dir1', 2],
        ['file2.js', 1],
      ];
      mockFileSystemManager.readDirectory.mockResolvedValue(mockEntries);

      const api = service.build();
      const result = await api.files.list('/path/to/dir');

      expect(mockFileSystemManager.readDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: '/path/to/dir' })
      );
      expect(result).toEqual([
        { name: 'file1.ts', type: 'file' },
        { name: 'dir1', type: 'directory' },
        { name: 'file2.js', type: 'file' },
      ]);
    });
  });

  describe('Commands Namespace', () => {
    it('commands.execute() should delegate to vscode.commands.executeCommand', async () => {
      const mockResult = { success: true };
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(
        mockResult
      );

      const api = service.build();
      const result = await api.commands.execute('vscode.open', 'file.ts');

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.open',
        'file.ts'
      );
      expect(result).toEqual(mockResult);
    });

    it('commands.list() should return only ptah commands', async () => {
      const mockCommands = [
        'vscode.open',
        'ptah.quickChat',
        'ptah.reviewFile',
        'editor.action.formatDocument',
      ];
      (vscode.commands.getCommands as jest.Mock).mockResolvedValue(
        mockCommands
      );

      const api = service.build();
      const result = await api.commands.list();

      expect(vscode.commands.getCommands).toHaveBeenCalled();
      expect(result).toEqual(['ptah.quickChat', 'ptah.reviewFile']);
    });
  });

  describe('Context Namespace', () => {
    it('context.countTokens() should delegate to TokenCounterService', async () => {
      mockTokenCounter.countTokens.mockResolvedValue(150);

      const api = service.build();
      const result = await api.context.countTokens('Hello world');

      expect(mockTokenCounter.countTokens).toHaveBeenCalledWith('Hello world');
      expect(result).toBe(150);
    });

    it('context.getRecommendedBudget() should delegate to ContextSizeOptimizerService', () => {
      mockContextOptimizer.getRecommendedBudget.mockReturnValue(200000);

      const api = service.build();
      const result = api.context.getRecommendedBudget('monorepo');

      expect(mockContextOptimizer.getRecommendedBudget).toHaveBeenCalledWith(
        'monorepo'
      );
      expect(result).toBe(200000);
    });
  });

  describe('AST Namespace', () => {
    it('ast.getSupportedLanguages() should return unique languages', () => {
      const api = service.build();
      const result = api.ast.getSupportedLanguages();

      expect(result).toContain('javascript');
      expect(result).toContain('typescript');
      // Should be unique values
      expect(new Set(result).size).toBe(result.length);
    });
  });

  describe('Error Handling', () => {
    it('should propagate workspace analyzer errors', async () => {
      const error = new Error('Workspace analysis failed');
      (mockWorkspaceAnalyzer.getCurrentWorkspaceInfo as any).mockRejectedValue(
        error
      );

      const api = service.build();

      await expect(api.workspace.getInfo()).rejects.toThrow(
        'Workspace analysis failed'
      );
    });

    it('should propagate context orchestration errors', async () => {
      const error = new Error('Search failed');
      (mockContextOrchestration.searchFiles as any).mockRejectedValue(error);

      const api = service.build();

      await expect(api.search.findFiles('*.ts')).rejects.toThrow(
        'Search failed'
      );
    });

    it('should propagate file system errors', async () => {
      const error = new Error('File not found');
      mockFileSystemManager.readFile.mockRejectedValue(error);

      const api = service.build();

      await expect(api.files.read('missing.ts')).rejects.toThrow(
        'File not found'
      );
    });
  });
});
