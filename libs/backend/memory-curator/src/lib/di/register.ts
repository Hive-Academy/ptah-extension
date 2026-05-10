/**
 * Memory Curator DI Registration (TASK_2026_HERMES Track 1).
 *
 * Registration order:
 *   1. EmbedderWorkerClient (concrete IEmbedder) under PERSISTENCE_TOKENS.EMBEDDER
 *   2. SalienceScorer
 *   3. MemoryStore (depends on EMBEDDER)
 *   4. MemorySearchService (depends on EMBEDDER, MEMORY_STORE)
 *   5. MemoryDecayJob (depends on MEMORY_STORE, SCORER)
 *   6. MemoryCuratorService (depends on registry, store, scorer, llm)
 *      The CURATOR_LLM (Symbol.for('PtahCuratorLlm')) is registered by agent-sdk
 *      under SDK_TOKENS.SDK_CURATOR_LLM_ADAPTER — NOT by this function.
 *      registerSdkServices() MUST be called before this function (or before
 *      MemoryCuratorService is first resolved), otherwise tsyringe will throw
 *      a missing-token error at construction time.
 *
 * SQLite + sqlite-vec are owned by `persistence-sqlite`; this module assumes
 * `registerPersistenceSqliteServices()` has already been called.
 */
import { Lifecycle, type DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import { MEMORY_TOKENS } from './tokens';
import { EmbedderWorkerClient } from '../embedder/embedder-worker-client';
import { SalienceScorer } from '../salience-scorer';
import { MemoryStore } from '../memory.store';
import { MemorySearchService } from '../memory-search.service';
import { MemoryDecayJob } from '../memory-decay.job';
import { MemoryCuratorService } from '../memory-curator.service';
import { MemoryWriterAdapter } from '../memory-writer.adapter';
import { MemoryStoreSymbolSink } from '../symbol-sink.adapter';
import { IndexingControlService } from '../control/indexing-control.service';

export function registerMemoryCuratorServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[memory-curator] registering services');

  // Embedder — registered under the shared PERSISTENCE_TOKENS.EMBEDDER token
  // so any persistence-sqlite-aware caller can resolve it. The concrete impl
  // lives here because it's the curator that owns the @xenova worker.
  container.register(
    PERSISTENCE_TOKENS.EMBEDDER,
    { useClass: EmbedderWorkerClient },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_SALIENCE_SCORER,
    { useClass: SalienceScorer },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_STORE,
    { useClass: MemoryStore },
    { lifecycle: Lifecycle.Singleton },
  );

  // IMemoryWriter port adapter (consumed by the wizard seeder in rpc-handlers).
  // Registered after MEMORY_STORE (above) because it depends on it at resolution time.
  container.register(
    PLATFORM_TOKENS.MEMORY_WRITER,
    { useClass: MemoryWriterAdapter },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_SEARCH,
    { useClass: MemorySearchService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Cross-layer aliases — consumed by agent-sdk and vscode-lm-tools
  // via MEMORY_CONTRACT_TOKENS without importing memory-curator directly.
  container.register(MEMORY_CONTRACT_TOKENS.MEMORY_READER, {
    useToken: MEMORY_TOKENS.MEMORY_SEARCH,
  });
  container.register(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER, {
    useToken: MEMORY_TOKENS.MEMORY_STORE,
  });

  container.register(
    MEMORY_TOKENS.MEMORY_DECAY_JOB,
    { useClass: MemoryDecayJob },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_CURATOR,
    { useClass: MemoryCuratorService },
    { lifecycle: Lifecycle.Singleton },
  );

  // TASK_2026_THOTH_CODE_INDEX: Register MemoryStoreSymbolSink under the
  // shared ISymbolSink port token so workspace-intelligence can inject it
  // without a direct dependency on memory-curator.
  container.register(
    MEMORY_CONTRACT_TOKENS.SYMBOL_SINK,
    { useClass: MemoryStoreSymbolSink },
    { lifecycle: Lifecycle.Singleton },
  );

  // TASK_2026_114: IndexingControlService — user-controlled workspace indexing.
  container.register(
    MEMORY_TOKENS.INDEXING_CONTROL,
    { useClass: IndexingControlService },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[memory-curator] services registered');
}
