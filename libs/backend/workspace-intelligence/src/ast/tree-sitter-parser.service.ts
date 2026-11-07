/**
 * The injectable tree-sitter parser every host resolves under
 * `TOKENS.TREE_SITTER_PARSER_SERVICE`.
 *
 * All parsing logic lives in {@link TreeSitterEngine}. When the host
 * registers a tree-sitter worker factory (Electron), `parse`, `query` (and so
 * `queryFunctions`/`queryClasses`/`queryImports`/`queryExports`) and
 * `queryMulti` run in that worker, because web-tree-sitter's WASM work is
 * synchronous and a single query on a large file blocked the Electron main
 * loop for over a second. Results keep the same shapes and `Result`
 * contract. Without a factory (VS Code, CLI) the engine runs in-process.
 *
 * `options.priority` orders worker requests (`TreeSitterRequestOptions`).
 * `isRuntimeUnavailable`/`runtimeRetryInMs` include the worker's cooldown.
 *
 * Inputs the engine refuses or answers without WASM (empty `queryMulti`
 * content, sources over `MAX_PARSE_BYTES`) are answered here, so they are
 * never copied to the worker. The incremental tree cache
 * (`parseAndCache`/`parseIncremental`) holds live trees and stays in-process.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Result } from '@ptah-extension/shared';
import type { SupportedLanguage } from './tree-sitter.config';
import type { GenericAstNode } from './ast.types';
import { exceedsParseLimit } from './parser-refusal';
import type { TreeSitterRequestOptions } from './tree-sitter-request-options';
import {
  TreeSitterEngine,
  type QueryMatch,
  type QueryResults,
  type TreeSitterLogger,
} from './tree-sitter-engine';
import { TreeSitterWorkerClient } from './worker/tree-sitter-worker.client';
import type { ITreeSitterWorkerFactory } from './worker/tree-sitter-worker.port';
import { WORKSPACE_INTELLIGENCE_TOKENS } from '../di/tokens';

export {
  TREE_SITTER_RETRY_INITIAL_MS,
  TREE_SITTER_RETRY_MAX_MS,
  type EditDelta,
  type QueryCapture,
  type QueryMatch,
} from './tree-sitter-engine';

@injectable()
export class TreeSitterParserService extends TreeSitterEngine {
  private readonly worker: TreeSitterWorkerClient | null;

  constructor(
    // The host `Logger`, typed by the surface the engine uses.
    @inject(TOKENS.LOGGER) logger: TreeSitterLogger,
    @inject(WORKSPACE_INTELLIGENCE_TOKENS.TREE_SITTER_WORKER_FACTORY, {
      isOptional: true,
    })
    workerFactory: ITreeSitterWorkerFactory | null = null,
  ) {
    super(logger);
    this.worker = workerFactory
      ? new TreeSitterWorkerClient(workerFactory, logger)
      : null;
    if (this.worker) {
      logger.info('TreeSitterParserService parses in the tree-sitter worker.');
    }
  }

  /**
   * Also true while the worker client is in its fail-fast cooldown, so the
   * code-symbol indexer and AST analysis take their skip-and-retry path
   * during a worker outage instead of failing file after file.
   */
  override isRuntimeUnavailable(): boolean {
    return (
      super.isRuntimeUnavailable() || (this.worker?.unavailableForMs() ?? 0) > 0
    );
  }

  override runtimeRetryInMs(): number {
    return Math.max(
      super.runtimeRetryInMs(),
      this.worker?.unavailableForMs() ?? 0,
    );
  }

  override async parse(
    content: string,
    language: SupportedLanguage,
    options?: TreeSitterRequestOptions,
  ): Promise<Result<GenericAstNode, Error>> {
    if (!this.worker || exceedsParseLimit(content)) {
      return super.parse(content, language);
    }
    return this.worker.parse(content, language, options);
  }

  override async query(
    content: string,
    language: SupportedLanguage,
    queryString: string,
    options?: TreeSitterRequestOptions,
  ): Promise<Result<QueryMatch[], Error>> {
    if (!this.worker || exceedsParseLimit(content)) {
      return super.query(content, language, queryString);
    }
    return this.worker.query(content, language, queryString, options);
  }

  override async queryMulti(
    content: string,
    language: SupportedLanguage,
    queries: { key: string; queryString: string }[],
    options?: TreeSitterRequestOptions,
  ): Promise<Result<QueryResults, Error>> {
    if (!this.worker || !content || exceedsParseLimit(content)) {
      return super.queryMulti(content, language, queries);
    }
    return this.worker.queryMulti(content, language, queries, options);
  }

  /** Frees the in-process WASM state and stops the worker, if any. */
  override dispose(): void {
    super.dispose();
    this.worker?.terminate();
  }
}
