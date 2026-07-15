/**
 * task-specs DI registration helper.
 *
 * Mirrors `registerSkillSynthesisServices`. Pre-conditions:
 *  - `TOKENS.LOGGER` is registered (vscode-core).
 *  - `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` is registered.
 *
 * Post-conditions: scanner / writer / registry-generator resolve as singletons.
 *
 * SEAM (Batch A → B): the write-order notifier defaults to a NoOp unless a real
 * `ITaskIndexNotifier` (the Batch-B `TaskIndexService`) is already registered
 * under `TASK_INDEX_NOTIFIER_TOKEN`. The SQLite index store/service tokens are
 * intentionally NOT registered here yet — Batch B wires them.
 */
import { instanceCachingFactory } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { TaskScannerService } from '../task-scanner.service';
import { TaskWriterService } from '../task-writer.service';
import { RegistryGeneratorService } from '../registry-generator.service';
import {
  SqliteTaskIndexStore,
  InMemoryTaskIndexStore,
} from '../task-index.store';
import { TaskIndexService } from '../task-index.service';
import { TASK_INDEX_NOTIFIER_TOKEN } from '../task-index.port';
import { TASK_SPECS_TOKENS } from './tokens';

export function registerTaskSpecsServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[task-specs] registering services');

  container.registerSingleton(TaskScannerService);
  container.registerSingleton(RegistryGeneratorService);
  container.registerSingleton(TaskWriterService);

  container.register(TASK_SPECS_TOKENS.TASK_SCANNER, {
    useToken: TaskScannerService,
  });
  container.register(TASK_SPECS_TOKENS.REGISTRY_GENERATOR, {
    useToken: RegistryGeneratorService,
  });
  container.register(TASK_SPECS_TOKENS.TASK_WRITER, {
    useToken: TaskWriterService,
  });

  // Derived index store — pick SQLite when the shared connection is present,
  // else the in-memory parity impl (VS Code native-module failure case,
  // NFR-5/NFR-6). The choice is LAZY (instanceCachingFactory) because the
  // SQLite connection is registered in a later host phase than this call
  // (VS Code registers it in wire-runtime, after phase-2 libraries).
  container.registerSingleton(SqliteTaskIndexStore);
  container.registerSingleton(InMemoryTaskIndexStore);
  container.register(TASK_SPECS_TOKENS.TASK_INDEX_STORE, {
    useFactory: instanceCachingFactory((c) =>
      c.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
        ? c.resolve(SqliteTaskIndexStore)
        : c.resolve(InMemoryTaskIndexStore),
    ),
  });

  // Index service — lazy start + watcher + debounce + onDidChangeIndex.
  container.registerSingleton(TaskIndexService);
  container.register(TASK_SPECS_TOKENS.TASK_INDEX_SERVICE, {
    useToken: TaskIndexService,
  });

  // Write-order seam (R3.5): re-point the notifier at the real index service
  // (replaces Batch A's NoOp default). `TaskWriterService` calls this after
  // mutating `task.md` so the derived index reparses the changed folder.
  container.register(TASK_INDEX_NOTIFIER_TOKEN, {
    useToken: TaskIndexService,
  });

  logger.info('[task-specs] services registered', {
    tokens: Object.keys(TASK_SPECS_TOKENS),
  });
}
