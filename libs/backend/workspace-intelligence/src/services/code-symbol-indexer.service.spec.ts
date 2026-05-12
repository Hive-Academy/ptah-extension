// libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts
// TASK_2026_114: Tests for CodeSymbolIndexer AbortSignal cooperative cancellation

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { ISymbolSink } from '@ptah-extension/memory-contracts';
import type { AstAnalysisService } from '../ast/ast-analysis.service';
import type { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
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
});
