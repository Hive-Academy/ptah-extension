import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  bootThothRuntime,
  startThothCron,
} from '@ptah-extension/thoth-runtime';

import {
  initPluginLoader,
  reconcileHarness,
  refreshUserLayer,
} from './plugin-activation';
import type { BootCoordinator } from './boot-coordinator';
import { normalizeWorkspaceRoot } from '@ptah-extension/shared';

/**
 * The heavy half of Electron activation, extracted from `wire-runtime.ts`
 * (TASK_2026_331 B1.T3).
 *
 * ## Why this is its own file
 *
 * Splitting `wireRuntime` into a pre-window and a post-window phase pushed
 * `wire-runtime.ts` past the 700-line soft ceiling. This is the piece that
 * comes out: one nameable concern — "everything the app does for a workspace
 * that the window does not need first" — with `wireRuntime`'s public surface
 * unchanged.
 *
 * ## The two ordering rules that are load-bearing
 *
 * 1. **`bootThothRuntime` runs FIRST.** It awaits `openAndMigrate()` before any
 *    of its own scans, so making it the first call here is what bounds the
 *    window in which a renderer RPC can arrive before SQLite is open. Until the
 *    readiness contract lands, that window is the whole failure mode, so
 *    nothing — not the harness reconcile, not the user-layer mirror, not
 *    `scanAndImport` — may be moved in front of it. The line right after it is
 *    `coordinator.markPersistenceSettled(...)`, which is what releases the
 *    post-window consumers that write to SQLite (the messaging gateway and the
 *    chat bridge). Nothing may be inserted between the two.
 * 2. **The latch is reserved synchronously, released later.** `startOrJoin`
 *    creates the entry for a workspace root the instant it is called, but the
 *    body does not begin until {@link HeavyServicesBooter.openWindowGate} has
 *    been called. That is what lets `wireRuntimePreWindow` reserve the startup
 *    root in the same synchronous block as the workspace-change listener — no
 *    `await` between the two — while the work itself still happens after the
 *    window is on screen.
 */

export interface HeavyServicesBooter {
  /**
   * Reserve the one-shot boot for `workspaceRoot` and return its promise.
   *
   * The same normalized root always returns the SAME promise, so a caller that
   * arrives second waits for the first to finish rather than returning early.
   * A different root gets its own entry.
   *
   * Reservation is synchronous. Nothing runs until `openWindowGate()`.
   */
  startOrJoin(workspaceRoot: string | undefined): Promise<void>;
  /**
   * Whether a boot for this root has ALREADY been reserved — in flight,
   * finished or failed.
   *
   * The workspace-folder listener asks this before it reserves, because a root
   * that is booting for the first time already gets the full user-layer pass
   * and its own `activation` harness reconcile from the boot itself. Firing a
   * propagation beside it was the second of the two concurrent passes in
   * `tmp/logs/log.log:1206-1223` (TASK_2026_345). A root that HAS booted before
   * — the second and every later switch back to it — still needs the
   * propagation, and that is the case this predicate exists to distinguish.
   *
   * Must be read BEFORE the matching `startOrJoin`, synchronously.
   */
  isReserved(workspaceRoot: string | undefined): boolean;
  /**
   * Release every reserved boot. Called exactly once, from
   * `wireRuntimePostWindow`, after `createMainWindow` has run.
   */
  openWindowGate(): void;
}

export interface HeavyServicesBooterOptions {
  container: DependencyContainer;
  coordinator: BootCoordinator;
}

