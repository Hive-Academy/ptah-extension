import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DependencyContainer } from 'tsyringe';

import { type Logger } from '@ptah-extension/vscode-core';
import { registerCuratorAuthServices } from '@ptah-extension/auth-providers';
import {
  registerPersistenceSqliteServices,
  PERSISTENCE_TOKENS,
  resolvePtahDbPath,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { registerMemoryCuratorServices } from '@ptah-extension/memory-curator';
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
import { registerGatewayChatBridge } from '@ptah-extension/gateway-chat-bridge';

import { createCliVecPathResolver } from './cli-vec-path-resolver';
import { CliTokenVault } from './cli-token-vault';
import { CliSkillRepropagation } from './cli-skill-repropagation';

export function registerThothLibraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  try {
    const dbPath = resolvePtahDbPath();
    container.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, { useValue: dbPath });

    const workerEntry = path.join(__dirname, 'embedder-worker.mjs');
    container.register(PERSISTENCE_TOKENS.EMBEDDER_WORKER_PATH, {
      useValue: workerEntry,
    });

    const modelCacheDir = path.join(os.homedir(), '.ptah', 'models');
    try {
      fs.mkdirSync(modelCacheDir, { recursive: true });
    } catch (error: unknown) {
      logger.warn(
        '[CLI DI] Failed to create embedder model cache dir (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    container.register(PERSISTENCE_TOKENS.EMBEDDER_MODEL_CACHE_DIR, {
      useValue: modelCacheDir,
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
      useClass: CliTokenVault,
    });
    registerMessagingGatewayServices(container, logger);
    registerGatewayChatBridge(container, logger);
    logger.info('[CLI DI] Messaging gateway services registered (Track 4)');
  } catch (error: unknown) {
    logger.warn('[CLI DI] Messaging gateway registration skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
