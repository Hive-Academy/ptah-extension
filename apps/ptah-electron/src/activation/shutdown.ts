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
 * A quit is ALSO deferred when the chain has something to await — today that is
 * exactly one thing, `GatewayService.stop()`, whose outbound drain persists to
 * the same database `SQLite close` is about to shut (TASK_2026_347). Electron
 * stops waiting the moment a synchronous listener returns, so an unawaited stop
 * is a lost write; the deferral is what buys the chain the microtasks that drain
 * needs, and {@link GATEWAY_STOP_BUDGET_MS} is what stops it becoming a hang.
 *
 * With no boot in flight and no gateway to stop the whole sequence is still
 * synchronous and identical to the pre-change code.
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

/**
 * How long the disposal chain may wait for `GatewayService.stop()` before it
 * closes SQLite anyway.
 *
 * The wait exists because the stop is a real drain, not a flag flip:
 * `stop()` -> `OutboundDeliveryService.drainAll()` -> `StreamCoalescer.drainAll()`
 * flushes buffered adapter sends and settles turn state, and those writes reach
 * `gateway_messages`. Firing it and closing the database on the same tick puts
 * the write into a closed connection — the exact defect TASK_2026_347 exists to
 * close, moved from startup to shutdown.
 *
 * It is BOUNDED for the same reason {@link BOOT_DRAIN_BUDGET_MS} is: a quit that
 * hangs is a worse failure than a lost final delivery. A wedged adapter socket
 * costs two seconds and then the close proceeds.
 */
export const GATEWAY_STOP_BUDGET_MS = 2000;

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
  /** Override for tests. Defaults to {@link GATEWAY_STOP_BUDGET_MS}. */
  gatewayStopBudgetMs?: number;
}

/** The subset of {@link QuitSequenceDeps} the disposal chain reads. */
export type DisposalDeps = Pick<
  QuitSequenceDeps,
  'refs' | 'clearTimers' | 'disposeVoiceWorker' | 'gatewayStopBudgetMs'
>;

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
 * The head of the LIFO chain: everything disposed BEFORE the messaging gateway
 * is stopped.
 *
 * The order is the pre-change order from `main.ts`, unchanged: a service is
 * stopped before whatever it depends on. One position is load-bearing enough to
 * name — **agents BEFORE their translation proxies**. The proxy exists to serve
 * a live agent process, so stopping it first would leave the process alive and
 * talking to a closed socket. Each release issues an abort and a tree-kill
 * synchronously and only the settle is awaited, so the fire-and-forget shape
 * still reaps — without it the desktop app left every completed CLI agent's
 * process resident, which is how 16 idle `claude.exe` reached 99% of machine
 * memory (TASK_2026_323 B11).
 *
 * The chat bridge is the last entry, immediately before the gateway it feeds:
 * `GatewayChatBridge.stop()` is synchronous (it unsubscribes), so it needs no
 * wait of its own.
 */
function disposeBeforePersistence(deps: DisposalDeps): void {
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
  nonFatal('Gateway chat bridge stop', () => refs.chatBridge?.stop());
}

/**
 * The tail of the LIFO chain: `SQLite close` and everything after it.
 *
 * Nothing in here may run before {@link stopMessagingGateway} has SETTLED —
 * `SQLite close` is the first statement and the gateway's drain writes to the
 * database it closes.
 *
 * **Diagnostics is LAST**, mirroring its position as the FIRST thing armed in
 * the pre-window phase. Beyond LIFO correctness this keeps lag warnings coming
 * during teardown — a quit that hangs is a real failure mode, and the sampler is
 * exactly the instrument that would name the subsystem refusing to stop.
 *
 * There is deliberately NO harness teardown. `{ws}/.claude/{skills,commands}`
 * are workspace artifacts, not host-process resources: `ptah tui`, the headless
 * CLI, the gateway and a plain `claude` invocation all read them without ever
 * running this app. Removing them on quit is the defect TASK_2026_278 exists to
 * close.
 */