export function createHeavyServicesBooter(
  options: HeavyServicesBooterOptions,
): HeavyServicesBooter {
  const { container, coordinator } = options;
  const refs = coordinator.refs;
  const signal = coordinator.abortSignal;

  /**
   * The in-flight (or settled) boot per normalized workspace root.
   *
   * Deliberately the PROMISE and not a boolean. A boolean latch is set on
   * entry, so it answers "has one started" — but every caller here needs "has
   * one finished". Under a boolean a second caller returns instantly, and if
   * that second caller is the awaited one, activation completes with every
   * `refs.*` field still null while the services it should have captured are
   * running.
   *
   * A rejected boot is NOT retried: the entry is stored before the body runs
   * and is never cleared.
   */
  const boots = new Map<string, Promise<void>>();

  let releaseWindowGate: () => void = () => undefined;
  const windowGate = new Promise<void>((resolve) => {
    releaseWindowGate = resolve;
  });
  let gateOpened = false;

  const bootHeavyServicesOnce = async (
    workspaceRoot: string | undefined,
  ): Promise<void> => {
    if (signal.aborted) {
      console.log(
        '[Ptah Electron] Deferred backend services skipped — shutdown already started',
      );
      // Nothing below will run, so nothing will ever open the database. Release
      // the gated consumers with the terminal answer instead of parking them.
      coordinator.markPersistenceSettled({ sqliteOpen: false });
      return;
    }
    console.log(
      '[Ptah Electron] Booting deferred backend services for workspace...',
    );

    // FIRST. `bootThothRuntime` awaits `openAndMigrate()` before every scan it
    // owns, so SQLite is open the moment this returns. Everything below assumes
    // that; nothing below may be hoisted above it.
    const thoth = await bootThothRuntime(container, {
      workspaceRoot,
      logPrefix: '[Ptah Electron]',
      signal,
    });
    refs.sqliteConnection = thoth.sqliteConnection;
    // The persistence gate opens HERE and nowhere else on the happy path.
    // `bootThothRuntime` awaits `openAndMigrate()` to completion, so this line
    // is the first instant at which the database is open AND migrated —
    // `isOpen` alone is true from the moment the handle is assigned, which is
    // before the migration runner applies anything (TASK_2026_347).
    coordinator.markPersistenceSettled({
      sqliteOpen: thoth.sqliteConnection?.isOpen ?? false,
    });
    refs.memoryCurator = thoth.memoryCurator;
    refs.memoryTrigger = thoth.memoryTrigger;
    refs.skillSynthesis = thoth.skillSynthesis;
    refs.skillTrigger = thoth.skillTrigger;
    refs.symbolWatcher = thoth.symbolWatcher;
    refs.statusBridgeDisposables = thoth.statusBridgeDisposables;

    if (signal.aborted) return;

    const contentDownload = container.resolve<ContentDownloadService>(
      PLATFORM_TOKENS.CONTENT_DOWNLOAD,
    );
    initPluginLoader(container, contentDownload.getPluginsPath());
    // Pre-network, so a warm start detects divergence and reaps deleted
    // upstreams with no download at all. The post-download callback below runs
    // the same pass again against the refreshed sources; this one is what makes
    // an offline or fully-cached start still notice a clone the user edited
    // (defect 8). Both passes are a directory walk plus a content hash.
    //
    // `refreshUserLayer` is the whole pass — mirror, reconcile, catalog sync —
    // behind a per-root coalescer (TASK_2026_345). The three separate calls
    // that used to stand here ran the catalog sync twice on their own and
    // raced the folder listener's propagation for the other two.
    await refreshUserLayer(container, workspaceRoot, 'activation');
    contentDownload
      .ensureContent()
      .then(async (result) => {
        if (signal.aborted) return;
        if (!result.success) {
          console.warn(
            '[Ptah Electron] Content download failed (non-blocking):',
            result.error ?? 'Unknown error',
          );
        }
        // Unconditional: the `!result.fromCache` gate that used to sit here is
        // defect 8. A cached download still needs the sweep, because what
        // changed may be the CLONE (a user edit) or the upstream's absence,
        // neither of which the download result knows anything about.
        //
        // A download that lands INSIDE the activation pass's coalescing window
        // joins that pass instead of running a second one — which is correct,
        // because the pass has not started reading yet and will therefore see
        // the freshly downloaded content. A download that lands later, which is
        // every real network fetch, gets its own pass.
        await refreshUserLayer(
          container,
          workspaceRoot,
          'content-download-complete',
        );
        // Re-reconcile against the post-download user layer. The pass below
        // this block runs before the network is done — so on a cold first run
        // it sees an empty user layer and copies nothing, and on a content
        // update it copies the previous revision. Both leave the workspace
        // without skills until the NEXT app start (TASK_2026_278). Running it
        // here for cached downloads too is deliberate: the branch that "already
        // has everything" is exactly the one where this is a cheap hash-compare
        // no-op, and skipping it would leave the fromCache path depending on
        // the initial call having raced correctly.
        await reconcileHarness(
          container,
          workspaceRoot,
          'content-download-complete',
          { signal },
        );
      })
      .catch((err: unknown) => {
        console.warn(
          '[Ptah Electron] Post-download reconcile failed (non-fatal):',
          err instanceof Error ? err.message : String(err),
        );
      });
    // First pass, not awaiting the network, so a warm start has skills before
    // the user's first prompt. `downloadPending` only changes how an empty user
    // layer is REPORTED; the callback above corrects the content. This is the
    // FIRST half of the deliberate double reconcile — do not collapse the two.
    //
    // Both passes carry the boot signal (TASK_2026_331 B7). The reconciler has
    // accepted one since TASK_2026_323 B8; only this caller never supplied it,
    // so a quit during activation left a full source walk plus up to six target
    // walks hashing on against a host whose disposal chain had already run. The
    // signal is honoured while READING and detached per target at its commit
    // point, so this cannot leave a half-populated target with no manifest.
    await reconcileHarness(container, workspaceRoot, 'activation', {
      downloadPending: true,
      signal,
    });
    if (signal.aborted) return;
    try {
      const providerModels = container.resolve(
        AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS,
      ) as { prefetchPricing: () => Promise<number> };
      providerModels.prefetchPricing().catch((err: unknown) => {
        console.warn(
          '[Ptah Electron] Pricing pre-fetch failed (using bundled defaults):',
          err instanceof Error ? err.message : String(err),
        );
      });
      console.log('[Ptah Electron] Pricing pre-fetch initiated (background)');
    } catch (error: unknown) {
      console.warn(
        '[Ptah Electron] Pricing pre-fetch setup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      const cliDetection = container.resolve(TOKENS.CLI_DETECTION_SERVICE) as {
        detectAll: () => Promise<
          Array<{ cli: string; installed: boolean; version?: string }>
        >;
        refreshCliTokens: () => Promise<void>;
      };

      cliDetection
        .detectAll()
        .then(async (results) => {
          const installed = results.filter((r) => r.installed);
          console.log(
            `[Ptah Electron] CLI detection complete: ${installed.length}/${results.length} CLIs found`,
          );
          if (installed.some((r) => r.cli === 'codex')) {
            try {
              await cliDetection.refreshCliTokens();
            } catch (refreshErr: unknown) {
              console.warn(
                '[Ptah Electron] CLI token refresh failed (non-blocking):',
                refreshErr instanceof Error
                  ? refreshErr.message
                  : String(refreshErr),
              );
            }
          }
        })
        .catch((err: unknown) => {
          console.warn(
            '[Ptah Electron] CLI detection failed (non-blocking):',
            err instanceof Error ? err.message : String(err),
          );
        });
    } catch (cliDetectError: unknown) {
      console.warn(
        '[Ptah Electron] CLI detection setup failed (non-blocking):',
        cliDetectError instanceof Error
          ? cliDetectError.message
          : String(cliDetectError),
      );
    }
    if (workspaceRoot && !signal.aborted) {
      // USER-VISIBLE EFFECT OF RUNNING THIS AFTER THE WINDOW (TASK_2026_331):
      // the session list in the sidebar is SHORT when the window first paints
      // and GROWS as this scan imports each session. That is the trade this
      // task makes deliberately — the scan used to take 30-60 s of the 73 s
      // that stood between launching the app and seeing anything at all.
      // `session:list` is unchanged and still reads `SessionMetadataStore`
      // (backed by workspace state storage, not SQLite): an empty store returns
      // `{ sessions: [], total: 0, hasMore: false }` and never an error, so a
      // list requested mid-import is short, never broken.
      try {
        const sessionImporter = container.resolve(
          SDK_TOKENS.SDK_SESSION_IMPORTER,
        ) as {
          scanAndImport: (
            path: string,
            limit?: number,
            options?: { signal?: AbortSignal },
          ) => Promise<number>;
        };
        const imported = await sessionImporter.scanAndImport(
          workspaceRoot,
          50,
          {
            signal,
          },
        );
        if (imported > 0) {
          console.log(
            `[Ptah Electron] Imported ${imported} existing Claude session(s)`,
          );
        }
      } catch (importError: unknown) {
        console.warn(
          '[Ptah Electron] Session import skipped (non-fatal):',
          importError instanceof Error
            ? importError.message
            : String(importError),
        );
      }
    }
    if (workspaceRoot && !signal.aborted) {
      try {
        const { GitWatcherService } =
          await import('../services/git-watcher.service');
        const gitInfoSvc = container.resolve(
          TOKENS.GIT_INFO_SERVICE,
        ) as InstanceType<
          typeof import('@ptah-extension/vscode-core').GitInfoService
        >;
        const webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER) as {
          broadcastMessage: (type: string, payload: unknown) => Promise<void>;
        };

        const logger = container.resolve<
          import('@ptah-extension/vscode-core').Logger
        >(TOKENS.LOGGER);
        const watcher = new GitWatcherService(gitInfoSvc, logger);
        watcher.start(workspaceRoot, (type, payload) => {
          webviewManager.broadcastMessage(type, payload);
        });
        refs.gitWatcher = watcher;
        console.log('[Ptah Electron] Git file system watcher started');
      } catch (error: unknown) {
        console.warn(
          '[Ptah Electron] Git watcher setup failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (signal.aborted) return;
    await startThothCron(container, thoth, {
      logPrefix: '[Ptah Electron]',
    });
    refs.cronScheduler = thoth.cronScheduler;
  };

  return {
    startOrJoin(workspaceRoot: string | undefined): Promise<void> {
      const key = normalizeWorkspaceRoot(workspaceRoot);
      const existing = boots.get(key);
      if (existing !== undefined) return existing;

      // Reserved NOW, synchronously. Nothing below this line may await before
      // the entry is in the map, or a workspace-change event arriving in the
      // same tick would create a second entry for the same root.
      const reserved = windowGate.then(() =>
        bootHeavyServicesOnce(workspaceRoot),
      );
      boots.set(key, reserved);
      return reserved;
    },
    isReserved(workspaceRoot: string | undefined): boolean {
      return boots.has(normalizeWorkspaceRoot(workspaceRoot));
    },
    openWindowGate(): void {
      if (gateOpened) return;
      gateOpened = true;
      releaseWindowGate();
    },
  };
}
