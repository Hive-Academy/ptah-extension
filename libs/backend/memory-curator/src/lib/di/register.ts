/**
 * Memory Curator DI Registration.
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
import { EmbedderStatusService } from '../embedder/embedder-status.service';
import { SalienceScorer } from '../salience-scorer';
import { MemoryStore } from '../memory.store';
import { MemorySearchService } from '../memory-search.service';
import { MemoryDecayJob } from '../memory-decay.job';
import { MemoryCuratorService } from '../memory-curator.service';
import { MemoryWriterAdapter } from '../memory-writer.adapter';
import { MemoryStoreSymbolSink } from '../symbol-sink.adapter';
import { CodeSymbolStore } from '../code-symbol.store';
import { IndexingControlService } from '../control/indexing-control.service';
import { MemoryTriggerService } from '../triggers/memory-trigger.service';
import { MemoryDiagnosticsService } from '../diagnostics.service';
import { ObservationQueueStore } from '../observation-queue.store';
import { CorpusStore } from '../knowledge-agents/corpus.store';
import { KnowledgeAgentService } from '../knowledge-agents/knowledge-agent.service';

export function registerMemoryCuratorServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[memory-curator] registering services');
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
    MEMORY_TOKENS.OBSERVATION_QUEUE_STORE,
    { useClass: ObservationQueueStore },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.CODE_SYMBOL_STORE,
    { useClass: CodeSymbolStore },
    { lifecycle: Lifecycle.Singleton },
  );
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
  container.register(MEMORY_CONTRACT_TOKENS.MEMORY_READER, {
    useToken: MEMORY_TOKENS.MEMORY_SEARCH,
  });
  container.register(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER, {
    useToken: MEMORY_TOKENS.MEMORY_STORE,
  });

  container.register(
    MEMORY_TOKENS.CORPUS_STORE,
    { useClass: CorpusStore },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    MEMORY_TOKENS.KNOWLEDGE_AGENT_SERVICE,
    { useClass: KnowledgeAgentService },
    { lifecycle: Lifecycle.Singleton },
  );

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
  container.register(
    MEMORY_CONTRACT_TOKENS.SYMBOL_SINK,
    { useClass: MemoryStoreSymbolSink },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    MEMORY_TOKENS.INDEXING_CONTROL,
    { useClass: IndexingControlService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE,
    { useClass: MemoryTriggerService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.MEMORY_DIAGNOSTICS_SERVICE,
    { useClass: MemoryDiagnosticsService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_TOKENS.EMBEDDER_STATUS,
    { useClass: EmbedderStatusService },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[memory-curator] services registered');
}
