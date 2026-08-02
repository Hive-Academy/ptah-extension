/**
 * Null implementations of the memory ports.
 *
 * Hosts without a memory subsystem (no SQLite, no embedder worker) still have
 * always-on consumers that inject these tokens — `MemoryPromptInjector` and
 * `CodeSymbolIndexerService`. They register these no-ops instead, which keeps
 * the "missing capability" decision in one place next to the contract rather
 * than re-inlined per host.
 *
 * Stateless and immutable, so a single frozen instance is shared.
 */

import type { IMemoryLister, IMemoryReader } from './memory-reader.port';
import type { ISymbolSink } from './symbol-sink.port';

/** Recalls nothing. `bm25Only` is true — there is no vector index to consult. */
export const NullMemoryReader: IMemoryReader = Object.freeze({
  search: async () => ({ hits: [], bm25Only: true }),
});

/** Lists nothing. */
export const NullMemoryLister: IMemoryLister = Object.freeze({
  listAll: () => ({ memories: [], total: 0 }),
});

/** Swallows symbol chunks; nothing is persisted and nothing was deleted. */
export const NullSymbolSink: ISymbolSink = Object.freeze({
  deleteSymbolsForFile: () => 0,
  insertSymbols: async () => undefined,
});
