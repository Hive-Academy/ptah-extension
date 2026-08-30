import type { DependencyContainer } from 'tsyringe';

import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { WebviewManager } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import {
  MEMORY_TOKENS,
  type CorpusStore,
  type EmbedderStatusService,
  type IndexingControlService,
  type IndexingRunDeps,
  type MemoryCuratorService,
  type MemoryTriggerService,
  type ObservationQueueStore,
} from '@ptah-extension/memory-curator';
import {
  SKILL_SYNTHESIS_TOKENS,
  type SkillSynthesisService,
  type SkillTriggerService,
} from '@ptah-extension/skill-synthesis';
import {
  CODE_SYMBOL_INDEXER,
  type CodeSymbolIndexer,
  type WorkspaceFileIndexService,
} from '@ptah-extension/workspace-intelligence';
import { IndexingRpcHandlers } from '@ptah-extension/rpc-handlers';

import {
  emitVecLoadDiagnostic,
  serializeEmbedderSnapshotForBridge,
  serializeVecDiagnosticForBridge,
} from './diagnostics';
import {
  DEFAULT_THOTH_LOG_PREFIX,
  emptyThothRuntimeRefs,
  type BootThothRuntimeOptions,
  type ThothRuntimeRefs,
} from './types';

/**
 * Boot the Thoth channel: SQLite, memory curator + trigger, memory/status
 * push bridges, skill synthesis + trigger, code-symbol indexing deps and the
 * workspace file index.
 *
 * Every block is individually guarded and non-fatal: a failure degrades the
 * corresponding feature to `PERSISTENCE_UNAVAILABLE` rather than aborting the
 * host's activation. The returned refs must be disposed by the host in LIFO
 * order.
 *
 * The cron scheduler is deliberately NOT started here — hosts run it after
 * their own activation work via {@link startThothCron} so the boot ordering
 * of the Electron reference implementation is preserved exactly.
 *
 * ## What is awaited and what is merely started (TASK_2026_331 B1.T4)
 *
 * `openAndMigrate()` is the ONLY awaited step, and it stays first. Everything
 * a host or an RPC handler can observe — the connection ref, the schema, the
 * `sqlite-vec` diagnostic — exists the moment this function returns, which is
 * what keeps the window between "the renderer can call an RPC" and "SQLite is
 * open" as short as it can be.
 *
 * The three long scans behind it are STARTED and not awaited: the memory
 * trigger's boot scan, skill synthesis's SKILL.md walk plus trajectory scan,
 * and the workspace file index. Each was tens of seconds on a machine with
 * history, and none of them produces a value this function returns. Each
 * attaches its own `.catch` and each is gated on {@link
 * BootThothRuntimeOptions.signal}.
 *
 * The `memoryEnabled` lookup is started rather than awaited for the same
 * reason: `IndexingControlService.getStatus` walks the workspace for a
 * fingerprint and runs two `SELECT COUNT(*)` full-table probes purely to fill
 * a badge, and the badge already updates live from `MEMORY_CORPUS_CHANGED`.
 */
