import type { BootRefs } from './boot-coordinator';

/**
 * The `will-quit` sequence, extracted from `main.ts` (TASK_2026_331 B1.T6).
 *
 * ## Why it is not in `main.ts`
 *
 * For the same reason `handleWindowAllClosed` is not: `main.ts` uses
 * `import.meta.url` and `tsconfig.spec.json` compiles with `module: commonjs`,
 * so importing it under ts-jest fails with `TS1343`. The LIFO disposal order is
 * a real contract — services must stop before the things they depend on — and a
 * contract that cannot be asserted is a comment. `main.ts` keeps a branch-free
 * delegation to {@link handleWillQuit} and nothing else.
 *
 * ## Why a quit may now be DEFERRED
 *
 * Before this task every service existed by the time `whenReady` returned, so
 * `will-quit` could dispose synchronously and be sure it had seen everything.
 * With the heavy boot behind the window, a quit can land while that boot is
 * still creating services. The sequence therefore: aborts the boot, gives it a
 * bounded grace period to unwind, and only then disposes — reading the
 * coordinator's STABLE refs object, so anything the boot managed to create in
 * the meantime is still disposed.
 *
 * The deferral costs nothing on the common path: when no boot is in flight the
 * whole sequence is synchronous and identical to the pre-change code.
 */

/**
 * How long `will-quit` may wait for an aborted boot to unwind.
 *
 * `will-quit` cannot block indefinitely — a quit that hangs is a worse failure
 * than a service that outlives the process by a few milliseconds. Two seconds
 * is enough for the abort to reach the yield points of the scans that check it
 * (session import between sessions, harness reconcile between targets) and
 * short enough that a wedged subsystem cannot hold the app open.
 */
export const BOOT_DRAIN_BUDGET_MS = 2000;

export interface QuitSequenceDeps {
  /** The coordinator's stable refs object — read, never copied. */
  refs: BootRefs;
  /** `coordinator.abort()`. */
  abortBoot: () => void;
  /** `coordinator.isRunning` at the moment the quit arrives. */
  isBootRunning: () => boolean;
  /** `coordinator.awaitCompletion`. */
  awaitBootCompletion: (timeoutMs: number) => Promise<void>;
  /** Synchronous workspace-persistence flush. No-op when never wired. */
  flushWorkspacePersistence: () => void;
  /** Started, not awaited — see the call site comment. */
  flushSessionMetadataStores: () => void;
  /** Clears the licence-revalidation and update-check intervals. */
  clearTimers: () => void;
  /** Terminates the voice `utilityProcess` worker, if one was registered. */
  disposeVoiceWorker: () => void;
  /** `event.preventDefault()` — only called when the quit must be deferred. */
  deferQuit: () => void;
  /** `app.quit()` — only called after a deferred quit has finished draining. */
  quit: () => void;
  /** Override for tests. Defaults to {@link BOOT_DRAIN_BUDGET_MS}. */
  drainBudgetMs?: number;
}

