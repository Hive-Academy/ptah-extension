/**
 * Memory Curator DI Registration (TASK_2026_HERMES Track 1).
 *
 * Registration order:
 *   1. EmbedderWorkerClient (concrete IEmbedder) under PERSISTENCE_TOKENS.EMBEDDER
 *   2. SalienceScorer
 *   3. MemoryStore (depends on EMBEDDER)
 *   4. MemorySearchService (depends on EMBEDDER, MEMORY_STORE)
 *   5. MemoryDecayJob (depends on MEMORY_STORE, SCORER)
 *   6. SdkInternalQueryCuratorLlm under MEMORY_TOKENS.CURATOR_LLM
 *   7. MemoryCuratorService (depends on registry, store, scorer, llm)
 *
 * SQLite + sqlite-vec are owned by `persistence-sqlite`; this module assumes
 * `registerPersistenceSqliteServices()` has already been called.
 */
import { Lifecycle, type DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from './tokens';
import { EmbedderWorkerClient } from '../embedder/embedder-worker-client';
import { SalienceScorer } from '../salience-scorer';
import { MemoryStore } from '../memory.store';
import { MemorySearchService } from '../memory-search.service';
import { MemoryDecayJob } from '../memory-decay.job';
import { SdkInternalQueryCuratorLlm } from '../curator-llm/sdk-internal-query.curator-llm';
import { MemoryCuratorService } from '../memory-curator.service';

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

  container.register(
    MEMORY_TOKENS.MEMORY_SEARCH,
    { useClass: MemorySearchService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_DECAY_JOB,
    { useClass: MemoryDecayJob },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.CURATOR_LLM,
    { useClass: SdkInternalQueryCuratorLlm },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_CURATOR,
    { useClass: MemoryCuratorService },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[memory-curator] services registered');
}
