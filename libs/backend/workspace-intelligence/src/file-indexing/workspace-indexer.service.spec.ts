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
import type { Logger } from '@ptah-extension/vscode-core';

/**
 * The libuv detail text each errno carries, so a fixture reads like the error
 * Node actually raises. Only the `code` is load-bearing — the production
 * narrowing never looks at the message — but a fixture that spelled every code
 * "no such file or directory" would quietly teach the next reader that `EPERM`
 * is an absence, which is the misreading TASK_2026_307 exists to correct.
 */
const ERRNO_DETAIL: Readonly<Record<string, string>> = {
  ENOENT: 'no such file or directory',
  ENOTDIR: 'not a directory',
  ELOOP: 'too many symbolic links encountered',
  EPERM: 'operation not permitted',
  EBUSY: 'resource busy or locked',
  EACCES: 'permission denied',
  EMFILE: 'too many open files',
  EIO: 'i/o error',
};

/**
 * Build the `FileSystemError`-wrapped errno that `FileSystemService.stat()`
 * actually throws (`services/file-system.service.ts:69-78`): a fixed
 * `Failed to stat: <path>` message with the errno only on the wrapped cause.
 * The production narrowing reads `cause.code`, so a test that threw a bare
 * `Error('ENOENT')` would prove nothing.
 */
function statError(filePath: string, code: string): Error {
  const detail = ERRNO_DETAIL[code] ?? 'unknown error';
  const cause = new Error(`${code}: ${detail}, stat '${filePath}'`) as Error & {
    code: string;
    syscall: string;
  };
  cause.code = code;
  cause.syscall = 'stat';
  const wrapped = new Error(`Failed to stat: ${filePath}`) as Error & {
    cause: Error;
  };
  wrapped.name = 'FileSystemError';
  wrapped.cause = cause;
  return wrapped;
}

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

const WORKSPACE_ROOT = '/workspace';

