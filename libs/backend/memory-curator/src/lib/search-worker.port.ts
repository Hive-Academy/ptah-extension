import type { MemorySearchResponse } from './memory.types';
import type { CodeSymbolHitPage } from '@ptah-extension/memory-contracts';
import type { MemoryListPage } from '@ptah-extension/memory-contracts';
import type { MemoryChunk } from './memory.types';
import type { CodeSymbolSearchParams, CodeSymbolSearchResult } from './code-symbol.store';

export interface ISearchWorkerProcess {
  postMessage(message: unknown): void;
  on(event: 'message', callback: (message: unknown) => void): void;
  on(event: 'exit', callback: (code: number | null) => void): void;
  kill(): void;
}

/** Database the search worker opens read-only. */
export interface SearchWorkerDatabaseConfig {
  readonly dbPath: string;
  /** sqlite-vec loadable path; absent means the worker searches lexically only. */
  readonly vecPath?: string;
}

/** Host implementation that forks the search worker process. */
export interface ISearchWorkerFactory {
  spawn(): ISearchWorkerProcess;
  /** Read at every spawn, so a vec path resolved after boot is picked up by a respawn. */
  databaseConfig(): SearchWorkerDatabaseConfig;
}

export interface ISqliteSearchWorker {
  searchMemory(query: string, topK: number, workspaceRoot?: string | null, deadlineMs?: number): Promise<MemorySearchResponse>;
  searchSymbols(query: string, topK: number, workspaceRoot?: string): Promise<CodeSymbolHitPage>;
  searchSymbolPage(params: CodeSymbolSearchParams, deadlineMs?: number): Promise<CodeSymbolSearchResult>;
  listMemories(workspaceRoot: string, limit: number): Promise<MemoryListPage>;
  getChunks(memoryId: string): Promise<readonly MemoryChunk[]>;
}
