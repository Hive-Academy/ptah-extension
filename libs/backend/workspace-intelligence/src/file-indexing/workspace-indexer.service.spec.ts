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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFsProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWorkspaceProvider: any;

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

    mockFsProvider = {
      readFile: jest.fn(),
      readDirectory: jest.fn(),
      stat: jest.fn(),
      exists: jest.fn(),
      findFiles: jest.fn().mockResolvedValue([]),
      createFileWatcher: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    mockWorkspaceProvider = {
      getWorkspaceFolders: jest.fn().mockReturnValue(['/workspace']),
      getWorkspaceRoot: jest.fn().mockReturnValue('/workspace'),
      getConfiguration: jest.fn(),
      onDidChangeConfiguration: jest.fn(),
      onDidChangeWorkspaceFolders: jest.fn(),
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    service = new WorkspaceIndexerService(
      fileSystemService,
      patternMatcher,
      ignoreResolver,
      fileClassifier,
      tokenCounter,
      mockFsProvider,
      mockWorkspaceProvider,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('indexWorkspace', () => {
    it('should index all files in workspace', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/src/app.ts',
        '/workspace/src/utils.ts',
        '/workspace/README.md',
      ]);

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);

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
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/src/app.ts',
        '/workspace/node_modules/lib.js',
        '/workspace/README.md',
      ]);

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      // Non-empty ignore file set so isIgnored is consulted per file
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
        (relativePath: string) =>
          Promise.resolve({
            filePath: relativePath,
            ignored: relativePath.includes('node_modules'),
          }),
      );

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await service.indexWorkspace();

      expect(result.files).toHaveLength(2); // node_modules file excluded
      expect(result.files.some((f) => f.path.includes('node_modules'))).toBe(
        false,
      );
    });

    it('should skip files larger than maxFileSize', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/small.ts',
        '/workspace/large.ts',
      ]);

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);

      fileSystemService.stat.mockImplementation(async (filePath: string) => ({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: filePath.includes('large') ? 2000000 : 1000, // 2MB vs 1KB
      }));

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await service.indexWorkspace({
        maxFileSize: 1024 * 1024, // 1MB limit
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('/workspace/small.ts');
    });

    it('should estimate token counts when requested', async () => {
      mockFsProvider.findFiles.mockResolvedValue(['/workspace/app.ts']);

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      fileSystemService.readFile.mockResolvedValue('const x = 1;');
      tokenCounter.countTokens.mockResolvedValue(42);

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);

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
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/file1.ts',
        '/workspace/file2.ts',
        '/workspace/file3.ts',
      ]);

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);

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
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/src/app.ts',
        '/workspace/test/app.test.ts',
      ]);

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);

      // Mock returns only the files that match the exclude pattern
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
      expect(result.files[0].path).toBe('/workspace/src/app.ts');
    });

    it('should throw error if no workspace folder available', async () => {
      mockWorkspaceProvider.getWorkspaceRoot.mockReturnValue(undefined);

      await expect(service.indexWorkspace()).rejects.toThrow(
        'No workspace folder available for indexing',
      );
    });
  });

  describe('indexWorkspaceStream', () => {
    it('should yield files one at a time', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/file1.ts',
        '/workspace/file2.ts',
      ]);

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 1000,
      });

      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);

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
      expect(files[0].path).toBe('/workspace/file1.ts');
      expect(files[1].path).toBe('/workspace/file2.ts');
    });

    it('should respect ignore patterns in stream mode', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/src/app.ts',
        '/workspace/node_modules/lib.js',
      ]);

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
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
        (relativePath: string) =>
          Promise.resolve({
            filePath: relativePath,
            ignored: relativePath.includes('node_modules'),
          }),
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
      expect(files[0].path).toBe('/workspace/src/app.ts');
    });
  });

  describe('node_modules exclusion regression (TASK_2026_119)', () => {
    it('should call findFiles with an array exclude argument containing **/node_modules/**', async () => {
      const mockFsProviderWithSpy = {
        readFile: jest.fn(),
        readDirectory: jest.fn(),
        stat: jest.fn(),
        exists: jest.fn(),
        findFiles: jest
          .fn()
          .mockResolvedValue([
            '/workspace/src/app.ts',
            '/workspace/src/utils.ts',
            '/workspace/node_modules/some-lib/index.js',
          ]),
        createFileWatcher: jest.fn(),
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      const mockWorkspaceProvider = {
        getWorkspaceFolders: jest.fn().mockReturnValue(['/workspace']),
        getWorkspaceRoot: jest.fn().mockReturnValue('/workspace'),
        getConfiguration: jest.fn(),
        onDidChangeConfiguration: jest.fn(),
        onDidChangeWorkspaceFolders: jest.fn(),
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 500,
      });
      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const testService = new WorkspaceIndexerService(
        fileSystemService,
        patternMatcher,
        ignoreResolver,
        fileClassifier,
        tokenCounter,
        mockFsProviderWithSpy,
        mockWorkspaceProvider,
      );

      await testService.indexWorkspace();

      // The exclude argument must be an array, not a comma-joined string
      expect(mockFsProviderWithSpy.findFiles).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['**/node_modules/**']),
        undefined,
        '/workspace',
      );

      // Verify the exclude arg is actually an array (not a string like the old buggy code)
      const callArgs = mockFsProviderWithSpy.findFiles.mock
        .calls[0] as unknown[];
      const excludeArg = callArgs[1];
      expect(Array.isArray(excludeArg)).toBe(true);
      expect(typeof excludeArg).not.toBe('string');
    });

    it('should not include node_modules paths in result when findFiles filters them', async () => {
      // Simulate correct fast-glob behaviour: adapter returns only non-excluded files
      const mockFsProviderFiltered = {
        readFile: jest.fn(),
        readDirectory: jest.fn(),
        stat: jest.fn(),
        exists: jest.fn(),
        findFiles: jest
          .fn()
          .mockResolvedValue([
            '/workspace/src/app.ts',
            '/workspace/src/utils.ts',
          ]),
        createFileWatcher: jest.fn(),
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      const mockWorkspaceProvider = {
        getWorkspaceFolders: jest.fn().mockReturnValue(['/workspace']),
        getWorkspaceRoot: jest.fn().mockReturnValue('/workspace'),
        getConfiguration: jest.fn(),
        onDidChangeConfiguration: jest.fn(),
        onDidChangeWorkspaceFolders: jest.fn(),
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      fileSystemService.stat.mockResolvedValue({
        type: FileType.Source as unknown as number,
        ctime: 0,
        mtime: 0,
        size: 500,
      });
      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const testService = new WorkspaceIndexerService(
        fileSystemService,
        patternMatcher,
        ignoreResolver,
        fileClassifier,
        tokenCounter,
        mockFsProviderFiltered,
        mockWorkspaceProvider,
      );

      const result = await testService.indexWorkspace();

      // No node_modules paths should appear in the indexed file list
      const hasNodeModules = result.files.some((f) =>
        f.path.includes('node_modules'),
      );
      expect(hasNodeModules).toBe(false);
      expect(result.totalFiles).toBe(2);
    });
  });

  describe('getFileCount', () => {
    it('should return total file count', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/file1.ts',
        '/workspace/file2.ts',
        '/workspace/file3.ts',
      ]);

      const count = await service.getFileCount();

      expect(count).toBe(3);
    });

    it('should return 0 if no workspace folder', async () => {
      mockWorkspaceProvider.getWorkspaceRoot.mockReturnValue(undefined);

      const count = await service.getFileCount();

      expect(count).toBe(0);
    });
  });
});
