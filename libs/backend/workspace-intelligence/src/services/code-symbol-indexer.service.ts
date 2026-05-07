// libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts
// TASK_2026_THOTH_CODE_INDEX

import * as path from 'path';
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

    let totalSymbols = 0;
    let totalErrors = 0;

    // Process files in batches with setImmediate() yields between batches
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);

      for (const filePath of batch) {
        const stats = await this._indexFile(filePath, workspaceRoot);
        totalSymbols += stats.symbolsIndexed;
        totalErrors += stats.errors;
      }

      // Yield between batches to avoid stalling the event loop
      if (i + batchSize < filePaths.length) {
        await yieldToEventLoop();
      }
    }

    const durationMs = Date.now() - startMs;
    this.logger.info('[CodeSymbolIndexer] Workspace indexing complete', {
      filesScanned: filePaths.length,
      symbolsIndexed: totalSymbols,
      errors: totalErrors,
      durationMs,
    });

    return {
      filesScanned: filePaths.length,
      symbolsIndexed: totalSymbols,
      errors: totalErrors,
      durationMs,
    };
  }

  /**
   * Re-index a single file (called on file save events).
   * Non-fatal — errors are logged as warnings.
   */
  async reindexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
  ): Promise<void> {
    try {
      await this._indexFile(absoluteFilePath, workspaceRoot);
    } catch (error: unknown) {
      this.logger.warn('[CodeSymbolIndexer] reindexFile failed (non-fatal)', {
        file: absoluteFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Index a single file: parse AST, delete stale symbols, insert new ones.
   * Returns per-file stats.
   */
  private async _indexFile(
    absoluteFilePath: string,
    workspaceRoot: string,
  ): Promise<FileStats> {
    const ext = path.extname(absoluteFilePath);
    const language = extensionToLanguage(ext);

    // Silently skip files with unsupported extensions
    if (!language) {
      return { symbolsIndexed: 0, errors: 0 };
    }

    let content: string;
    try {
      content = await this.fs.readFile(absoluteFilePath);
    } catch (error: unknown) {
      this.logger.warn('[CodeSymbolIndexer] Could not read file (non-fatal)', {
        file: absoluteFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { symbolsIndexed: 0, errors: 1 };
    }

    const result = await this.astAnalysis.analyzeSource(
      content,
      language,
      absoluteFilePath,
    );

    const insights = result.value;
    if (result.isErr() || insights === undefined) {
      this.logger.warn(
        '[CodeSymbolIndexer] AST analysis failed for file (non-fatal)',
        {
          file: absoluteFilePath,
          error: result.error?.message ?? 'Unknown error',
        },
      );
      return { symbolsIndexed: 0, errors: 1 };
    }

    const relPath = path.relative(workspaceRoot, absoluteFilePath);

    // Clear stale symbols for this file before re-inserting
    this.sink.deleteSymbolsForFile(absoluteFilePath, workspaceRoot);

    const chunks: SymbolChunkInsert[] = [];

    // Index functions
    for (const fn of insights.functions) {
      const name = fn.name;
      const startLine = fn.startLine ?? 0;
      const endLine = fn.endLine ?? startLine;
      const text = `function ${name} in ${relPath}:${startLine}-${endLine}`;
      chunks.push({
        subject: `code:function:${absoluteFilePath}:${name}`,
        text,
        tokenCount: Math.ceil(text.length / 4),
        filePath: absoluteFilePath,
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
        subject: `code:class:${absoluteFilePath}:${className}`,
        text: classText,
        tokenCount: Math.ceil(classText.length / 4),
        filePath: absoluteFilePath,
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
            subject: `code:method:${absoluteFilePath}:${className}.${methodName}`,
            text: methodText,
            tokenCount: Math.ceil(methodText.length / 4),
            filePath: absoluteFilePath,
            workspaceRoot,
          });
        }
      }
    }

    if (chunks.length > 0) {
      await this.sink.insertSymbols(chunks);
    }

    return { symbolsIndexed: chunks.length, errors: 0 };
  }
}