/** Run `fn`, log and continue on failure. Every disposal is non-fatal. */
function nonFatal(label: string, fn: () => void): void {
  try {
    fn();
  } catch (error: unknown) {
    console.warn(
      `[Ptah Electron] ${label} failed (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Dispose every handle in `refs`, LIFO.
 *
 * The order is the pre-change order from `main.ts`, unchanged: a service is
 * stopped before whatever it depends on. Two positions are load-bearing enough
 * to name —
 *
 * - **Agents BEFORE their translation proxies.** The proxy exists to serve a
 *   live agent process, so stopping it first would leave the process alive and
 *   talking to a closed socket. Each release issues an abort and a tree-kill
 *   synchronously and only the settle is awaited, so the fire-and-forget shape
 *   still reaps — without it the desktop app left every completed CLI agent's
 *   process resident, which is how 16 idle `claude.exe` reached 99% of machine
 *   memory (TASK_2026_323 B11).
 * - **Diagnostics LAST**, mirroring its position as the FIRST thing armed in
 *   the pre-window phase. Beyond LIFO correctness this keeps lag warnings
 *   coming during teardown — a quit that hangs is a real failure mode, and the
 *   sampler is exactly the instrument that would name the subsystem refusing to
 *   stop.
 *
 * There is deliberately NO harness teardown. `{ws}/.claude/{skills,commands}`
 * are workspace artifacts, not host-process resources: `ptah tui`, the headless
 * CLI, the gateway and a plain `claude` invocation all read them without ever
 * running this app. Removing them on quit is the defect TASK_2026_278 exists to
 * close.
 */
export function disposeBootRefs(
  deps: Pick<QuitSequenceDeps, 'refs' | 'clearTimers' | 'disposeVoiceWorker'>,
): void {
  const { refs } = deps;

  nonFatal('ProviderProxyPool disposeAll', () => {
    void refs.providerProxyPool?.disposeAll();
  });
  nonFatal('Interval teardown', deps.clearTimers);
  nonFatal('UpdateManager dispose', () => refs.updateManager?.dispose());
  nonFatal('Git watcher stop', () => refs.gitWatcher?.stop());
  nonFatal('Symbol watcher close', () => refs.symbolWatcher?.close());
  nonFatal('Status bridge dispose', () =>
    refs.statusBridgeDisposables?.forEach((d) => d.dispose()),
  );
  nonFatal('Skill trigger stop', () => refs.skillTrigger?.stop());
  nonFatal('Skill synthesis stop', () => refs.skillSynthesis?.stop());
  nonFatal('Cron scheduler stop', () => refs.cronScheduler?.stop());
  nonFatal('Memory trigger stop', () => refs.memoryTrigger?.stop());
  nonFatal('Memory curator stop', () => refs.memoryCurator?.stop());
  nonFatal('SQLite close', () => refs.sqliteConnection?.close());
  nonFatal('Gateway chat bridge stop', () => refs.chatBridge?.stop());
  nonFatal('Messaging gateway stop', () => {
    void refs.messagingGateway?.stop().catch((error: unknown) => {
      console.warn(
        '[Ptah Electron] Messaging gateway stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    });
  });
  nonFatal('Voice worker dispose', deps.disposeVoiceWorker);
  nonFatal('Agent process disposal', () => {
    void refs.agentProcessManager?.disposeAll().catch((error: unknown) => {
      console.warn(
        '[Ptah Electron] Agent process disposal failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    });
  });
  nonFatal('CLI registry dispose', () => refs.cliRegistry?.disposeAll());
  nonFatal('Diagnostics dispose', () => refs.diagnostics?.dispose());
}

/**
 * The whole `will-quit` sequence.
 *
 * Returns `true` when the disposal chain ran synchronously, `false` when the
 * quit was deferred and the chain will run once the boot has drained. The
 * return value exists for the caller's one-shot guard and for the spec; the
 * caller must not branch on it.
 */
export function handleWillQuit(deps: QuitSequenceDeps): boolean {
  nonFatal('Workspace persistence flush', deps.flushWorkspacePersistence);
  // FIRST, and started rather than awaited: `will-quit` cannot block, and the
  // session metadata store coalesces a burst of writes into one update at the
  // end of its queue drain. Starting the flush before the disposals gives the
  // staged snapshot the whole teardown window to reach storage — without it
  // nothing ever called `flush()` and a CLI agent that exited in the final
  // seconds lost its reference (TASK_2026_324 finding 3).
  nonFatal('Session metadata flush', deps.flushSessionMetadataStores);

  // Cancel in-flight boot work BEFORE anything is disposed. A scan that is
  // still running would otherwise keep writing to services the chain below is
  // about to stop.
  nonFatal('Boot abort', deps.abortBoot);

  if (!deps.isBootRunning()) {
    // The common path: nothing in flight, so this is byte-for-byte the
    // pre-change synchronous teardown.
    disposeBootRefs(deps);
    return true;
  }

  deps.deferQuit();
  void deps
    .awaitBootCompletion(deps.drainBudgetMs ?? BOOT_DRAIN_BUDGET_MS)
    .finally(() => {
      disposeBootRefs(deps);
      deps.quit();
    });
  return false;
}
