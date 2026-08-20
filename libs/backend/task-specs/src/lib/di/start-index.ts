/**
 * Host-activation entry point for the task-spec index (TASK_2026_179, step 11).
 *
 * Before this, `ensureStarted` was reached ONLY from `tasks-rpc.handlers.ts` —
 * i.e. only once a user opened the Tasks board. That made `.ptah/specs/README.md`
 * unreachable for everyone who never opens it, and the README is the ONLY
 * channel that states the carrier contract to a user whose `.claude/` clone has
 * diverged from the shipped orchestration skill.
 *
 * ONE helper rather than three copies, because all three hosts need the same
 * three guarantees and getting any of them wrong is silent:
 *
 *  1. **Never abort activation.** Every resolution and every rejection is
 *     swallowed into a log line. A workspace with an unreadable `.ptah/` must
 *     degrade to "no index", never to "the extension failed to activate".
 *  2. **Never block startup.** The scan is dispatched off the activation call
 *     stack and is not awaited, so a slow disk cannot delay the window.
 *  3. **Re-attempt when the workspace appears.** Electron and the CLI register
 *     DI before the workspace root is restored, so the first attempt often has
 *     nothing to index. Subscribing to `onDidChangeWorkspaceFolders` covers
 *     that without moving the call site into host-specific boot code.
 *
 * `ensureStarted` is idempotent per normalized root, so the repeated calls this
 * produces cost one map lookup each.
 */
import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IDisposable,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { TaskIndexService } from '../task-index.service';
import { TASK_SPECS_TOKENS } from './tokens';

/** A no-op disposable — returned whenever there is nothing to unsubscribe. */
const NOOP_DISPOSABLE: IDisposable = { dispose: () => undefined };

/**
 * Warm the task-spec index for the active workspace, and keep warming it as the
 * active workspace changes.
 *
 * @returns a disposable for the workspace-folder subscription. Hosts may ignore
 *   it — the subscription is host-lifetime by design.
 */
export function startTaskSpecsIndex(
  container: DependencyContainer,
  logger: Logger,
): IDisposable {
  let workspace: IWorkspaceProvider;
  let index: TaskIndexService;
  try {
    workspace = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    index = container.resolve<TaskIndexService>(
      TASK_SPECS_TOKENS.TASK_INDEX_SERVICE,
    );
  } catch (error: unknown) {
    logger.warn('[task-specs] index warm-up skipped (services unavailable)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NOOP_DISPOSABLE;
  }

  const warm = (): void => {
    const root = workspace.getWorkspaceRoot();
    if (!root) return;
    // `Promise.resolve().then(...)` rather than a direct call so that even a
    // synchronous throw inside `ensureStarted` becomes a rejection this
    // `catch` owns — activation must not be able to fail from here.
    void Promise.resolve()
      .then(() => index.ensureStarted(root))
      .catch((error: unknown) => {
        logger.warn('[task-specs] index warm-up failed (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  warm();

  try {
    return workspace.onDidChangeWorkspaceFolders(() => warm());
  } catch (error: unknown) {
    logger.warn('[task-specs] workspace-folder subscription unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NOOP_DISPOSABLE;
  }
}
