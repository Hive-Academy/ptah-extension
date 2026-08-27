/**
 * Boot coordinator — the one owner of the post-window boot lifecycle
 * (TASK_2026_331 B1).
 *
 * ## Why this exists
 *
 * `main.ts` used to hold fifteen separate nullable variables, each copied ONCE
 * out of `wireRuntime`'s refs object or `registerPostWindow`'s result. That
 * shape only works while every service is created before `main.ts` finishes its
 * `whenReady` callback. The moment the heavy boot moves behind the window — the
 * whole point of this task — services start existing AFTER those copies were
 * taken, and `will-quit` would dispose a snapshot of nulls while the real
 * services kept running.
 *
 * The fix is one STABLE object. {@link BootCoordinator.refs} is created once,
 * never reassigned, and handed to `main.ts` by reference. Whoever creates a
 * service writes its handle into the object; the LIFO disposal chain reads the
 * same object at quit time and therefore sees everything, no matter how late it
 * arrived.
 *
 * ## The three other jobs
 *
 * - **Abort.** `will-quit` cannot block. `abort()` fires an `AbortSignal` that
 *   in-flight boot work checks at its yield points, so a quit during boot stops
 *   the scans instead of racing the disposal chain.
 * - **Bounded wait.** `awaitCompletion(2000)` gives the aborted boot a short
 *   grace period to unwind before disposal starts. It never throws and never
 *   waits longer than the budget.
 * - **Warmup barrier.** With a window-first boot, `did-finish-load` fires
 *   BEFORE the memory curator exists, so the old `if (refs.memoryCurator ===
 *   null) return;` guard in `scheduleWarmup` would skip the embedder warmup on
 *   every launch. The barrier waits for both conditions instead of sampling one
 *   of them once.
 *
 * Nothing in this file imports a runtime value. Every import is `import type`,
 * so the module is loadable under ts-jest without an Electron runtime.
 */

import type { IStateStorage } from '@ptah-extension/platform-core';
import type { DiagnosticsHandle } from '@ptah-extension/vscode-core';
import type { ThothRuntimeRefs } from '@ptah-extension/thoth-runtime';
import type { GatewayService } from '@ptah-extension/messaging-gateway';
import type { GatewayChatBridge } from '@ptah-extension/gateway-chat-bridge';
import type { UpdateManager } from '../services/update/update-manager';

/**
 * Coarse boot state for the renderer.
 *
 * `warming` is the initial state and holds until the post-window boot settles.
 * `failed` is set when that boot rejects. `degraded` is reserved for a boot
 * that completed with a subsystem missing; nothing sets it in Batch 1, and it
 * exists here because the renderer contract added in Batch 2 needs the full
 * vocabulary to be stable from the start.
 */
export type BootReadiness = 'warming' | 'ready' | 'degraded' | 'failed';

/**
 * Every long-lived handle the activation path produces.
 *
 * The first eight fields come from {@link ThothRuntimeRefs} — SQLite, memory,
 * skills, cron, the symbol watcher and the status bridges. The rest are
 * host-owned: produced by `wire-runtime.ts` or `post-window.ts`.
 *
 * Field names are load-bearing: `main.ts`'s `will-quit` chain reads them
 * directly and its ORDER is the LIFO disposal contract.
 */
export interface BootRefs extends ThothRuntimeRefs {
  /**
   * Event-loop lag monitor + CPU profile capture. Armed first in the
   * pre-window phase and disposed LAST, so lag warnings keep coming during a
   * teardown that hangs.
   */
  diagnostics: DiagnosticsHandle | null;
  /** Git + workspace file-tree watcher. Created by the heavy boot. */
  gitWatcher: {
    stop: () => void;
    switchWorkspace: (p: string) => void;
  } | null;
  /** Telegram / Discord / Slack gateway. Created after the window. */
  messagingGateway: GatewayService | null;
  /** Gateway inbound -> agent session bridge. Created after the gateway. */
  chatBridge: GatewayChatBridge | null;
  /** GitHub-releases update checker. Created after the window. */
  updateManager: UpdateManager | null;
  /**
   * Ptah CLI registry, resolved eagerly while the container is healthy so
   * `will-quit` disposes a captured instance instead of forcing a first-time
   * lazy build of its dependency graph mid-teardown.
   */
  cliRegistry: { disposeAll: () => void } | null;
  /**
   * CLI agent process manager. The ref that actually ends spawned
   * `claude.exe` / `codex` processes; captured eagerly for the same reason as
   * {@link cliRegistry}.
   */
  agentProcessManager: { disposeAll: () => Promise<void> } | null;
  /** Per-workspace isolated provider-proxy pool; shutdown-wide backstop. */
  providerProxyPool: { disposeAll: () => Promise<void> } | null;
  /**
   * Window-bounds persistence storage. Not a disposable — `app.on('activate')`
   * needs it to recreate the window on macOS.
   */
  resolvedStateStorage: IStateStorage | null;
}

