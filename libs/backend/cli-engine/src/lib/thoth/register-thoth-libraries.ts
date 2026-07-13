import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DependencyContainer } from 'tsyringe';

import { type Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type IMemoryReader,
  type IMemoryLister,
  type ISymbolSink,
} from '@ptah-extension/memory-contracts';
import { registerCuratorAuthServices } from '@ptah-extension/auth-providers';
import {
  registerPersistenceSqliteServices,
  PERSISTENCE_TOKENS,
  resolvePtahDbPath,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  registerMemoryCuratorServices,
  MEMORY_TOKENS,
} from '@ptah-extension/memory-curator';
import {
  registerSkillSynthesisServices,
  SKILL_REPROPAGATION_TOKEN,
} from '@ptah-extension/skill-synthesis';
import {
  registerCronSchedulerServices,
  CRON_TOKENS,
  NoopPowerMonitor,
} from '@ptah-extension/cron-scheduler';
import {
  registerMessagingGatewayServices,
  GATEWAY_TOKENS,
} from '@ptah-extension/messaging-gateway';
import { registerVoiceProviderServices } from '@ptah-extension/voice-providers';
import { registerGatewayChatBridge } from '@ptah-extension/gateway-chat-bridge';

import { createCliVecPathResolver } from './cli-vec-path-resolver';
import { CliTokenVault } from './cli-token-vault';
import { CliSkillRepropagation } from './cli-skill-repropagation';
import { CliEmbedderWorkerFactory } from './cli-embedder-worker-factory';

export function registerThothLibraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  try {
    const dbPath = resolvePtahDbPath();
    container.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, { useValue: dbPath });

    const workerEntry = path.join(__dirname, 'embedder-worker.mjs');

    const modelCacheDir = path.join(os.homedir(), '.ptah', 'models');
    try {
      fs.mkdirSync(modelCacheDir, { recursive: true });
    } catch (error: unknown) {
      logger.warn(
        '[CLI DI] Failed to create embedder model cache dir (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    // Embedder worker runs in a node:worker_threads Worker behind the
    // host-implemented factory port (the CLI has no Electron utilityProcess).
    // The bundled `embedder-worker.mjs` auto-detects the transport; this
    // factory owns Worker construction + init config, while EmbedderWorkerClient
    // owns respawn / idle-teardown / crash-loop. Without this factory the
    // embedder would degrade to unavailable and search would fall back to
    // BM25-only (the regression this restores).
    container.register(MEMORY_TOKENS.EMBEDDER_WORKER_PROCESS_FACTORY, {
      useValue: new CliEmbedderWorkerFactory(workerEntry, modelCacheDir),
    });

    registerPersistenceSqliteServices(container, logger);
    try {
      const sqliteConnection = container.resolve<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      );
      sqliteConnection.configure({
        vecPathResolver: createCliVecPathResolver(logger),
      });
    } catch (error: unknown) {
      logger.warn('[CLI DI] Failed to wire CLI vec resolver (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    registerCuratorAuthServices(container, logger);
    registerMemoryCuratorServices(container, logger);
    logger.info('[CLI DI] Memory curator services registered (Track 1)', {
      dbPath,
      workerEntry,
      modelCacheDir,
    });
  } catch (error: unknown) {
    logger.warn('[CLI DI] Memory curator registration skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  ensureMemoryContractFallbacks(container, logger);

  try {
    registerSkillSynthesisServices(container, logger);
    container.registerInstance(
      SKILL_REPROPAGATION_TOKEN,
      new CliSkillRepropagation(container),
    );
    logger.info('[CLI DI] Skill synthesis services registered (Track 2)');
  } catch (error: unknown) {
    logger.warn('[CLI DI] Skill synthesis registration skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    container.register(CRON_TOKENS.CRON_POWER_MONITOR, {
      useValue: new NoopPowerMonitor(),
    });
    registerCronSchedulerServices(container, logger);
    logger.info('[CLI DI] Cron scheduler services registered (Track 3)');
  } catch (error: unknown) {
    logger.warn('[CLI DI] Cron scheduler registration skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    container.register(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT, {
      useValue: new CliTokenVault(),
    });
    // No worker factory / vault twin on CLI → local voice degrades to
    // unavailable (assets-unavailable at call time); GatewayService still
    // resolves its selector dependency.
    registerVoiceProviderServices(container, logger);
    registerMessagingGatewayServices(container, logger);
    registerGatewayChatBridge(container, logger);
    logger.info('[CLI DI] Messaging gateway services registered (Track 4)');
  } catch (error: unknown) {
    logger.warn('[CLI DI] Messaging gateway registration skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function ensureMemoryContractFallbacks(
  container: DependencyContainer,
  logger: Logger,
): void {
  const missing: string[] = [];

  if (!container.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_READER)) {
    const noopMemoryReader: IMemoryReader = {
      search: async () => ({ hits: [], bm25Only: true }),
    };
    container.register(MEMORY_CONTRACT_TOKENS.MEMORY_READER, {
      useValue: noopMemoryReader,
    });
    missing.push('MEMORY_READER');
  }

  if (!container.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER)) {
    const noopMemoryLister: IMemoryLister = {
      listAll: () => ({ memories: [], total: 0 }),
    };
    container.register(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER, {
      useValue: noopMemoryLister,
    });
    missing.push('MEMORY_LISTER');
  }

  if (!container.isRegistered(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK)) {
    const noopSymbolSink: ISymbolSink = {
      deleteSymbolsForFile: () => 0,
      insertSymbols: async () => undefined,
    };
    container.register(MEMORY_CONTRACT_TOKENS.SYMBOL_SINK, {
      useValue: noopSymbolSink,
    });
    missing.push('SYMBOL_SINK');
  }

  if (missing.length > 0) {
    logger.warn(
      '[CLI DI] Memory-contract tokens unregistered after Track 1; installed no-op fallbacks so MemoryPromptInjector can resolve',
      { tokens: missing },
    );
  }
}
