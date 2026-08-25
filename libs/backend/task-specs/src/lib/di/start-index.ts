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
 *  4. **Re-attempt when persistence appears.** Same class of problem, second
 *     signal (TASK_2026_306 defect E). Electron and the CLI both register the
 *     SQLite connection in the same DI pass as this helper but `openAndMigrate`
 *     it far later — 464 log lines later in the captured Electron boot — so the
 *     first attempt cannot write the index at all (since task 4.4 the store
 *     reports `isReady() === false` and the write is skipped rather than
 *     attempted). Subscribing to `onDidOpen` covers that for EVERY host at once,
 *     which re-ordering each host's boot sequence would not: the two affected
 *     hosts open the connection from two different places
 *     (`thoth-runtime/boot-thoth-runtime.ts` vs
 *     `cli-engine/bootstrap/thoth-runtime.ts`), so a re-order is two edits that
 *     any future boot change silently re-breaks. The order in which a host
 *     registers the connection and calls this helper does NOT matter — see
 *     `subscribeToPersistenceOpen` for why that is enforced rather than merely
 *     documented (TASK_2026_314).
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
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type { Logger } from '@ptah-extension/vscode-core';
import type { TaskIndexService } from '../task-index.service';
import { TASK_SPECS_TOKENS } from './tokens';

/** A no-op disposable — returned whenever there is nothing to unsubscribe. */
const NOOP_DISPOSABLE: IDisposable = { dispose: () => undefined };

/** Dispose several subscriptions as one; a throwing member never blocks the rest. */
function composeDisposables(parts: IDisposable[]): IDisposable {
  return {
    dispose: () => {
      for (const part of parts) {
        try {
          part.dispose();
        } catch {
          // Disposal is best-effort — a failed unsubscribe must not strand the
          // others, and there is nothing useful a caller could do about it.
        }
      }
    },
  };
}

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

  const subscriptions: IDisposable[] = [];

  try {
    subscriptions.push(workspace.onDidChangeWorkspaceFolders(() => warm()));
  } catch (error: unknown) {
    logger.warn('[task-specs] workspace-folder subscription unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  subscriptions.push(subscribeToPersistenceOpen(container, logger, warm));

  return subscriptions.length > 0
    ? composeDisposables(subscriptions)
    : NOOP_DISPOSABLE;
}

/**
 * Re-warm once the shared SQLite connection opens (TASK_2026_306 defect E).
 *
 * `warm()` stays fire-and-forget — this adds a second trigger for it, never an
 * `await` on anyone's boot path. It relies on the recovery latch in
 * `TaskIndexService.ensureStarted`: the first, too-early attempt un-latches
 * `state.started` when the index was not written — whether the write was skipped
 * as predictably-offline (task 4.4) or attempted and failed — so this second
 * call performs a real rebuild rather than joining a hollow one.
 * That latch remains the safety net for the watcher path and for any host that
 * never opens a connection at all — this subscription narrows how often it is
 * needed, it does not replace it.
 *
 * Hosts that never register the connection (VS Code, which uses the in-memory
 * store) get a no-op: nothing to subscribe to, and nothing that was broken.
 *
 * **The registration ORDER does not matter, and that is deliberate
 * (TASK_2026_314).** This used to `return` when the token was not registered
 * yet — silently, with no warning and no retry — so defect E's fix held only
 * while every host happened to register the connection BEFORE calling
 * `startTaskSpecsIndex`. All three did, nothing made them, and a fourth host or
 * a re-ordered phase 2 would have reverted defect E to a merely STALE Tasks
 * board: no error, no failing test, and exactly the kind of regression that
 * survives manual QA.
 *
 * A WARN was the cheaper answer and is the wrong one here, because an absent
 * token is ALSO the normal VS Code shape — the warning would fire on every boot
 * of a correctly-configured host, which is how a real signal gets ignored.
 * So the late case ARMS instead: `afterResolution` stores an interceptor keyed
 * by token whether or not that token is registered yet, and fires the first
 * time anyone resolves it. Whoever opens the connection must resolve it first,
 * so the subscription is always in place before `openAndMigrate` can emit.
 * A host that registers a connection and never resolves it gets nothing — but
 * that host has no database either.
 */
function subscribeToPersistenceOpen(
  container: DependencyContainer,
  logger: Logger,
  warm: () => void,
): IDisposable {
  let disposed = false;
  let subscription: IDisposable = NOOP_DISPOSABLE;

  const subscribe = (connection: SqliteConnectionService): void => {
    if (disposed) return;
    try {
      // Subscribed unconditionally rather than only while `isOpen` is false: a
      // reopen (the database-reset RPC) is the same "the store is available
      // now" transition, and `ensureStarted` is idempotent, so an extra call
      // costs one map lookup.
      subscription = connection.onDidOpen(() => warm());
    } catch (error: unknown) {
      logger.warn('[task-specs] persistence-open subscription unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    if (container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
      subscribe(
        container.resolve<SqliteConnectionService>(
          PERSISTENCE_TOKENS.SQLITE_CONNECTION,
        ),
      );
    } else {
      container.afterResolution<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
        (_token, result) => {
          const connection = Array.isArray(result) ? result[0] : result;
          if (connection) subscribe(connection);
        },
        { frequency: 'Once' },
      );
    }
  } catch (error: unknown) {
    logger.warn('[task-specs] persistence-open subscription unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // tsyringe has no API to remove an interceptor, so disposal latches a flag
  // the callback checks rather than unregistering the hook.
  return {
    dispose: () => {
      disposed = true;
      subscription.dispose();
    },
  };
}
