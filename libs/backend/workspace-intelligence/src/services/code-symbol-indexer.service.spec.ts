// libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts
// Tests for CodeSymbolIndexer AbortSignal cooperative cancellation

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { ISymbolSink } from '@ptah-extension/memory-contracts';
import type { AstAnalysisService } from '../ast/ast-analysis.service';
import type { BackgroundWorkAdmission } from '@ptah-extension/vscode-core';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { CodeSymbolIndexer } from './code-symbol-indexer.service';

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeFs(): jest.Mocked<IFileSystemProvider> {
  return {
    readFile: jest.fn(),
    readFileBytes: jest.fn(),
    writeFile: jest.fn(),
    writeFileBytes: jest.fn(),
    readDirectory: jest.fn(),
    stat: jest.fn(),
    exists: jest.fn(),
    delete: jest.fn(),
    createDirectory: jest.fn(),
    copy: jest.fn(),
    findFiles: jest.fn(),
    createFileWatcher: jest.fn(),
  } as unknown as jest.Mocked<IFileSystemProvider>;
}

function makeSymbolSink(): jest.Mocked<ISymbolSink> {
  return {
    deleteSymbolsForFile: jest.fn().mockReturnValue(0),
    insertSymbols: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Build a mock WorkspaceIndexerService whose `indexWorkspaceStream` yields
 * the provided file paths as minimal IndexedFile objects.
 */
function makeIndexer(
  filePaths: string[],
): jest.Mocked<WorkspaceIndexerService> {
  async function* gen() {
    for (const p of filePaths) {
      yield {
        path: p,
        relativePath: p,
        type: 'source' as const,
        size: 100,
        estimatedTokens: 25,
      };
    }
  }
  return {
    indexWorkspaceStream: jest.fn().mockReturnValue(gen()),
  } as unknown as jest.Mocked<WorkspaceIndexerService>;
}

/**
 * Build a mock AstAnalysisService that returns an empty analysis result
 * (no functions, no classes) for every file.
 */
function makeAst(): jest.Mocked<AstAnalysisService> {
  return {
    analyzeSource: jest.fn().mockResolvedValue({
      isErr: () => false,
      value: { functions: [], classes: [] },
    }),
  } as unknown as jest.Mocked<AstAnalysisService>;
}

// ---------------------------------------------------------------------------
// Helpers to fabricate enough TS files to span multiple batches
// ---------------------------------------------------------------------------

/** Returns N distinct fake .ts file paths. */
function fakeTsFiles(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `/workspace/src/file${i}.ts`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CodeSymbolIndexer', () => {
  describe('indexWorkspace — AbortSignal cooperative cancellation', () => {
    it('aborts at a batch boundary and returns partial stats when signal fires mid-run', async () => {
      // Arrange: 3 batches of 3 files = 9 files total (small for speed).
      // The AbortController is aborted during the last file of batch 1 so
      // that when yieldToEventLoop() resolves and the signal check runs, the
      // signal is already aborted — preventing batch 2 from starting.
      const BATCH_SIZE = 3;
      const TOTAL_FILES = 9; // 3 full batches
      const files = fakeTsFiles(TOTAL_FILES);

      const logger = makeLogger();
      const fs = makeFs();
      const sink = makeSymbolSink();
      const indexer = makeIndexer(files);

      const controller = new AbortController();

      // Abort after the BATCH_SIZE-th readFile call (i.e., last file of batch 1).
      let readCallCount = 0;
      fs.readFile.mockImplementation(async () => {
        readCallCount++;
        if (readCallCount === BATCH_SIZE) {
          controller.abort();
        }
        return '';
      });

      // AST: returns empty result (no symbols) — keeps the test deterministic.
      const ast = makeAst();

      const service = new CodeSymbolIndexer(logger, ast, indexer, fs, sink);

      // Act: the abort signal check at the batch boundary throws DOMException.
      let thrownError: unknown;
      let stats;
      try {
        stats = await service.indexWorkspace('/workspace', {
          batchSize: BATCH_SIZE,
          signal: controller.signal,
        });
      } catch (err: unknown) {
        thrownError = err;
      }

      // Assert: an AbortError DOMException was thrown
      expect(thrownError).toBeInstanceOf(DOMException);
      expect((thrownError as DOMException).name).toBe('AbortError');

      // No stats were returned (thrown before the return statement)
      expect(stats).toBeUndefined();

      // Exactly one batch (BATCH_SIZE files) was processed before the abort.
      // readFile is called once per file inside _indexFile.
      expect(fs.readFile).toHaveBeenCalledTimes(BATCH_SIZE);

      // deleteSymbolsForFile is called once per processed file (batch 1 only).
      expect(sink.deleteSymbolsForFile).toHaveBeenCalledTimes(BATCH_SIZE);

      // No symbols extracted (AST returns no functions/classes) so no insertSymbols.
      expect(sink.insertSymbols).not.toHaveBeenCalled();
    });

    it('runs to completion and returns full stats when no signal is provided', async () => {
      // Arrange: 2 batches of 3 files = 6 files total (smaller for speed)
      const files = fakeTsFiles(6);
      const logger = makeLogger();
      const fs = makeFs();
      const sink = makeSymbolSink();
      const indexer = makeIndexer(files);
      const ast = makeAst();
      fs.readFile.mockResolvedValue('');

      const service = new CodeSymbolIndexer(logger, ast, indexer, fs, sink);

      // Act
      const stats = await service.indexWorkspace('/workspace', {
        batchSize: 3,
      });

      // Assert: all 6 files processed, no abort
      expect(stats.filesScanned).toBe(6);
      expect(stats.errors).toBe(0);
    });

    it('runs to completion when signal is provided but never aborted', async () => {
      // Arrange: 2 batches of 3 files = 6 files
      const files = fakeTsFiles(6);
      const logger = makeLogger();
      const fs = makeFs();
      const sink = makeSymbolSink();
      const indexer = makeIndexer(files);
      const ast = makeAst();
      fs.readFile.mockResolvedValue('');

      const controller = new AbortController();
      // Do NOT call controller.abort()

      const service = new CodeSymbolIndexer(logger, ast, indexer, fs, sink);

      const stats = await service.indexWorkspace('/workspace', {
        batchSize: 3,
        signal: controller.signal,
      });

      expect(stats.filesScanned).toBe(6);
      expect(stats.errors).toBe(0);
    });
  });

  /**
   * TASK_2026_437 C14 (b): background indexing yields to the foreground before
   * each batch; a user/agent-initiated run never waits.
   */
  describe('indexWorkspace — background-work governor', () => {
    interface FakeGovernor extends BackgroundWorkAdmission {
      clear: boolean;
      whenClear: jest.Mock;
      isClear: jest.Mock;
      release(outcome?: 'clear' | 'timeout'): void;
      reject(error: Error): void;
    }

    function makeGovernor(): FakeGovernor {
      let settle: {
        resolve: (outcome: 'clear' | 'timeout') => void;
        reject: (error: Error) => void;
      } | null = null;
      const state = { clear: false };
      const governor = {
        get clear(): boolean {
          return state.clear;
        },
        set clear(value: boolean) {
          state.clear = value;
        },
        isClear: jest.fn((): boolean => state.clear),
        whenClear: jest.fn(
          () =>
            new Promise<'clear' | 'timeout'>((resolve, reject) => {
              settle = { resolve, reject };
            }),
        ),
        release(outcome: 'clear' | 'timeout' = 'clear') {
          settle?.resolve(outcome);
          settle = null;
        },
        reject(error: Error) {
          settle?.reject(error);
          settle = null;
        },
      };
      return governor as unknown as FakeGovernor;
    }

    const flush = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };

    function abortError(): Error {
      const error = new Error('Background-work governor disposed');
      error.name = 'AbortError';
      return error;
    }

    function build(governor: BackgroundWorkAdmission | null, files: string[]) {
      const logger = makeLogger();
      const fs = makeFs();
      fs.readFile.mockResolvedValue('');
      const sink = makeSymbolSink();
      const service = new CodeSymbolIndexer(
        logger,
        makeAst(),
        makeIndexer(files),
        fs,
        sink,
        governor,
      );
      return { service, logger, fs, sink };
    }

    it('waits for the governor before the first batch and again before each later one', async () => {
      const governor = makeGovernor();
      const { service, fs } = build(governor, fakeTsFiles(6));

      const run = service.indexWorkspace('/workspace', { batchSize: 3 });
      await flush();
      expect(governor.whenClear).toHaveBeenCalledTimes(1);
      expect(governor.whenClear).toHaveBeenCalledWith({
        lane: 'code-symbol-indexer',
      });
      expect(fs.readFile).not.toHaveBeenCalled();

      governor.release();
      await flush();
      expect(fs.readFile).toHaveBeenCalledTimes(3);
      expect(governor.whenClear).toHaveBeenCalledTimes(2);

      governor.release();
      const stats = await run;
      expect(fs.readFile).toHaveBeenCalledTimes(6);
      expect(stats.filesScanned).toBe(6);
    });

    it('asks nothing of whenClear while the governor is already clear', async () => {
      const governor = makeGovernor();
      governor.clear = true;
      const { service } = build(governor, fakeTsFiles(6));

      const stats = await service.indexWorkspace('/workspace', {
        batchSize: 3,
      });

      expect(stats.filesScanned).toBe(6);
      expect(governor.isClear).toHaveBeenCalledTimes(2);
      expect(governor.whenClear).not.toHaveBeenCalled();
    });

    it('a userInitiated run never consults the governor', async () => {
      const governor = makeGovernor();
      const { service } = build(governor, fakeTsFiles(6));

      const stats = await service.indexWorkspace('/workspace', {
        batchSize: 3,
        userInitiated: true,
      });

      expect(stats.filesScanned).toBe(6);
      expect(governor.isClear).not.toHaveBeenCalled();
      expect(governor.whenClear).not.toHaveBeenCalled();
    });

    it('proceeds when the governor resolves at its starvation ceiling', async () => {
      const governor = makeGovernor();
      const { service } = build(governor, fakeTsFiles(3));

      const run = service.indexWorkspace('/workspace', { batchSize: 3 });
      await flush();
      governor.release('timeout');

      await expect(run).resolves.toMatchObject({ filesScanned: 3 });
    });

    it('stops cleanly with an AbortError when the governor is disposed mid-run — no partial batch, no warn/error', async () => {
      const governor = makeGovernor();
      const { service, fs, sink, logger } = build(governor, fakeTsFiles(9));

      const run = service.indexWorkspace('/workspace', { batchSize: 3 });
      await flush();
      governor.release();
      await flush();
      expect(fs.readFile).toHaveBeenCalledTimes(3);

      // Host shutdown while held before batch 2.
      governor.reject(abortError());
      const thrown = await run.catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(DOMException);
      expect((thrown as DOMException).name).toBe('AbortError');
      // Batch 1 completed whole; batch 2 never started.
      expect(fs.readFile).toHaveBeenCalledTimes(3);
      expect(sink.deleteSymbolsForFile).toHaveBeenCalledTimes(3);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('hands the caller signal to whenClear, so aborting releases a held run', async () => {
      const governor = makeGovernor();
      const { service, fs } = build(governor, fakeTsFiles(3));
      const controller = new AbortController();

      const run = service.indexWorkspace('/workspace', {
        batchSize: 3,
        signal: controller.signal,
      });
      await flush();
      expect(governor.whenClear).toHaveBeenCalledWith({
        signal: controller.signal,
        lane: 'code-symbol-indexer',
      });

      controller.abort();
      governor.reject(abortError());
      await expect(run).rejects.toMatchObject({ name: 'AbortError' });
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('fails open on a governor failure that is not an abort — warns once and indexes anyway', async () => {
      const governor = makeGovernor();
      const { service, fs, logger } = build(governor, fakeTsFiles(6));

      const run = service.indexWorkspace('/workspace', { batchSize: 3 });
      await flush();
      governor.reject(new Error('unexpected'));
      await flush();
      expect(fs.readFile).toHaveBeenCalledTimes(3);
      governor.reject(new Error('unexpected again'));

      await expect(run).resolves.toMatchObject({ filesScanned: 6 });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[CodeSymbolIndexer] background-work wait failed — indexing anyway',
        { reason: 'unexpected' },
      );
    });
  });

  describe('indexWorkspace — total failure surfaces an error', () => {
    it('throws when every discovered file errors and 0 symbols are produced', async () => {
      const files = fakeTsFiles(5);
      const logger = makeLogger();
      const fs = makeFs();
      const sink = makeSymbolSink();
      const indexer = makeIndexer(files);
      fs.readFile.mockResolvedValue('const x = 1;');

      // AST init dead (e.g. web-tree-sitter.wasm missing) — every parse errors.
      const ast = {
        analyzeSource: jest.fn().mockResolvedValue({
          isErr: () => true,
          error: new Error('web-tree-sitter.wasm not found'),
        }),
      } as unknown as jest.Mocked<AstAnalysisService>;

      const service = new CodeSymbolIndexer(logger, ast, indexer, fs, sink);

      await expect(service.indexWorkspace('/workspace')).rejects.toThrow(
        /all 5 files errored/,
      );
      expect(sink.insertSymbols).not.toHaveBeenCalled();
    });

    it('does NOT throw when at least one file produces a symbol', async () => {
      const files = fakeTsFiles(3);
      const logger = makeLogger();
      const fs = makeFs();
      const sink = makeSymbolSink();
      const indexer = makeIndexer(files);
      fs.readFile.mockResolvedValue('function foo() {}');

      // First file parses to a symbol; the rest error.
      let call = 0;
      const ast = {
        analyzeSource: jest.fn().mockImplementation(async () => {
          call++;
          return call === 1
            ? {
                isErr: () => false,
                value: {
                  functions: [{ name: 'foo', startLine: 1, endLine: 1 }],
                  classes: [],
                },
              }
            : { isErr: () => true, error: new Error('parse failed') };
        }),
      } as unknown as jest.Mocked<AstAnalysisService>;

      const service = new CodeSymbolIndexer(logger, ast, indexer, fs, sink);

      const stats = await service.indexWorkspace('/workspace', {
        batchSize: 1,
      });
      expect(stats.filesScanned).toBe(3);
      expect(stats.symbolsIndexed).toBe(1);
      expect(stats.errors).toBe(2);
    });
  });

  /**
   * TASK_2026_559 Batch 24b: the code index reports live coverage — what the
   * last full run analysed, and whether a run is updating the rows a search
   * reads right now — instead of claiming a snapshot of the SQLite rows.
   */
  describe('coverage — live index state (Batch 24b)', () => {
    const ROOT = '/workspace';
    const CODE_INDEX_LANGUAGES = [
      'typescript',
      'javascript',
      'tsx',
      'python',
      'go',
      'csharp',
      'java',
      'rust',
      'php',
      'ruby',
      'cpp',
    ];

    interface Entry {
      readonly path: string;
      readonly size?: number;
    }

    /** A discovery double that yields a fresh stream on every run. */
    function makeDiscovery(
      entries: readonly (string | Entry)[],
    ): jest.Mocked<WorkspaceIndexerService> {
      const normalized = entries.map((entry) =>
        typeof entry === 'string' ? { path: entry } : entry,
      );
      async function* gen() {
        for (const entry of normalized) {
          yield {
            path: entry.path,
            relativePath: entry.path,
            type: 'source' as const,
            size: entry.size ?? 100,
            estimatedTokens: 25,
          };
        }
      }
      return {
        indexWorkspaceStream: jest.fn(() => gen()),
      } as unknown as jest.Mocked<WorkspaceIndexerService>;
    }

    function okAst(): jest.Mocked<AstAnalysisService> {
      return {
        analyzeSource: jest.fn().mockResolvedValue({
          isErr: () => false,
          value: {
            functions: [{ name: 'f', startLine: 1, endLine: 1 }],
            classes: [],
            parseStatus: 'ok',
          },
        }),
      } as unknown as jest.Mocked<AstAnalysisService>;
    }

    function setup(
      entries: readonly (string | Entry)[],
      governor: BackgroundWorkAdmission | null = null,
    ) {
      const logger = makeLogger();
      const fs = makeFs();
      fs.readFile.mockResolvedValue('function f() {}');
      const sink = makeSymbolSink();
      const ast = okAst();
      const discovery = makeDiscovery(entries);
      const service = new CodeSymbolIndexer(
        logger,
        ast,
        discovery,
        fs,
        sink,
        governor,
      );
      return { service, logger, fs, sink, ast, discovery };
    }

    /** A governor that holds every background batch until released. */
    function holdingGovernor() {
      const waiters: Array<() => void> = [];
      const governor: BackgroundWorkAdmission = {
        isClear: () => false,
        whenClear: () =>
          new Promise<'clear' | 'timeout'>((resolve) =>
            waiters.push(() => resolve('clear')),
          ),
      } as unknown as BackgroundWorkAdmission;
      return {
        governor,
        releaseAll: () => waiters.splice(0).forEach((release) => release()),
      };
    }

    const settle = async (): Promise<void> => {
      for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };

    it('a new host session has no record: census unknown, no state, counts unknown', () => {
      const { service } = setup([]);

      const coverage = service.getCoverage(ROOT);

      expect(coverage.census).toBe('unknown');
      expect(coverage).not.toHaveProperty('state');
      expect(coverage.analyzed).toBeNull();
      expect(coverage.failed).toBeNull();
      expect(coverage.unsupported).toBeNull();
      expect(coverage.supportedLanguages).toEqual(CODE_INDEX_LANGUAGES);
    });

    it('search during a run reports updating, from the synchronous start of the run', async () => {
      const held = holdingGovernor();
      const { service } = setup(fakeTsFiles(3), held.governor);

      const run = service.indexWorkspace(ROOT, { batchSize: 3 });
      // No await yet: the run began before indexWorkspace returned.
      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'unknown',
        state: 'updating',
        analyzed: null,
      });
      await settle();
      expect(service.getCoverage(ROOT).state).toBe('updating');

      held.releaseAll();
      await run;
      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'complete',
        state: 'current',
        analyzed: 3,
      });
    });

    it('a successful run is current, with analysed, failed-by-reason and unsupported buckets', async () => {
      const { service, fs, ast, discovery } = setup([
        '/workspace/src/a.ts',
        '/workspace/src/unreadable.py',
        '/workspace/src/broken.go',
        { path: '/workspace/src/huge.cs', size: 2 * 1024 * 1024 },
        '/workspace/src/Main.kt',
        '/workspace/ios/App.swift',
        '/workspace/src/a.spec.ts',
      ]);
      fs.readFile.mockImplementation(async (file: string) => {
        if (file.endsWith('unreadable.py')) throw new Error('EACCES');
        return 'source';
      });
      ast.analyzeSource.mockImplementation(async (_content, language) =>
        language === 'go'
          ? ({ isErr: () => true, error: new Error('bad') } as never)
          : ({
              isErr: () => false,
              value: { functions: [], classes: [], parseStatus: 'ok' },
            } as never),
      );

      await service.indexWorkspace(ROOT);

      const coverage = service.getCoverage(ROOT);
      expect(coverage).toEqual({
        clean: false,
        reasons: ['unrecognised?', 'failed', 'unsupported'],
        supportedLanguages: CODE_INDEX_LANGUAGES,
        census: 'complete',
        state: 'current',
        analyzed: 1,
        unchecked: 0,
        failed: 3,
        unsupported: 2,
        unrecognised: null,
        nonSource: null,
        excluded: null,
        omittedByCap: 0,
        unsupportedByLanguage: { kotlin: 1, swift: 1 },
        failedByReason: { read: 1, parse: 1, 'too-large': 1 },
      });
      // The over-size file is counted, never read.
      expect(fs.readFile).not.toHaveBeenCalledWith('/workspace/src/huge.cs');
      // Discovery asks for the recognised-unsupported extensions too, and
      // for every size, so none is dropped without a count.
      const request = discovery.indexWorkspaceStream.mock.calls[0][0];
      expect(request?.includePatterns).toEqual(
        expect.arrayContaining([
          '**/*.ts',
          '**/*.csx',
          '**/*.kt',
          '**/*.swift',
        ]),
      );
      expect(request?.maxFileSize).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('applies the skip filter before the eligible-only cap', async () => {
      const { service, fs } = setup([
        '/workspace/src/a.spec.ts',
        '/workspace/src/b.spec.ts',
        '/workspace/src/index.ts',
        '/workspace/src/one.ts',
        '/workspace/src/two.ts',
      ]);

      const stats = await service.indexWorkspace(ROOT, { maxFilesPerRun: 2 });

      expect(stats.filesScanned).toBe(2);
      expect(fs.readFile).toHaveBeenCalledWith('/workspace/src/one.ts');
      expect(fs.readFile).toHaveBeenCalledWith('/workspace/src/two.ts');
      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'complete',
        analyzed: 2,
        omittedByCap: 0,
      });
    });

    it('past the eligible cap the census is truncated and the omitted count unknown', async () => {
      const { service } = setup(fakeTsFiles(3));

      await service.indexWorkspace(ROOT, { maxFilesPerRun: 2 });

      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'truncated',
        censusLimit: 2,
        state: 'current',
        analyzed: 2,
        omittedByCap: null,
      });
    });

    it('search after an aborted run reports incomplete, and a per-file reindex never promotes it', async () => {
      const files = fakeTsFiles(9);
      const { service, fs } = setup(files);
      const controller = new AbortController();
      let reads = 0;
      fs.readFile.mockImplementation(async () => {
        reads++;
        if (reads === 3) controller.abort();
        return 'function f() {}';
      });

      await expect(
        service.indexWorkspace(ROOT, {
          batchSize: 3,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'complete',
        state: 'incomplete',
        analyzed: 3,
        unchecked: 6,
      });

      await service.reindexFile(files[5], ROOT);
      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'incomplete',
        analyzed: 4,
        unchecked: 5,
      });

      await service.indexWorkspace(ROOT);
      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'current',
        analyzed: 9,
        unchecked: 0,
      });
    });

    it('a run that fails outright ends incomplete', async () => {
      const { service, ast } = setup(fakeTsFiles(2));
      ast.analyzeSource.mockResolvedValue({
        isErr: () => true,
        error: new Error('wasm missing'),
      } as never);

      await expect(service.indexWorkspace(ROOT)).rejects.toThrow(
        /all 2 files errored/,
      );
      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'incomplete',
        failed: 2,
        failedByReason: { parse: 2 },
      });
    });

    it('a per-file reindex outside any run never creates a census', async () => {
      const { service, sink } = setup([]);

      await service.reindexFile('/workspace/src/a.ts', ROOT);

      expect(sink.insertSymbols).toHaveBeenCalledTimes(1);
      const coverage = service.getCoverage(ROOT);
      expect(coverage.census).toBe('unknown');
      expect(coverage).not.toHaveProperty('state');
    });

    it('same-file overlap: a per-file reindex racing the run write of that file is serialised and counted once', async () => {
      const { service, fs, sink } = setup([
        '/workspace/src/a.ts',
        '/workspace/src/b.ts',
      ]);
      const events: string[] = [];
      sink.deleteSymbolsForFile.mockImplementation((file: string) => {
        events.push(`delete ${file}`);
        return 0;
      });
      sink.insertSymbols.mockImplementation(async (chunks) => {
        events.push(`insert ${chunks[0]?.filePath ?? ''}`);
      });
      let releaseRunRead!: () => void;
      let readsOfA = 0;
      fs.readFile.mockImplementation(async (file: string) => {
        if (file.endsWith('/a.ts')) {
          readsOfA++;
          if (readsOfA === 1) {
            await new Promise<void>((resolve) => (releaseRunRead = resolve));
            return 'function f() {}';
          }
          // The per-file reindex read happens after the run's write and
          // finds the file broken now.
          throw new Error('ENOENT');
        }
        return 'function f() {}';
      });

      const run = service.indexWorkspace(ROOT, { batchSize: 1 });
      await settle();
      const perFile = service.reindexFile('/workspace/src/a.ts', ROOT);
      await settle();
      // The per-file write waits for the run's write of the same file.
      expect(readsOfA).toBe(1);

      releaseRunRead();
      await Promise.all([run, perFile]);

      expect(events.slice(0, 2)).toEqual([
        'delete /workspace/src/a.ts',
        'insert /workspace/src/a.ts',
      ]);
      expect(readsOfA).toBe(2);
      // Folded into the run's accounting: the last write of a.ts (the failed
      // per-file read) wins, and a.ts is counted once.
      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'current',
        analyzed: 1,
        failed: 1,
        failedByReason: { read: 1 },
        unchecked: 0,
      });
    });

    it('the 2,001st distinct per-file update truncates the census instead of growing the record', async () => {
      const { service } = setup(['/workspace/src/seed.ts']);
      await service.indexWorkspace(ROOT);

      for (let i = 0; i < 2000; i++) {
        await service.reindexFile(`/workspace/gen/f${i}.ts`, ROOT);
      }
      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'complete',
        analyzed: 2001,
      });

      await service.reindexFile('/workspace/gen/f2000.ts', ROOT);
      // An already-tracked file still updates in place.
      await service.reindexFile('/workspace/gen/f0.ts', ROOT);

      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'truncated',
        state: 'current',
        analyzed: 2001,
      });
    });

    it('keys the record by the path identity of the root', async () => {
      const { service } = setup(fakeTsFiles(1));

      await service.indexWorkspace('/workspace/');

      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'current',
        analyzed: 1,
      });
    });

    it('a run superseded by a newer run never publishes its state', async () => {
      const held = holdingGovernor();
      const { service } = setup(fakeTsFiles(2), held.governor);

      const older = service.indexWorkspace(ROOT);
      await settle();
      const newer = service.indexWorkspace(ROOT, { userInitiated: true });
      await newer;
      // r1 S1: the superseded run is still going to write, so not current.
      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'updating',
        analyzed: 2,
      });

      held.releaseAll();
      await older;
      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'current',
        analyzed: 2,
        unchecked: 0,
      });
    });

    // ---- Revision round 1 (r1 REVISE 4/10) --------------------------------

    it('r1 S1: a pending per-file write after a current run reports updating until it lands', async () => {
      const { service, sink } = setup(['/workspace/src/a.ts']);
      await service.indexWorkspace(ROOT);
      let releaseInsert!: () => void;
      sink.insertSymbols.mockImplementation(
        () => new Promise<void>((resolve) => (releaseInsert = resolve)),
      );

      const perFile = service.reindexFile('/workspace/src/a.ts', ROOT);
      await settle();
      // Deleted, not yet re-inserted: a search now can miss the symbol.
      expect(sink.deleteSymbolsForFile).toHaveBeenCalledTimes(2);
      expect(service.getCoverage(ROOT)).toMatchObject({
        clean: false,
        state: 'updating',
        analyzed: 1,
      });

      releaseInsert();
      await perFile;
      expect(service.getCoverage(ROOT).state).toBe('current');
    });

    it('r1 B2: invalidateCoverage (a purge) turns a current index incomplete until a new full run', async () => {
      const { service } = setup(fakeTsFiles(2));
      await service.indexWorkspace(ROOT);

      service.invalidateCoverage(`${ROOT}/`);
      expect(service.getCoverage(ROOT)).toMatchObject({
        clean: false,
        state: 'incomplete',
      });
      await service.reindexFile(fakeTsFiles(1)[0], ROOT);
      expect(service.getCoverage(ROOT).state).toBe('incomplete');

      await service.indexWorkspace(ROOT);
      expect(service.getCoverage(ROOT).state).toBe('current');
    });

    it('r1 B2: a run in progress when rows are purged ends incomplete, not current', async () => {
      const held = holdingGovernor();
      const { service } = setup(fakeTsFiles(2), held.governor);

      const run = service.indexWorkspace(ROOT);
      await settle();
      service.invalidateCoverage(ROOT);
      held.releaseAll();
      await run;

      expect(service.getCoverage(ROOT)).toMatchObject({
        state: 'incomplete',
        analyzed: 2,
      });
    });

    it('r1 B2: a purge of a root with no record leaves it unknown', () => {
      const { service } = setup([]);
      service.invalidateCoverage(ROOT);
      expect(service.getCoverage(ROOT)).toMatchObject({ census: 'unknown' });
      expect(service.getCoverage(ROOT)).not.toHaveProperty('state');
    });

    it('r1 S2: a discovered file that cannot be statted (EPERM) counts as failed read — real discovery stream', async () => {
      const locked = Object.assign(new Error('Failed to stat'), {
        cause: Object.assign(new Error('EPERM: operation not permitted'), {
          code: 'EPERM',
        }),
      });
      const fileSystemService = {
        stat: jest.fn(async (filePath: string) => {
          if (filePath.endsWith('locked.ts')) throw locked;
          return { size: 10, type: 1, ctime: 0, mtime: 0 };
        }),
        readFile: jest.fn(),
      };
      const fsProvider = makeFs();
      fsProvider.findFiles.mockResolvedValue([
        '/workspace/src/good.ts',
        '/workspace/src/locked.ts',
      ]);
      fsProvider.exists.mockResolvedValue(false);
      fsProvider.readFile.mockResolvedValue('function f() {}');
      const discovery = new WorkspaceIndexerService(
        fileSystemService as never,
        { matchFiles: jest.fn(() => []) } as never,
        {
          parseWorkspaceIgnoreFiles: jest.fn(async () => []),
          isIgnored: jest.fn(async () => ({ ignored: false })),
        } as never,
        { classifyFile: jest.fn(() => ({ type: 'source' })) } as never,
        { countTokens: jest.fn() } as never,
        fsProvider,
        makeLogger(),
      );
      const service = new CodeSymbolIndexer(
        makeLogger(),
        okAst(),
        discovery,
        fsProvider,
        makeSymbolSink(),
      );

      await service.indexWorkspace(ROOT);

      expect(service.getCoverage(ROOT)).toMatchObject({
        census: 'complete',
        state: 'current',
        analyzed: 1,
        failed: 1,
        failedByReason: { read: 1 },
        unchecked: 0,
      });
    });

    it('r1 S3: a recovered parse counts failed/parse (its partial symbols still written); an unknown parse is unchecked', async () => {
      const { service, ast, sink } = setup([
        '/workspace/src/broken.ts',
        '/workspace/src/odd.ts',
        '/workspace/src/fine.ts',
      ]);
      ast.analyzeSource.mockImplementation(
        async (_content, _language, file) =>
          ({
            isErr: () => false,
            value: {
              functions: [{ name: 'f', startLine: 1, endLine: 1 }],
              classes: [],
              parseStatus: String(file).endsWith('broken.ts')
                ? 'recovered'
                : String(file).endsWith('odd.ts')
                  ? 'unknown'
                  : 'ok',
              errorNodeCount: String(file).endsWith('broken.ts') ? 1 : 0,
            },
          }) as never,
      );

      await service.indexWorkspace(ROOT);

      expect(sink.insertSymbols).toHaveBeenCalledTimes(3);
      expect(service.getCoverage(ROOT)).toMatchObject({
        clean: false,
        analyzed: 1,
        failed: 1,
        failedByReason: { parse: 1 },
        unchecked: 1,
      });
    });

    // ---- Revision round 2 (r2 REVISE 6/10) --------------------------------

    it('r2 B1: a single-file reindex carries its own coverage — recovered is failed/parse, unknown is unchecked, a skipped file is excluded', async () => {
      const { service, ast } = setup([]);
      const quality = (parseStatus: string) =>
        ast.analyzeSource.mockResolvedValueOnce({
          isErr: () => false,
          value: { functions: [], classes: [], parseStatus },
        } as never);

      quality('recovered');
      const recovered = await service.reindexFile('/workspace/src/b.ts', ROOT);
      expect(recovered).toMatchObject({
        errors: 1,
        coverage: {
          clean: false,
          reasons: ['failed'],
          census: 'complete',
          analyzed: 0,
          failed: 1,
          failedByReason: { parse: 1 },
        },
      });
      expect(Object.keys(recovered)[0]).toBe('coverage');

      quality('unknown');
      const unknown = await service.reindexFile('/workspace/src/c.ts', ROOT);
      expect(unknown).toMatchObject({
        errors: 0,
        coverage: { clean: false, reasons: ['unchecked'], unchecked: 1 },
      });

      quality('ok');
      const ok = await service.reindexFile('/workspace/src/d.ts', ROOT);
      expect(ok.coverage).toMatchObject({ clean: true, analyzed: 1 });

      const skipped = await service.reindexFile(
        '/workspace/src/a.spec.ts',
        ROOT,
      );
      expect(skipped.coverage).toMatchObject({
        clean: false,
        reasons: ['excluded'],
        excluded: 1,
      });
    });

    it('r2 M1: a write pending before the first run keeps that run updating until it lands', async () => {
      const { service, sink, fs } = setup(['/workspace/src/b.ts']);
      let releaseInsert!: () => void;
      sink.insertSymbols.mockImplementationOnce(
        () => new Promise<void>((resolve) => (releaseInsert = resolve)),
      );
      fs.readFile.mockResolvedValue('function f() {}');

      const manual = service.reindexFile('/workspace/build/manual.ts', ROOT);
      await settle();
      await service.indexWorkspace(ROOT);

      expect(service.getCoverage(ROOT)).toMatchObject({
        clean: false,
        state: 'updating',
      });

      releaseInsert();
      await manual;
      expect(service.getCoverage(ROOT).state).toBe('current');
    });
  });
});