/** A fresh, all-null {@link BootRefs}. Called exactly once per coordinator. */
export function createEmptyBootRefs(): BootRefs {
  return {
    // ThothRuntimeRefs
    sqliteConnection: null,
    memoryCurator: null,
    memoryTrigger: null,
    skillSynthesis: null,
    skillTrigger: null,
    cronScheduler: null,
    symbolWatcher: null,
    statusBridgeDisposables: null,
    // host-owned
    diagnostics: null,
    gitWatcher: null,
    messagingGateway: null,
    chatBridge: null,
    updateManager: null,
    cliRegistry: null,
    agentProcessManager: null,
    providerProxyPool: null,
    resolvedStateStorage: null,
  };
}

/** How often the warmup barrier re-checks for the memory curator. */
const CURATOR_POLL_INTERVAL_MS = 200;

/**
 * How long the warmup barrier waits for the curator before giving up.
 *
 * The curator is created inside the post-window boot, which on a cold start
 * runs a SQLite migration and a content download first. 30 s is comfortably
 * past the worst measured case and short enough that a workspace with memory
 * disabled — where the curator is created but never started, or never created
 * at all — does not leave a live interval for the rest of the session.
 */
const WARMUP_BARRIER_TIMEOUT_MS = 30_000;

/**
 * Idle delay between the barrier opening and the warmup actually running, so
 * model loading does not overlap the renderer's first render burst.
 */
const WARMUP_IDLE_DELAY_MS = 3000;

/** `unref` a timer when the runtime supports it (Node / Electron main). */
function unrefTimer(timer: unknown): void {
  const maybe = timer as { unref?: () => void };
  if (typeof maybe?.unref === 'function') {
    maybe.unref();
  }
}

export class BootCoordinator {
  /**
   * The stable refs object. `readonly` and never reassigned — `main.ts` holds
   * this exact reference for the whole process lifetime.
   */
  readonly refs: BootRefs = createEmptyBootRefs();

  private readonly abortController = new AbortController();
  private readinessState: BootReadiness = 'warming';
  private postWindowPromise: Promise<void> | null = null;
  private pending = false;

  private warmupRun: (() => void | Promise<void>) | null = null;
  private warmupArmed = false;
  private warmupSettled = false;
  private windowLoaded = false;
  private curatorPoll: ReturnType<typeof setInterval> | null = null;
  private warmupDeadline: ReturnType<typeof setTimeout> | null = null;
  private warmupIdleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Signal for every abortable step of the post-window boot. */
  get abortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  /** Current readiness. Starts `warming`. */
  get readiness(): BootReadiness {
    return this.readinessState;
  }

  /** `true` only while a post-window boot promise is still pending. */
  get isRunning(): boolean {
    return this.pending;
  }