describe('WorkspaceIndexerService', () => {
  let service: WorkspaceIndexerService;
  let fileSystemService: jest.Mocked<FileSystemService>;
  let tokenCounter: jest.Mocked<TokenCounterService>;
  let patternMatcher: jest.Mocked<PatternMatcherService>;
  let ignoreResolver: jest.Mocked<IgnorePatternResolverService>;
  let fileClassifier: jest.Mocked<FileTypeClassifierService>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFsProvider: any;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
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
      // Default: nothing is ignored. `discoverWorkspacePaths` compiles once and
      // filters with the result, so the double returns a predicate, not a bool.
      compileMatcher: jest.fn(() => () => false),
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

    service = new WorkspaceIndexerService(
      fileSystemService,
      patternMatcher,
      ignoreResolver,
      fileClassifier,
      tokenCounter,
      mockFsProvider,
      logger,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * The indexer wired to the REAL `PatternMatcherService`, for the exclude-path
   * cases. Everything else stays mocked; only the collaborator whose return
   * contract is under test is real.
   */
  function serviceWithRealMatcher(): WorkspaceIndexerService {
    return new WorkspaceIndexerService(
      fileSystemService,
      new PatternMatcherService(),
      ignoreResolver,
      fileClassifier,
      tokenCounter,
      mockFsProvider,
      logger,
    );
  }

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

      const result = await service.indexWorkspace({
        workspaceFolder: WORKSPACE_ROOT,
      });

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

      const result = await service.indexWorkspace({
        workspaceFolder: WORKSPACE_ROOT,
      });

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
        workspaceFolder: WORKSPACE_ROOT,
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
        workspaceFolder: WORKSPACE_ROOT,
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

      await service.indexWorkspace(
        { workspaceFolder: WORKSPACE_ROOT },
        onProgress,
      );

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

      // One result per INPUT path, matched and unmatched alike — the real
      // `matchFiles` contract. This mock used to `.filter()` the unmatched
      // entries away, which is a contract the service does not have and is
      // what let the caller read `excluded.length > 0` as "excluded".
      patternMatcher.matchFiles.mockImplementation((paths: string[]) => {
        return paths.map((path) => ({
          path,
          matched: path.includes('test'),
          matchedPatterns: path.includes('test') ? ['**/test/**'] : [],
        }));
      });

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await service.indexWorkspace({
        workspaceFolder: WORKSPACE_ROOT,
        excludePatterns: ['**/test/**'],
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('/workspace/src/app.ts');
    });

    // TASK_2026_331 B6.T1. `matchFiles` returns one `PatternMatchResult` per
    // INPUT path, so for a single-path call its length is 1 whatever the
    // patterns say. Reading that length as "this file is excluded" dropped
    // EVERY file the moment `excludePatterns` was non-empty, and the index came
    // back empty. These two cases run the REAL `PatternMatcherService` rather
    // than a hand-written mock, because a mock is free to invent the contract
    // that hid the defect in the first place.
    it('indexes a file that matches no exclude pattern', async () => {
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

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await serviceWithRealMatcher().indexWorkspace({
        workspaceFolder: WORKSPACE_ROOT,
        excludePatterns: ['**/test/**'],
      });

      expect(result.files.map((file) => file.path)).toContain(
        '/workspace/src/app.ts',
      );
    });

    it('excludes a file that matches an exclude pattern', async () => {
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

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const result = await serviceWithRealMatcher().indexWorkspace({
        workspaceFolder: WORKSPACE_ROOT,
        excludePatterns: ['**/test/**'],
      });

      expect(result.files.map((file) => file.path)).toEqual([
        '/workspace/src/app.ts',
      ]);
    });

    // TASK_2026_200 task 3.5: `workspaceFolder` no longer falls back to the
    // process-global IWorkspaceProvider. Omitting it is now an explicit error
    // rather than a silent index of whatever folder the IDE happens to show.
    it('should throw error when no workspace folder is supplied', async () => {
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
      for await (const file of service.indexWorkspaceStream({
        workspaceFolder: WORKSPACE_ROOT,
      })) {
        files.push(file);
      }

      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('/workspace/file1.ts');
      expect(files[1].path).toBe('/workspace/file2.ts');
    });

    // The stream path carried the same length-vs-result defect as
    // `indexWorkspace` (TASK_2026_331 B6.T1), and it is the path
    // `WorkspaceFileIndexService.build` actually uses.
    it('yields files that match no exclude pattern and skips those that do', async () => {
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

      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });

      const yielded: string[] = [];
      for await (const file of serviceWithRealMatcher().indexWorkspaceStream({
        workspaceFolder: WORKSPACE_ROOT,
        excludePatterns: ['**/test/**'],
      })) {
        yielded.push(file.path);
      }

      expect(yielded).toEqual(['/workspace/src/app.ts']);
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
      for await (const file of service.indexWorkspaceStream({
        workspaceFolder: WORKSPACE_ROOT,
      })) {
        files.push(file);
      }

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('/workspace/src/app.ts');
    });
  });

  /**
   * TASK_2026_306 defect D. One unstatable entry used to abort
   * `indexWorkspaceStream` for the ENTIRE workspace; the caller logged it as
   * non-fatal, so the app ran with no file index and no further signal.
   */
  describe('per-entry stat failures (TASK_2026_306 defect D)', () => {
    const OK_STAT = {
      type: FileType.Source as unknown as number,
      ctime: 0,
      mtime: 0,
      size: 1000,
    };

    beforeEach(() => {
      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });
    });

    const collect = async (): Promise<string[]> => {
      const paths: string[] = [];
      for await (const file of service.indexWorkspaceStream({
        workspaceFolder: WORKSPACE_ROOT,
      })) {
        paths.push(file.path);
      }
      return paths;
    };

    it('yields every other entry when one is unstatable', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/a.ts',
        '/workspace/gone.ts',
        '/workspace/b.ts',
        '/workspace/c.ts',
      ]);
      fileSystemService.stat.mockImplementation(async (filePath: string) => {
        if (filePath.includes('gone')) {
          throw statError(filePath, 'ENOENT');
        }
        return OK_STAT;
      });

      await expect(collect()).resolves.toEqual([
        '/workspace/a.ts',
        '/workspace/b.ts',
        '/workspace/c.ts',
      ]);
    });

    it('yields nothing, without throwing, when every entry is unstatable', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/a.ts',
        '/workspace/b.ts',
      ]);
      fileSystemService.stat.mockImplementation(async (filePath: string) => {
        throw statError(filePath, 'ENOENT');
      });

      await expect(collect()).resolves.toEqual([]);
    });

    it('counts the skips and surfaces them once per run', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/a.ts',
        '/workspace/gone-1.ts',
        '/workspace/gone-2.ts',
      ]);
      fileSystemService.stat.mockImplementation(async (filePath: string) => {
        if (filePath.includes('gone')) {
          throw statError(filePath, 'ENOENT');
        }
        return OK_STAT;
      });

      await collect();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('indexWorkspaceStream'),
        expect.objectContaining({ skipped: 2, discovered: 3 }),
      );
    });

    it('stays silent when nothing was skipped', async () => {
      mockFsProvider.findFiles.mockResolvedValue(['/workspace/a.ts']);
      fileSystemService.stat.mockResolvedValue(OK_STAT);

      await collect();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each(['ENOENT', 'ENOTDIR', 'ELOOP'])(
      'treats a %s entry as a skip (broken link / deleted mid-scan)',
      async (code) => {
        mockFsProvider.findFiles.mockResolvedValue([
          '/workspace/a.ts',
          '/workspace/bad.ts',
        ]);
        fileSystemService.stat.mockImplementation(async (filePath: string) => {
          if (filePath.includes('bad')) {
            throw statError(filePath, code);
          }
          return OK_STAT;
        });

        await expect(collect()).resolves.toEqual(['/workspace/a.ts']);
      },
    );

    it('narrows on the wrapped code, never on the message text', async () => {
      // Same wording an ENOENT produces, but no errno anywhere in the chain —
      // a substring check on the message would wrongly swallow this.
      mockFsProvider.findFiles.mockResolvedValue(['/workspace/a.ts']);
      fileSystemService.stat.mockImplementation(async () => {
        throw new Error(
          'Failed to stat: /workspace/a.ts (ENOENT mentioned in text only)',
        );
      });

      await expect(collect()).rejects.toThrow('ENOENT mentioned in text only');
    });

    it('applies the same skip to the non-streaming indexWorkspace sibling', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/a.ts',
        '/workspace/gone.ts',
        '/workspace/b.ts',
      ]);
      fileSystemService.stat.mockImplementation(async (filePath: string) => {
        if (filePath.includes('gone')) {
          throw statError(filePath, 'ENOENT');
        }
        return OK_STAT;
      });

      const result = await service.indexWorkspace({
        workspaceFolder: WORKSPACE_ROOT,
      });

      expect(result.files.map((f) => f.path)).toEqual([
        '/workspace/a.ts',
        '/workspace/b.ts',
      ]);
      expect(result.totalFiles).toBe(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('indexWorkspace:'),
        expect.objectContaining({ skipped: 1, discovered: 3 }),
      );
    });
  });

  /**
   * TASK_2026_307. `ENOENT` was the Unix-shaped assumption. On Windows — the
   * platform Ptah primarily ships to — the common reason an entry cannot be
   * statted is a LOCK, not an absence: a sharing violation surfaces as `EPERM`,
   * and a file being written right now as `EBUSY`. Neither was in the absorb
   * set, so one transiently locked file in the workspace the user has open in
   * an editor emptied the whole index.
   *
   * These specs are the mutation guard on that set: remove `'EPERM'` or
   * `'EBUSY'` from `UNREADABLE_ENTRY_CODES` and every case below goes red,
   * because the pass rejects instead of yielding the surviving entries.
   */
  describe('Windows lock codes (TASK_2026_307)', () => {
    const OK_STAT = {
      type: FileType.Source as unknown as number,
      ctime: 0,
      mtime: 0,
      size: 1000,
    };

    beforeEach(() => {
      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
      fileClassifier.classifyFile.mockReturnValue({
        type: FileType.Source,
        language: 'typescript',
        confidence: 1.0,
      });
    });

    const collect = async (): Promise<string[]> => {
      const paths: string[] = [];
      for await (const file of service.indexWorkspaceStream({
        workspaceFolder: WORKSPACE_ROOT,
      })) {
        paths.push(file.path);
      }
      return paths;
    };

    /** The locked entry sits in the MIDDLE, so "continues past it" is proven. */
    it.each([
      ['EPERM', 'held open by an editor or antivirus scanner'],
      ['EBUSY', 'being written at this moment'],
    ])('absorbs a %s entry (%s) and keeps indexing past it', async (code) => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/a.ts',
        '/workspace/locked.ts',
        '/workspace/b.ts',
        '/workspace/c.ts',
      ]);
      fileSystemService.stat.mockImplementation(async (filePath: string) => {
        if (filePath.includes('locked')) {
          throw statError(filePath, code);
        }
        return OK_STAT;
      });

      await expect(collect()).resolves.toEqual([
        '/workspace/a.ts',
        '/workspace/b.ts',
        '/workspace/c.ts',
      ]);
    });

    it.each(['EPERM', 'EBUSY'])(
      'does not reduce the indexed count of the others when one entry is %s',
      async (code) => {
        mockFsProvider.findFiles.mockResolvedValue([
          '/workspace/a.ts',
          '/workspace/locked.ts',
          '/workspace/b.ts',
        ]);
        fileSystemService.stat.mockImplementation(async (filePath: string) => {
          if (filePath.includes('locked')) {
            throw statError(filePath, code);
          }
          return OK_STAT;
        });

        const result = await service.indexWorkspace({
          workspaceFolder: WORKSPACE_ROOT,
        });

        expect(result.files.map((f) => f.path)).toEqual([
          '/workspace/a.ts',
          '/workspace/b.ts',
        ]);
        expect(result.totalFiles).toBe(2);
      },
    );

    /**
     * The realistic Windows shape: a scanner sweep locks several entries at
     * once, with the two codes interleaved. The index must survive with every
     * readable entry present, and the run must still say so exactly once.
     */
    it('survives a mixed EPERM/EBUSY sweep and reports the skips once', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/a.ts',
        '/workspace/locked-perm.ts',
        '/workspace/b.ts',
        '/workspace/locked-busy.ts',
        '/workspace/c.ts',
      ]);
      fileSystemService.stat.mockImplementation(async (filePath: string) => {
        if (filePath.includes('locked-perm')) {
          throw statError(filePath, 'EPERM');
        }
        if (filePath.includes('locked-busy')) {
          throw statError(filePath, 'EBUSY');
        }
        return OK_STAT;
      });

      await expect(collect()).resolves.toEqual([
        '/workspace/a.ts',
        '/workspace/b.ts',
        '/workspace/c.ts',
      ]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('indexWorkspaceStream'),
        expect.objectContaining({ skipped: 2, discovered: 5 }),
      );
    });

    /**
     * The absorb must not become a swallow-everything. `EACCES` is deliberately
     * NOT in the set: on Windows a transient lock is `EPERM`/`EBUSY`, while
     * `EACCES` is a durable ACL decision about a path this process may not read
     * — it will be just as true for the next entry and on the next pass.
     * Absorbing it would trade a permanent, actionable failure for a silently
     * partial index, which is the defect this guard exists to prevent. `EMFILE`
     * and `EIO` describe the process and the device for the same reason.
     *
     * `EACCES` is the one to watch: it is in `harness-sync`'s
     * `RETRYABLE_ERROR_CODES`, and that set is a RETRY list on a destructive
     * write, not an absorb list on a read-only pass.
     */
    it.each(['EACCES', 'EMFILE', 'EIO'])(
      'still aborts the run on %s, which is about the environment not the entry',
      async (code) => {
        mockFsProvider.findFiles.mockResolvedValue([
          '/workspace/a.ts',
          '/workspace/denied.ts',
          '/workspace/b.ts',
        ]);
        fileSystemService.stat.mockImplementation(async (filePath: string) => {
          if (filePath.includes('denied')) {
            throw statError(filePath, code);
          }
          return OK_STAT;
        });

        await expect(collect()).rejects.toThrow('Failed to stat');
        await expect(
          service.indexWorkspace({ workspaceFolder: WORKSPACE_ROOT }),
        ).rejects.toThrow('Failed to stat');
      },
    );
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
        logger,
      );

      await testService.indexWorkspace({ workspaceFolder: WORKSPACE_ROOT });

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
        logger,
      );

      const result = await testService.indexWorkspace({
        workspaceFolder: WORKSPACE_ROOT,
      });

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

      const count = await service.getFileCount({
        workspaceFolder: WORKSPACE_ROOT,
      });

      expect(count).toBe(3);
    });

    it('should return 0 when no workspace folder is supplied', async () => {
      const count = await service.getFileCount();

      expect(count).toBe(0);
    });
  });

  /**
   * TASK_2026_344 — the path-only walk the `@`-mention index consumes.
   *
   * The index needs paths and nothing else, but it used to drive
   * `indexWorkspaceStream`, which per file awaits `isIgnored`, awaits a `stat`
   * and runs the classifier. On the captured Electron session that was 8-15 s
   * of main-loop time per workspace switch for a 15k-file folder. These tests
   * pin the three properties that removed it: no per-file I/O, batching, and a
   * real macrotask boundary between batches.
   */
  describe('discoverWorkspacePaths', () => {
    const collect = async (
      options: Parameters<WorkspaceIndexerService['discoverWorkspacePaths']>[0],
    ): Promise<string[][]> => {
      const batches: string[][] = [];
      for await (const batch of service.discoverWorkspacePaths(options)) {
        batches.push([...batch]);
      }
      return batches;
    };

    beforeEach(() => {
      ignoreResolver.parseWorkspaceIgnoreFiles.mockResolvedValue([]);
    });

    it('yields every discovered path and touches nothing else on disk', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/src/app.ts',
        '/workspace/README.md',
      ]);

      const batches = await collect({ workspaceFolder: WORKSPACE_ROOT });

      expect(batches).toEqual([
        ['/workspace/src/app.ts', '/workspace/README.md'],
      ]);
      // The whole reason this generator exists: none of the per-file work.
      expect(fileSystemService.stat).not.toHaveBeenCalled();
      expect(fileSystemService.readFile).not.toHaveBeenCalled();
      expect(fileClassifier.classifyFile).not.toHaveBeenCalled();
      expect(tokenCounter.countTokens).not.toHaveBeenCalled();
      // ...and the ignore rules are compiled ONCE, not consulted per path.
      expect(ignoreResolver.isIgnored).not.toHaveBeenCalled();
    });

    it('filters with the compiled matcher, once per walk', async () => {
      mockFsProvider.findFiles.mockResolvedValue([
        '/workspace/src/app.ts',
        '/workspace/dist/bundle.js',
      ]);
      const compile = ignoreResolver.compileMatcher as unknown as jest.Mock;
      compile.mockReturnValue((relativePath: string) =>
        relativePath.replace(/\\/g, '/').startsWith('dist/'),
      );

      const batches = await collect({ workspaceFolder: WORKSPACE_ROOT });

      expect(batches).toEqual([['/workspace/src/app.ts']]);
      expect(compile).toHaveBeenCalledTimes(1);
    });

    it('reuses ignore files the caller already parsed', async () => {
      mockFsProvider.findFiles.mockResolvedValue(['/workspace/src/app.ts']);
      const compile = ignoreResolver.compileMatcher as unknown as jest.Mock;
      const preParsed = [
        {
          filePath: '/workspace/.gitignore',
          baseDir: '/workspace',
          patterns: [],
        },
      ];

      await collect({
        workspaceFolder: WORKSPACE_ROOT,
        ignoreFiles: preParsed,
      });

      expect(ignoreResolver.parseWorkspaceIgnoreFiles).not.toHaveBeenCalled();
      expect(compile).toHaveBeenCalledWith(preParsed, WORKSPACE_ROOT);
    });

    it('yields batches of the configured size', async () => {
      mockFsProvider.findFiles.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => `/workspace/f${i}.ts`),
      );

      const batches = await collect({
        workspaceFolder: WORKSPACE_ROOT,
        batchSize: 3,
      });

      expect(batches.map((b) => b.length)).toEqual([3, 3, 1]);
    });

    /**
     * The load-bearing one. A `Promise.resolve()` yield would satisfy "is
     * async" and still starve the loop, because microtasks drain inside the
     * same turn. This asserts a MACROTASK boundary: a `setImmediate` scheduled
     * by the consumer while it holds batch 1 must run before batch 2 arrives.
     */
    it('lets a setImmediate callback run between batches', async () => {
      mockFsProvider.findFiles.mockResolvedValue(
        Array.from({ length: 6 }, (_, i) => `/workspace/f${i}.ts`),
      );

      const order: string[] = [];
      let batchIndex = 0;
      for await (const batch of service.discoverWorkspacePaths({
        workspaceFolder: WORKSPACE_ROOT,
        batchSize: 2,
      })) {
        order.push(`batch-${batchIndex}:${batch.length}`);
        if (batchIndex === 0) {
          setImmediate(() => order.push('probe'));
        }
        batchIndex++;
      }

      expect(order).toEqual(['batch-0:2', 'probe', 'batch-1:2', 'batch-2:2']);
    });

    it('throws when no workspace folder is supplied', async () => {
      await expect(collect({ workspaceFolder: '' })).rejects.toThrow(
        'No workspace folder available for indexing',
      );
    });
  });
});
