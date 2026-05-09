// libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts
// TASK_2026_THOTH_CODE_INDEX

import * as path from 'path';
import picomatch from 'picomatch';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type ISymbolSink,
  type SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import type { SupportedLanguage } from '../ast/ast.types';

export interface CodeSymbolIndexerOptions {
  /** File extensions to index. Default: ['.ts', '.tsx', '.js', '.jsx'] */
  extensions?: string[];
  /** Number of files to process per batch before yielding. Default: 20 */
  batchSize?: number;
  /** Maximum total files to process per run. Default: 2000 */
  maxFilesPerRun?: number;
}

export interface IndexingStats {
  filesScanned: number;
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_FILES = 2000;

const DEFAULT_SKIP_PATTERNS = [
  'jest.config.*',
  'jest.setup.*',
  'jest-setup.*',
  'vitest.config.*',
  'webpack.config.*',
  'rollup.config.*',
  'vite.config.*',
  'esbuild.config.*',
  'babel.config.*',
  '.eslintrc.*',
  'tsconfig*.ts',
  '*.d.ts',
  '*.spec.ts',
  '*.spec.tsx',
  '*.spec.js',
  '*.spec.jsx',
  '*.test.ts',
  '*.test.tsx',
  '*.test.js',
  '*.test.jsx',
  '*.module.ts',
  '*.module.js',
  // Note: index.ts barrels occasionally define inline symbols — remove if false-positive skipping is reported
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'public-api.ts',
];
const SKIP_MATCHER = picomatch(DEFAULT_SKIP_PATTERNS, { nocase: true });
function shouldSkipFile(absoluteFilePath: string): boolean {
  return SKIP_MATCHER(path.basename(absoluteFilePath));
}

/**
 * Maps a file extension to the tree-sitter SupportedLanguage.
 */
function extensionToLanguage(ext: string): SupportedLanguage | null {
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
      return 'javascript';
    default:
      return null;
  }
}