function disposeAfterPersistence(deps: DisposalDeps): void {
  const { refs } = deps;

  nonFatal('SQLite close', () => refs.sqliteConnection?.close());
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
 * Stop the gateway and WAIT for it, bounded by
 * {@link GATEWAY_STOP_BUDGET_MS}. Never rejects.
 *
 * The wait is the whole point. `GatewayService.stop()` cancels reconnects, then
 * `await this.outbound.drainAll()` -> `StreamCoalescer.drainAll()` flushes every
 * buffered adapter send and settles turn state across at least one microtask
 * boundary, and those flushes persist. Kicking the promise off and closing
 * SQLite on the next synchronous line — what this chain did before — meant the
 * final write of a streamed Telegram/Discord reply landed on a closed handle.
 */
async function stopMessagingGateway(
  gateway: NonNullable<BootRefs['messagingGateway']>,
  budgetMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(
      () => {
        console.warn(
          `[Ptah Electron] Messaging gateway stop exceeded ${budgetMs} ms; ` +
            'closing SQLite anyway.',
        );
        resolve();
      },
      Math.max(0, budgetMs),
    );
  });

  try {
    await Promise.race([Promise.resolve(gateway.stop()), deadline]);
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] Messaging gateway stop failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * `true` when the disposal chain has something it must AWAIT, and the quit
 * therefore has to be deferred even with no boot in flight.
 *
 * Only the messaging gateway qualifies today: it is the one handle whose stop
 * writes to SQLite after an `await`. Every other entry in the chain is either
 * synchronous or deliberately fire-and-forget (the agent reaper, whose kills are
 * issued synchronously and whose settle nothing downstream depends on).
 */
export function requiresDeferredDisposal(refs: BootRefs): boolean {
  return refs.messagingGateway !== null;
}

/**
 * Dispose every handle in `refs`, LIFO, awaiting the gateway drain in the
 * middle.
 *
 * Used on the DEFERRED quit path only. When
 * {@link requiresDeferredDisposal} is `false` the two halves are run inline by
 * {@link handleWillQuit}, so the common path stays a single synchronous
 * listener.
 */
export async function disposeBootRefs(deps: DisposalDeps): Promise<void> {
  disposeBeforePersistence(deps);

  const gateway = deps.refs.messagingGateway;
  if (gateway !== null) {
    await stopMessagingGateway(
      gateway,
      deps.gatewayStopBudgetMs ?? GATEWAY_STOP_BUDGET_MS,
    );
  }

  disposeAfterPersistence(deps);
}

/**
 * The deferred half of the quit: drain the aborted boot (when one was in
 * flight), run the awaited disposal chain, then re-issue the quit.
 *
 * `deps.quit()` is in a `finally` so no failure inside the chain can leave the
 * app unquittable — a deferred quit that never re-issues is an unkillable
 * process.
 */
async function runDeferredDisposal(
  deps: QuitSequenceDeps,
  bootRunning: boolean,
): Promise<void> {
  try {
    if (bootRunning) {
      await deps.awaitBootCompletion(
        deps.drainBudgetMs ?? BOOT_DRAIN_BUDGET_MS,
      );
    }
    await disposeBootRefs(deps);
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] Deferred disposal failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    deps.quit();
  }
}

/**
 * The whole `will-quit` sequence.
 *
 * Returns `true` when the disposal chain ran synchronously, `false` when the
 * quit was deferred and the chain will run once the boot has drained. The
 * return value exists for the caller's one-shot guard and for the spec; the
 * caller must not branch on it.
 *
 * ## When the quit is deferred
 *
 * Two reasons, either of which is enough:
 *
 * 1. A post-window boot is still in flight — it has to be aborted and given a
 *    bounded grace period before its half-built services are disposed.
 * 2. The chain has an AWAIT in it ({@link requiresDeferredDisposal}). Electron
 *    tears the process down the moment a synchronous `will-quit` listener
 *    returns, so anything after an `await` would run — if at all — against a
 *    dying process. `GatewayService.stop()`'s drain writes to SQLite, and
 *    `SQLite close` is the next thing in the chain: without the deferral the
 *    close wins the race and the final delivery is lost.
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

  const bootRunning = deps.isBootRunning();

  if (!bootRunning && !requiresDeferredDisposal(deps.refs)) {
    // The common path: nothing in flight and nothing to await, so this is
    // byte-for-byte the pre-change synchronous teardown. The two halves are run
    // inline rather than through `disposeBootRefs` precisely so that no `await`
    // can slip in front of `SQLite close` on a path Electron will not wait for.
    disposeBeforePersistence(deps);
    disposeAfterPersistence(deps);
    return true;
  }

  deps.deferQuit();
  void runDeferredDisposal(deps, bootRunning);
  return false;
}
