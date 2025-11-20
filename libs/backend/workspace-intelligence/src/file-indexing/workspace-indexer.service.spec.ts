/**
 * Workspace Indexer Service Unit Tests
 */

import 'reflect-metadata';
import { WorkspaceIndexerService } from './workspace-indexer.service';
import { FileSystemService } from '../services/file-system.service';
import { TokenCounterService } from '../services/token-counter.service';
import { PatternMatcherService } from './pattern-matcher.service';
import { IgnorePatternResolverService } from './ignore-pattern-resolver.service';
import { FileTypeClassifierService } from '../context-analysis/file-type-classifier.service';
import { FileType } from '../types/workspace.types';
import * as vscode from 'vscode';

// Mock VS Code API
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: {
          fsPath: '/workspace',
          scheme: 'file',
        },
      },
    ],
    findFiles: jest.fn(),
    asRelativePath: jest.fn((uri: { fsPath: string }) => {
      const basePath = '/workspace/';
      return uri.fsPath.startsWith(basePath)
        ? uri.fsPath.slice(basePath.length)
        : uri.fsPath;
    }),
  },
  Uri: {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  },
  RelativePattern: jest.fn(),
  FileType: {
    File: 1,
    Directory: 2,
  },
}));

describe('WorkspaceIndexerService', () => {
  let service: WorkspaceIndexerService;
  let fileSystemService: jest.Mocked<FileSystemService>;
  let tokenCounter: jest.Mocked<TokenCounterService>;
  let patternMatcher: jest.Mocked<PatternMatcherService>;
  let ignoreResolver: jest.Mocked<IgnorePatternResolverService>;
  let fileClassifier: jest.Mocked<FileTypeClassifierService>;

  beforeEach(() => {
    // Create mock services
    fileSystemService = {
      readFile: jest.fn(),
      stat: jest.fn(),
      readDirectory: jest.fn(),
      exists: jest.fn(),
      isVirtualWorkspace: jest.fn(),
    } as unknown as jest.Mocked<FileSystemService>;

    tokenCounter = {
      countTokens: jest.fn(),
      estimateTokens: jest.fn(),
      getMaxInputTokens: jest.fn(),
    } as unknown as jest.Mocked<TokenCounterService>;

    patternMatcher = {
      isMatch: jest.fn(),
      matchFiles: jest.fn(),
      getCacheStats: jest.fn(),
    } as unknown as jest.Mocked<PatternMatcherService>;

    ignoreResolver = {
      parseIgnoreFile: jest.fn(),
      parseWorkspaceIgnoreFiles: jest.fn(),
      isIgnored: jest.fn(),
      testFiles: jest.fn(),
      filterIgnored: jest.fn(),
    } as unknown as jest.Mocked<IgnorePatternResolverService>;

    fileClassifier = {
      classifyFile: jest.fn(),
      classifyFiles: jest.fn(),
      getStatistics: jest.fn(),
    } as unknown as jest.Mocked<FileTypeClassifierService>;

    service = new WorkspaceIndexerService(
      fileSystemService,
      patternMatcher,
      ignoreResolver,
      fileClassifier,
      tokenCounter
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('indexWorkspace', () => {
    it('should index all files in workspace', async () => {
      // Mock workspace files
      const mockFiles = [
        { fsPath: '/workspace/src/app.ts', scheme: 'file' },
        { fsPath: '/workspace/src/utils.ts', scheme: 'file' },
        { fsPath: '/workspace/README.md', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      // Mock file stats
      fileSystemService.stat.mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      // Mock ignore resolver
      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      (ignoreResolver.isIgnored as unknown as jest.Mock).mockReturnValue({
        matched: false,
        matchingPattern: null,
        reason: 'No matching pattern',
      });

      // Mock file classifier
      fileClassifier.classifyFile.mockImplementation((path: string) => {
        if (path.endsWith('.ts')) {
          return {
            type: FileType.Source,
            language: 'typescript',
            confidence: 1.0,
          };
        }
        return {
          type: FileType.Documentation,
          confidence: 1.0,
        };
      });

      const result = await service.indexWorkspace();

      expect(result.files).toHaveLength(3);
      expect(result.totalFiles).toBe(3);
      expect(result.totalSize).toBe(3000); // 3 files * 1000 bytes each
    });

    it('should respect ignore patterns', async () => {
      const mockFiles = [
        { fsPath: '/workspace/src/app.ts', scheme: 'file' },
        { fsPath: '/workspace/node_modules/lib.js', scheme: 'file' },
        { fsPath: '/workspace/README.md', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      fileSystemService.stat.mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      // Mock ignore patterns
      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([
        {
          filePath: '/workspace/.gitignore',
          patterns: [
            {
              raw: 'node_modules',
              pattern: 'node_modules',
              isNegation: false,
              isDirectoryOnly: false,
              lineNumber: 1,
            },
          ],
          baseDir: '/workspace',
        },
      ]);

      (ignoreResolver.isIgnored as unknown as jest.Mock).mockImplementation(
        (path: string) => {
          if (path.includes('node_modules')) {
            return Promise.resolve({
              filePath: path,
              ignored: true,
              matchedPattern: {
                raw: 'node_modules',
                pattern: 'node_modules',
                isNegation: false,
                isDirectoryOnly: false,
                lineNumber: 1,
              },
              matchedFile: '/workspace/.gitignore',
            });
          }
          return Promise.resolve({
            filePath: path,
            ignored: false,
          });
        }
      );

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await service.indexWorkspace();

      expect(result.files).toHaveLength(2); // node_modules file excluded
      expect(
        result.files.some((f) => f.relativePath.includes('node_modules'))
      ).toBe(false);
    });

    it('should skip files larger than maxFileSize', async () => {
      const mockFiles = [
        { fsPath: '/workspace/small.ts', scheme: 'file' },
        { fsPath: '/workspace/large.ts', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      (ignoreResolver.isIgnored as unknown as jest.Mock).mockReturnValue({
        matched: false,
        matchingPattern: null,
        reason: 'No matching pattern',
      });

      // Mock different file sizes
      fileSystemService.stat.mockImplementation(async (uri) => {
        const isLarge = uri.fsPath.includes('large');
        return {
          type: vscode.FileType.File,
          ctime: 0,
          mtime: 0,
          size: isLarge ? 2000000 : 1000, // 2MB vs 1KB
        };
      });

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await service.indexWorkspace({
        maxFileSize: 1024 * 1024, // 1MB limit
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].relativePath).toBe('small.ts');
    });

    it('should estimate token counts when requested', async () => {
      const mockFiles = [{ fsPath: '/workspace/app.ts', scheme: 'file' }];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      fileSystemService.stat.mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      fileSystemService.readFile.mockResolvedValue('const x = 1;');
      tokenCounter.countTokens.mockResolvedValue(42);

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      (ignoreResolver.isIgnored as unknown as jest.Mock).mockReturnValue({
        matched: false,
        matchingPattern: null,
        reason: 'No matching pattern',
      });

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await service.indexWorkspace({
        estimateTokens: true,
      });

      expect(result.files[0].estimatedTokens).toBe(42);
      expect(fileSystemService.readFile).toHaveBeenCalled();
      expect(tokenCounter.countTokens).toHaveBeenCalledWith('const x = 1;');
    });

    it('should call progress callback during indexing', async () => {
      const mockFiles = [
        { fsPath: '/workspace/file1.ts', scheme: 'file' },
        { fsPath: '/workspace/file2.ts', scheme: 'file' },
        { fsPath: '/workspace/file3.ts', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      fileSystemService.stat.mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      (ignoreResolver.isIgnored as unknown as jest.Mock).mockReturnValue({
        matched: false,
        matchingPattern: null,
        reason: 'No matching pattern',
      });

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const progressCallbacks: number[] = [];
      const onProgress = jest.fn((progress) => {
        progressCallbacks.push(progress.filesIndexed);
      });

      await service.indexWorkspace({}, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(progressCallbacks).toEqual([1, 2, 3]);
    });

    it('should apply exclude patterns', async () => {
      const mockFiles = [
        { fsPath: '/workspace/src/app.ts', scheme: 'file' },
        { fsPath: '/workspace/test/app.test.ts', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      fileSystemService.stat.mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      (ignoreResolver.isIgnored as unknown as jest.Mock).mockResolvedValue({
        filePath: '',
        ignored: false,
      });

      patternMatcher.matchFiles.mockImplementation((paths: string[]) => {
        return paths
          .map((path) => ({
            path,
            matched: path.includes('test'),
            matchedPatterns: path.includes('test') ? ['**/test/**'] : [],
          }))
          .filter((result) => result.matched);
      });

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await service.indexWorkspace({
        excludePatterns: ['**/test/**'],
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].relativePath).toBe('src/app.ts');
    });

    it('should throw error if no workspace folder available', async () => {
      // Temporarily remove workspace folders
      const originalFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders =
        undefined;

      await expect(service.indexWorkspace()).rejects.toThrow(
        'No workspace folder available for indexing'
      );

      // Restore workspace folders
      (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders =
        originalFolders;
    });
  });

  describe('indexWorkspaceStream', () => {
    it('should yield files one at a time', async () => {
      const mockFiles = [
        { fsPath: '/workspace/file1.ts', scheme: 'file' },
        { fsPath: '/workspace/file2.ts', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      fileSystemService.stat.mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      (ignoreResolver.isIgnored as unknown as jest.Mock).mockReturnValue({
        matched: false,
        matchingPattern: null,
        reason: 'No matching pattern',
      });

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const files = [];
      for await (const file of service.indexWorkspaceStream()) {
        files.push(file);
      }

      expect(files).toHaveLength(2);
      expect(files[0].relativePath).toBe('file1.ts');
      expect(files[1].relativePath).toBe('file2.ts');
    });

    it('should respect ignore patterns in stream mode', async () => {
      const mockFiles = [
        { fsPath: '/workspace/src/app.ts', scheme: 'file' },
        { fsPath: '/workspace/node_modules/lib.js', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      fileSystemService.stat.mockResolvedValue({
        type: vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([
        {
          filePath: '/workspace/.gitignore',
          patterns: [
            {
              raw: 'node_modules',
              pattern: 'node_modules',
              isNegation: false,
              isDirectoryOnly: false,
              lineNumber: 1,
            },
          ],
          baseDir: '/workspace',
        },
      ]);

      (ignoreResolver.isIgnored as unknown as jest.Mock).mockImplementation(
        (path: string) => {
          if (path.includes('node_modules')) {
            return Promise.resolve({
              filePath: path,
              ignored: true,
              matchedPattern: {
                raw: 'node_modules',
                pattern: 'node_modules',
                isNegation: false,
                isDirectoryOnly: false,
                lineNumber: 1,
              },
              matchedFile: '/workspace/.gitignore',
            });
          }
          return Promise.resolve({
            filePath: path,
            ignored: false,
          });
        }
      );

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const files = [];
      for await (const file of service.indexWorkspaceStream()) {
        files.push(file);
      }

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });
  });

  describe('getFileCount', () => {
    it('should return total file count', async () => {
      const mockFiles = [
        { fsPath: '/workspace/file1.ts', scheme: 'file' },
        { fsPath: '/workspace/file2.ts', scheme: 'file' },
        { fsPath: '/workspace/file3.ts', scheme: 'file' },
      ];

      (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);

      const count = await service.getFileCount();

      expect(count).toBe(3);
    });

    it('should return 0 if no workspace folder', async () => {
      const originalFolders = vscode.workspace.workspaceFolders;
      (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders =
        undefined;

      const count = await service.getFileCount();

      expect(count).toBe(0);

      (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders =
        originalFolders;
    });
  });
});