/**
 * Yields control to the event loop so that long indexing runs do not stall
 * the Electron main process or VS Code extension host.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

interface FileStats {
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
}

@injectable()
export class CodeSymbolIndexer {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,
    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK)
    private readonly sink: ISymbolSink,
  ) {}

  /**
   * Index all matching files in the workspace.
   * Uses setImmediate() between batches to avoid stalling the event loop.
   */
  async indexWorkspace(
    workspaceRoot: string,
    options?: CodeSymbolIndexerOptions,
  ): Promise<IndexingStats> {
    if (!workspaceRoot) {
      this.logger.warn(
        '[CodeSymbolIndexer] indexWorkspace called with empty workspaceRoot — skipping',
      );
      return { filesScanned: 0, symbolsIndexed: 0, errors: 0, durationMs: 0 };
    }

    const startMs = Date.now();
    const extensions = options?.extensions ?? [...DEFAULT_EXTENSIONS];
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const maxFilesPerRun = options?.maxFilesPerRun ?? DEFAULT_MAX_FILES;

    // Collect file paths up to maxFilesPerRun
    const filePaths: string[] = [];
    const includePatterns = extensions.map((ext) => `**/*${ext}`);

    try {
      const stream = this.indexer.indexWorkspaceStream({
        includePatterns,
        respectIgnoreFiles: true,
        workspaceFolder: workspaceRoot,
      });

      for await (const file of stream) {
        filePaths.push(file.path);
        if (filePaths.length >= maxFilesPerRun) {
          break;
        }
      }
    } catch (error: unknown) {
      this.logger.warn('[CodeSymbolIndexer] Error during file discovery', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        filesScanned: 0,
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
      };
    }

    const filteredPaths = filePaths.filter((p) => !shouldSkipFile(p));

    let totalSymbols = 0;
    let totalErrors = 0;

    // Process files in batches with setImmediate() yields between batches
    for (let i = 0; i < filteredPaths.length; i += batchSize) {
      const batch = filteredPaths.slice(i, i + batchSize);

      for (const filePath of batch) {
        const stats = await this._indexFile(filePath, workspaceRoot);
        totalSymbols += stats.symbolsIndexed;
        totalErrors += stats.errors;
      }

      // Yield between batches to avoid stalling the event loop
      if (i + batchSize < filteredPaths.length) {
        await yieldToEventLoop();
      }
    }

    const durationMs = Date.now() - startMs;
    this.logger.info('[CodeSymbolIndexer] Workspace indexing complete', {
      filesScanned: filteredPaths.length,
      symbolsIndexed: totalSymbols,
      errors: totalErrors,
      durationMs,
    });

    return {
      filesScanned: filteredPaths.length,
      symbolsIndexed: totalSymbols,
      errors: totalErrors,
      durationMs,
    };
  }

  /**
   * Re-index a single file (called on file save events).
   * Returns per-file stats including a durationMs measurement.
   * Non-fatal — errors are logged as warnings and reflected in returned stats.
   */
  async reindexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
  ): Promise<{ symbolsIndexed: number; errors: number; durationMs: number }> {
    if (shouldSkipFile(absoluteFilePath)) {
      this.logger.debug?.(
        `[CodeSymbolIndexer] reindexFile skipped (matches skip pattern): ${path.basename(absoluteFilePath)}`,
      );
      return { symbolsIndexed: 0, errors: 0, durationMs: 0 };
    }
    const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/');
    const startMs = Date.now();
    try {
      const stats = await this._indexFile(normalizedFilePath, workspaceRoot);
      return stats;
    } catch (error: unknown) {
      this.logger.warn('[CodeSymbolIndexer] reindexFile failed (non-fatal)', {
        file: normalizedFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { symbolsIndexed: 0, errors: 1, durationMs: Date.now() - startMs };
    }
  }

  /**
   * Index a single file: parse AST, delete stale symbols, insert new ones.
   * Returns per-file stats including durationMs.
   *
   * `absoluteFilePath` must already be normalized to forward slashes before
   * calling this method (callers are responsible for normalization).
   */
  private async _indexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
  ): Promise<FileStats> {
    const startMs = Date.now();

    // Normalize path separators to forward slashes for consistent SQLite subject keys
    // across Windows and Unix — prevents stale entries when paths are compared.
    const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/');

    const ext = path.extname(normalizedFilePath);
    const language = extensionToLanguage(ext);

    // Silently skip files with unsupported extensions
    if (!language) {
      return { symbolsIndexed: 0, errors: 0, durationMs: Date.now() - startMs };
    }

    let content: string;
    try {
      content = await this.fs.readFile(normalizedFilePath);
    } catch (error: unknown) {
      this.logger.warn('[CodeSymbolIndexer] Could not read file (non-fatal)', {
        file: normalizedFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { symbolsIndexed: 0, errors: 1, durationMs: Date.now() - startMs };
    }

    const result = await this.astAnalysis.analyzeSource(
      content,
      language,
      normalizedFilePath,
    );

    // Fix 5: check isErr() BEFORE accessing result.value to avoid crashing
    // if the Result implementation throws on .value when in error state.
    if (result.isErr()) {
      this.logger.warn(
        `[CodeSymbolIndexer] AST parse failed for ${normalizedFilePath}: ${result.error?.message ?? 'Unknown error'}`,
      );
      return { symbolsIndexed: 0, errors: 1, durationMs: Date.now() - startMs };
    }
    const insights = result.value;
    if (insights === undefined) {
      return { symbolsIndexed: 0, errors: 1, durationMs: Date.now() - startMs };
    }

    const relPath = path.relative(workspaceRoot, normalizedFilePath);

    // Clear stale symbols for this file before re-inserting (minor: log count)
    try {
      const deletedCount = this.sink.deleteSymbolsForFile(
        normalizedFilePath,
        workspaceRoot,
      );
      if (deletedCount > 0) {
        this.logger.debug?.(
          `[CodeSymbolIndexer] Cleared ${deletedCount} stale entries for ${normalizedFilePath}`,
        );
      }
    } catch (err: unknown) {
      return {
        symbolsIndexed: 0,
        errors: 1,
        durationMs: Date.now() - startMs,
      };
    }

    const chunks: SymbolChunkInsert[] = [];

    // Index functions
    for (const fn of insights.functions) {
      const name = fn.name;
      const startLine = fn.startLine ?? 0;
      const endLine = fn.endLine ?? startLine;
      const text = `function ${name} in ${relPath}:${startLine}-${endLine}`;
      chunks.push({
        subject: `code:function:${normalizedFilePath}:${name}`,
        text,
        tokenCount: Math.ceil(text.length / 4),
        filePath: normalizedFilePath,
        workspaceRoot,
      });
    }

    // Index classes and their methods
    for (const cls of insights.classes) {
      const className = cls.name;
      const classStartLine = cls.startLine ?? 0;
      const classEndLine = cls.endLine ?? classStartLine;
      const classText = `class ${className} in ${relPath}:${classStartLine}-${classEndLine}`;
      chunks.push({
        subject: `code:class:${normalizedFilePath}:${className}`,
        text: classText,
        tokenCount: Math.ceil(classText.length / 4),
        filePath: normalizedFilePath,
        workspaceRoot,
      });

      // Index methods within the class
      if (cls.methods) {
        for (const method of cls.methods) {
          const methodName = method.name;
          const methodStartLine = method.startLine ?? 0;
          const methodEndLine = method.endLine ?? methodStartLine;
          const methodText = `method ${className}.${methodName} in ${relPath}:${methodStartLine}-${methodEndLine}`;
          chunks.push({
            subject: `code:method:${normalizedFilePath}:${className}.${methodName}`,
            text: methodText,
            tokenCount: Math.ceil(methodText.length / 4),
            filePath: normalizedFilePath,
            workspaceRoot,
          });
        }
      }
    }

    if (chunks.length > 0) {
      // Fix 6: wrap insertSymbols in its own try/catch so a failed insert after
      // a successful delete is clearly diagnosed (symbols are gone, re-index recovers).
      try {
        await this.sink.insertSymbols(chunks);
      } catch (insertError: unknown) {
        const msg =
          insertError instanceof Error
            ? insertError.message
            : String(insertError);
        this.logger.warn(
          `[CodeSymbolIndexer] Symbols deleted but insert failed for ${normalizedFilePath}: ${msg}. Re-index this file to recover.`,
        );
        return {
          symbolsIndexed: 0,
          errors: 1,
          durationMs: Date.now() - startMs,
        };
      }
    }

    return {
      symbolsIndexed: chunks.length,
      errors: 0,
      durationMs: Date.now() - startMs,
    };
  }
}