export async function bootThothRuntime(
  container: DependencyContainer,
  options: BootThothRuntimeOptions,
): Promise<ThothRuntimeRefs> {
  const { workspaceRoot, signal } = options;
  const logPrefix = options.logPrefix ?? DEFAULT_THOTH_LOG_PREFIX;
  const refs = emptyThothRuntimeRefs();

  /**
   * Read the signal through a call, never inline.
   *
   * `signal.aborted` is a mutable property, and TypeScript keeps the narrowing
   * from an earlier `signal?.aborted === true` guard alive across every `await`
   * below it — so a later inline check compiles to `false | undefined` and is
   * reported as an impossible comparison. A function call is opaque to that
   * narrowing and reads the live value each time, which is the only correct
   * behaviour here anyway.
   */
  const isAborted = (): boolean => signal?.aborted === true;

  if (isAborted()) {
    console.log(
      `${logPrefix} Thoth boot skipped — shutdown started before it began`,
    );
    return refs;
  }

  try {
    if (container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
      console.log(`${logPrefix} Resolving SQLite connection service...`);
      refs.sqliteConnection = container.resolve<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      );
      console.log(
        `${logPrefix} SQLite connection service resolved, calling openAndMigrate()...`,
      );
      await refs.sqliteConnection.openAndMigrate();
      console.log(
        `${logPrefix} SQLite connection opened + migrated successfully`,
      );
      emitVecLoadDiagnostic(
        container,
        refs.sqliteConnection.vecLoadDiagnostic,
        logPrefix,
      );
    } else {
      console.warn(
        `${logPrefix} PERSISTENCE_TOKENS.SQLITE_CONNECTION not registered, skipping`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isAbiMismatch =
      /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(
        errorMessage,
      );
    if (refs.sqliteConnection) {
      emitVecLoadDiagnostic(
        container,
        refs.sqliteConnection.vecLoadDiagnostic,
        logPrefix,
      );
    }
    console.error(
      '\n' +
        'â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—\n' +
        'â•‘  [Ptah] PERSISTENCE OFFLINE â€” Memory / Skills / Cron / Gateway   â•‘\n' +
        'â•‘  features will report PERSISTENCE_UNAVAILABLE until this is      â•‘\n' +
        'â•‘  resolved. The rest of the app will continue to boot.            â•‘\n' +
        (isAbiMismatch
          ? 'â•‘                                                                   â•‘\n' +
            'â•‘  CAUSE:  better-sqlite3 native module ABI mismatch.              â•‘\n' +
            'â•‘  FIX:    npm run electron:rebuild   (then restart Ptah)          â•‘\n'
          : 'â•‘                                                                   â•‘\n' +
            `â•‘  CAUSE:  ${errorMessage.slice(0, 56).padEnd(56)}     â•‘\n`) +
        'â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n',
    );
    refs.sqliteConnection = null;
  }
  if (isAborted()) {
    console.log(
      `${logPrefix} Thoth boot stopped after SQLite — shutdown in progress`,
    );
    return refs;
  }

  let indexingControl: IndexingControlService | null = null;
  try {
    if (
      refs.sqliteConnection !== null &&
      container.isRegistered(MEMORY_TOKENS.MEMORY_CURATOR)
    ) {
      refs.memoryCurator = container.resolve<MemoryCuratorService>(
        MEMORY_TOKENS.MEMORY_CURATOR,
      );
      if (container.isRegistered(MEMORY_TOKENS.INDEXING_CONTROL)) {
        indexingControl = container.resolve<IndexingControlService>(
          MEMORY_TOKENS.INDEXING_CONTROL,
        );
      }

      const curator = refs.memoryCurator;
      if (indexingControl === null || workspaceRoot === undefined) {
        // No control row to consult — the historical default is "enabled".
        curator.start();
        console.log(`${logPrefix} Memory curator started`);
      } else {
        // STARTED, NOT AWAITED. `getStatus` derives a workspace fingerprint by
        // walking the tree, reads git HEAD and runs two `SELECT COUNT(*)`
        // probes over `code_symbols` and `memory_chunks` — full-table scans
        // that exist to populate a badge the renderer also learns about from
        // `MEMORY_CORPUS_CHANGED`. The boot needed exactly one boolean out of
        // all that, so it now waits for none of it.
        const control = indexingControl;
        const root = workspaceRoot;
        void (async () => {
          try {
            const status = await control.getStatus(root);
            if (isAborted()) return;
            if (status.memoryEnabled) {
              curator.start();
              console.log(`${logPrefix} Memory curator started`);
            } else {
              console.log(
                `${logPrefix} Memory curator not started (memoryEnabled = false)`,
              );
            }
          } catch (error: unknown) {
            console.warn(
              `${logPrefix} Memory curator start skipped (non-fatal):`,
              error instanceof Error ? error.message : String(error),
            );
          }
        })();
      }
    }
  } catch (error: unknown) {
    console.warn(
      `${logPrefix} Memory curator start skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
    refs.memoryCurator = null;
  }
  try {
    if (
      refs.memoryCurator !== null &&
      !isAborted() &&
      container.isRegistered(MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE)
    ) {
      const memoryTrigger = container.resolve<MemoryTriggerService>(
        MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE,
      );
      // `start()` is synchronous but schedules the boot scan, which reads every
      // unscanned transcript. It is fire-and-forget by construction; the signal
      // is what stops the scheduled work.
      memoryTrigger.start();
      refs.memoryTrigger = memoryTrigger;
      console.log(`${logPrefix} Memory trigger service started`);
    }
  } catch (error: unknown) {
    console.warn(
      `${logPrefix} Memory trigger start skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
    refs.memoryTrigger = null;
  }
  try {
    if (refs.memoryCurator !== null) {
      const webviewManager = container.resolve<WebviewManager>(
        TOKENS.WEBVIEW_MANAGER,
      );
      refs.memoryCurator.onEvent((ev) => {
        if (
          ev.kind === 'curator-run' &&
          ev.stats &&
          typeof ev.stats['created'] === 'number' &&
          (ev.stats['created'] as number) > 0
        ) {
          const extracted = Number(ev.stats['extracted'] ?? 0);
          const created = Number(ev.stats['created'] ?? 0);
          const merged = Number(ev.stats['merged'] ?? 0);
          void webviewManager.broadcastMessage(MESSAGE_TYPES.MEMORY_EXTRACTED, {
            sessionId: ev.sessionId,
            workspaceRoot: null,
            extracted,
            created,
            merged,
            timestamp: ev.timestamp,
          });
        }
      });
      if (container.isRegistered(MEMORY_TOKENS.OBSERVATION_QUEUE_STORE)) {
        const queueStore = container.resolve<ObservationQueueStore>(
          MEMORY_TOKENS.OBSERVATION_QUEUE_STORE,
        );
        queueStore.onCapture((evt) => {
          void webviewManager.broadcastMessage(
            MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED,
            evt,
          );
        });
      }
      if (container.isRegistered(MEMORY_TOKENS.CORPUS_STORE)) {
        const corpusStore = container.resolve<CorpusStore>(
          MEMORY_TOKENS.CORPUS_STORE,
        );
        corpusStore.onChange((evt) => {
          void webviewManager.broadcastMessage(
            MESSAGE_TYPES.MEMORY_CORPUS_CHANGED,
            evt,
          );
        });
      }
      console.log(`${logPrefix} Memory push-event bridges wired`);
    }
  } catch (error) {
    console.warn(
      `${logPrefix} Memory push-event bridges skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    const bridgeDisposables: { dispose: () => void }[] = [];
    const webviewManager = container.resolve<WebviewManager>(
      TOKENS.WEBVIEW_MANAGER,
    );
    if (container.isRegistered(PERSISTENCE_TOKENS.VEC_STATUS)) {
      const vecStatus = container.resolve<VecStatusService>(
        PERSISTENCE_TOKENS.VEC_STATUS,
      );
      bridgeDisposables.push(
        vecStatus.on('change', (snapshot) => {
          void webviewManager.broadcastMessage(
            MESSAGE_TYPES.VEC_STATUS_CHANGED,
            {
              ok: snapshot.available,
              diagnostic: serializeVecDiagnosticForBridge(snapshot.diagnostic),
            },
          );
        }),
      );
    }
    if (container.isRegistered(MEMORY_TOKENS.EMBEDDER_STATUS)) {
      const embedderStatus = container.resolve<EmbedderStatusService>(
        MEMORY_TOKENS.EMBEDDER_STATUS,
      );
      bridgeDisposables.push(
        embedderStatus.on('change', (snapshot) => {
          void webviewManager.broadcastMessage(
            MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
            { status: serializeEmbedderSnapshotForBridge(snapshot) },
          );
        }),
      );
    }
    refs.statusBridgeDisposables = bridgeDisposables;
    if (bridgeDisposables.length > 0) {
      console.log(
        `${logPrefix} Vec/embedder status bridges wired (${bridgeDisposables.length} subscriber(s))`,
      );
    }
  } catch (error) {
    console.warn(
      `${logPrefix} Vec/embedder status bridge wiring skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
  }
  /**
   * The skill trigger, which may only start once skill synthesis has. Kept as
   * a named step because that ordering now happens on the continuation of an
   * unawaited promise rather than inline.
   */
  const startSkillTrigger = (): void => {
    try {
      if (
        refs.skillSynthesis !== null &&
        !isAborted() &&
        container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE)
      ) {
        const skillTrigger = container.resolve<SkillTriggerService>(
          SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE,
        );
        skillTrigger.start();
        refs.skillTrigger = skillTrigger;
        console.log(`${logPrefix} Skill trigger service started`);
      }
    } catch (error: unknown) {
      console.warn(
        `${logPrefix} Skill trigger start skipped (non-fatal):`,
        error instanceof Error ? error.message : String(error),
      );
      refs.skillTrigger = null;
    }
  };

  try {
    refs.skillSynthesis = container.resolve<SkillSynthesisService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
    );
    // STARTED, NOT AWAITED. `start()` re-opens SQLite (idempotent — already
    // open above), walks every SKILL.md on disk and runs the boot trajectory
    // scan. None of that produces anything this function returns, and all of it
    // used to sit between the user's launch and the window.
    //
    // The trigger still starts only AFTER a SUCCESSFUL synthesis start, and a
    // failure still nulls the ref, exactly as the awaited version did. Both
    // now happen on the continuation instead of inline, which is safe because
    // `refs` is the host's stable object: a late write is still disposed.
    void refs.skillSynthesis
      .start()
      .then(() => {
        if (isAborted()) return;
        console.log(`${logPrefix} Skill synthesis started`);
        startSkillTrigger();
      })
      .catch((error: unknown) => {
        console.warn(
          `${logPrefix} Skill synthesis start skipped (non-fatal):`,
          error instanceof Error ? error.message : String(error),
        );
        refs.skillSynthesis = null;
      });
  } catch (error: unknown) {
    console.warn(
      `${logPrefix} Skill synthesis start skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
    refs.skillSynthesis = null;
  }

  try {
    if (
      refs.sqliteConnection !== null &&
      refs.sqliteConnection.isOpen &&
      container.isRegistered(CODE_SYMBOL_INDEXER) &&
      workspaceRoot
    ) {
      const symbolIndexer =
        container.resolve<CodeSymbolIndexer>(CODE_SYMBOL_INDEXER);

      const runDeps: IndexingRunDeps = {
        runSymbols: async (
          wsRoot: string,
          options?: { signal?: AbortSignal },
        ): Promise<void> => {
          try {
            const startedAt = Date.now();
            await symbolIndexer.indexWorkspace(wsRoot, {
              ...(options?.signal ? { signal: options.signal } : {}),
              onProgress: (p) => {
                const percent =
                  p.totalFiles > 0
                    ? Math.min(
                        100,
                        Math.round((p.filesScanned / p.totalFiles) * 100),
                      )
                    : 0;
                const webviewManager = container.resolve<WebviewManager>(
                  TOKENS.WEBVIEW_MANAGER,
                );
                void webviewManager.broadcastMessage(
                  MESSAGE_TYPES.INDEXING_PROGRESS,
                  {
                    pipeline: 'symbols',
                    percent,
                    currentLabel: `${p.filesScanned}/${p.totalFiles} files`,
                    elapsedMs: Date.now() - startedAt,
                    totalKnown: true,
                  },
                );
              },
            });
          } catch (err: unknown) {
            if (
              err instanceof DOMException ||
              (err instanceof Error && err.name === 'AbortError')
            ) {
              return;
            }
            throw err;
          }
        },
      };

      if (container.isRegistered(IndexingRpcHandlers)) {
        const indexingRpcHandlers =
          container.resolve<IndexingRpcHandlers>(IndexingRpcHandlers);
        indexingRpcHandlers.setRunDeps(runDeps);
      }
    }
  } catch (error) {
    console.warn(
      `${logPrefix} Code symbol indexer wiring skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
  }

  // Live in-memory file index for `@`-mention autocomplete. Build eagerly
  // (non-blocking) so the first search is instant and the index self-updates
  // via its file watcher; falls back to lazy-build on first query.
  try {
    if (
      workspaceRoot &&
      !isAborted() &&
      container.isRegistered(TOKENS.WORKSPACE_FILE_INDEX_SERVICE)
    ) {
      const fileIndex = container.resolve<WorkspaceFileIndexService>(
        TOKENS.WORKSPACE_FILE_INDEX_SERVICE,
      );
      void fileIndex.start(workspaceRoot).catch((err: unknown) => {
        console.warn(
          `${logPrefix} WorkspaceFileIndex.start failed (non-fatal):`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  } catch (error: unknown) {
    console.warn(
      `${logPrefix} Workspace file index wiring skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
  }

  return refs;
}