  /**
   * Reserve and run the post-window boot.
   *
   * The stored promise NEVER rejects: a failure sets `readiness = 'failed'` and
   * is logged. That matters because the promise is deliberately not awaited by
   * `main.ts` — an uncaught rejection here would be an unhandled rejection in
   * the main process.
   *
   * Calling this twice is a programming error, not a runtime one: the second
   * call is ignored so a stray caller cannot orphan the first boot.
   */
  startPostWindow(fn: () => Promise<void>): void {
    if (this.postWindowPromise !== null) {
      console.warn(
        '[BootCoordinator] startPostWindow called more than once; ignoring the later call',
      );
      return;
    }

    this.pending = true;

    let started: Promise<void>;
    try {
      started = fn();
    } catch (error: unknown) {
      // A synchronous throw from `fn` must land in the same failure path as a
      // rejection, otherwise it escapes into `main.ts`'s `whenReady`.
      started = Promise.reject(error);
    }

    this.postWindowPromise = started
      .then(() => {
        if (this.readinessState === 'warming') {
          this.readinessState = 'ready';
        }
      })
      .catch((error: unknown) => {
        this.readinessState = 'failed';
        console.error(
          '[BootCoordinator] Post-window boot failed:',
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        this.pending = false;
      });
  }

  /**
   * Cancel every abortable step of the boot and disarm the warmup barrier.
   *
   * Called from `will-quit`. Idempotent.
   */
  abort(): void {
    this.warmupSettled = true;
    this.clearBarrierTimers();
    if (this.warmupIdleTimer !== null) {
      clearTimeout(this.warmupIdleTimer);
      this.warmupIdleTimer = null;
    }
    try {
      this.abortController.abort();
    } catch (error: unknown) {
      console.warn(
        '[BootCoordinator] abort() failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Wait for the post-window boot to settle, but never longer than
   * `timeoutMs`. Returns immediately when no boot was ever started.
   *
   * Never throws: the stored promise is already caught, and the timeout arm
   * cannot fail.
   */
  async awaitCompletion(timeoutMs: number): Promise<void> {
    const running = this.postWindowPromise;
    if (running === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs));
      unrefTimer(timer);
    });

    try {
      await Promise.race([running, deadline]);
    } catch (error: unknown) {
      console.warn(
        '[BootCoordinator] awaitCompletion observed a rejection (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  /**
   * Register the embedder warmup body and arm the barrier.
   *
   * The body itself stays in `wire-runtime.ts` — it resolves the embedder
   * client and owns the main-process heap budget. The coordinator owns only
   * the QUESTION of when it may run.
   */
  armWarmup(run: () => void | Promise<void>): void {
    this.warmupRun = run;
    if (this.warmupArmed) return;
    this.warmupArmed = true;

    const deadline = setTimeout(() => {
      this.warmupDeadline = null;
      if (this.warmupSettled) return;
      this.warmupSettled = true;
      this.clearBarrierTimers();
      console.warn(
        `[BootCoordinator] Embedder warmup barrier timed out after ${WARMUP_BARRIER_TIMEOUT_MS} ms ` +
          '(the memory curator never became available); skipping warmup.',
      );
    }, WARMUP_BARRIER_TIMEOUT_MS);
    unrefTimer(deadline);
    this.warmupDeadline = deadline;

    this.evaluateWarmupBarrier();
  }

  /**
   * Called from `post-window.ts` when the main window fires
   * `did-finish-load`. One half of the barrier.
   */
  notifyWindowLoaded(): void {
    this.windowLoaded = true;
    this.evaluateWarmupBarrier();
  }

  /**
   * Both halves of the barrier: the window has finished loading AND the memory
   * curator exists. Until the second holds, poll — the curator is created deep
   * inside the post-window boot and there is no event to subscribe to.
   */
  private evaluateWarmupBarrier(): void {
    if (this.warmupSettled || !this.warmupArmed) return;
    if (this.abortSignal.aborted) return;
    if (!this.windowLoaded) return;

    if (this.refs.memoryCurator === null) {
      if (this.curatorPoll === null) {
        const poll = setInterval(() => {
          this.evaluateWarmupBarrier();
        }, CURATOR_POLL_INTERVAL_MS);
        unrefTimer(poll);
        this.curatorPoll = poll;
      }
      return;
    }

    this.warmupSettled = true;
    this.clearBarrierTimers();

    const run = this.warmupRun;
    if (run === null) return;

    const idle = setTimeout(() => {
      this.warmupIdleTimer = null;
      if (this.abortSignal.aborted) return;
      try {
        const result = run();
        if (result instanceof Promise) {
          result.catch((error: unknown) => {
            console.warn(
              '[BootCoordinator] Embedder warmup failed (non-fatal):',
              error instanceof Error ? error.message : String(error),
            );
          });
        }
      } catch (error: unknown) {
        console.warn(
          '[BootCoordinator] Embedder warmup threw synchronously (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }
    }, WARMUP_IDLE_DELAY_MS);
    unrefTimer(idle);
    this.warmupIdleTimer = idle;
  }

  /** Clear the poll and the deadline. Safe to call repeatedly. */
  private clearBarrierTimers(): void {
    if (this.curatorPoll !== null) {
      clearInterval(this.curatorPoll);
      this.curatorPoll = null;
    }
    if (this.warmupDeadline !== null) {
      clearTimeout(this.warmupDeadline);
      this.warmupDeadline = null;
    }
  }
}
