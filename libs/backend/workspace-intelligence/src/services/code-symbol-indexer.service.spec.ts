// libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts
// Tests for CodeSymbolIndexer AbortSignal cooperative cancellation

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { ISymbolSink } from '@ptah-extension/memory-contracts';
import type { AstAnalysisService } from '../ast/ast-analysis.service';
import type { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import type { BackgroundWorkAdmission } from '@ptah-extension/vscode-core';
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
});
