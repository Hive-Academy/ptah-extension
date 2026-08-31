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

/**
 * How long the disposal chain may wait for the agents to exit before it gives
 * up and flushes whatever they managed to stage.
 *
 * The wait exists because an agent exit PRODUCES a write. `disposeAll()` ends
 * each running ptah-cli agent, its `done` handler stages the agent's bulk
 * output and then its session reference, and the store coalesces both into one
 * `IStateStorage.update` that only the final flush performs. Reaping without
 * waiting means the flush runs against a queue those exits have not reached
 * yet, and on relaunch the session shows no CLI agent and the agent cannot be
 * continued (TASK_2026_334 defect 1).
 *
 * Two seconds for the same reason the two budgets above are bounded: an agent
 * whose process refuses to die must cost a bounded pause, not an unquittable
 * app. The kills are issued synchronously inside `disposeAll()`, so this budget
 * buys the staging its microtasks — it is not waiting on a process to die.
 */
export const AGENT_REAP_BUDGET_MS = 2000;

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
  /**
   * Drain the session metadata store's coalesced write queue.
   *
   * Called TWICE, and the two calls answer different questions. See
   * {@link handleWillQuit} for the early one and {@link disposeBootRefs} for
   * the final one.
   */
  flushSessionMetadataStores: () => Promise<void>;
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
  /** Override for tests. Defaults to {@link AGENT_REAP_BUDGET_MS}. */
  agentReapBudgetMs?: number;
}

/** The subset of {@link QuitSequenceDeps} the disposal chain reads. */
export type DisposalDeps = Pick<
  QuitSequenceDeps,
  | 'refs'
  | 'clearTimers'
  | 'disposeVoiceWorker'
  | 'flushSessionMetadataStores'
  | 'gatewayStopBudgetMs'
  | 'agentReapBudgetMs'
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
async function disposeAfterPersistence(deps: DisposalDeps): Promise<void> {
  const { refs } = deps;

  nonFatal('SQLite close', () => refs.sqliteConnection?.close());
  nonFatal('Voice worker dispose', deps.disposeVoiceWorker);

  // The guard is HERE rather than inside `reapAgents`, and that placement is
  // the whole reason the undeferred path still works. `await f()` suspends even
  // when `f` returns immediately, so hiding the null check inside an async
  // helper would push `cliRegistry` and `diagnostics` into a microtask — and on
  // a path Electron does not wait for, a microtask is never.
  const manager = refs.agentProcessManager;
  if (manager !== null) {
    await reapAgents(manager, deps.agentReapBudgetMs ?? AGENT_REAP_BUDGET_MS);
  }

  nonFatal('CLI registry dispose', () => refs.cliRegistry?.disposeAll());
  nonFatal('Diagnostics dispose', () => refs.diagnostics?.dispose());
}

/**
 * Reap the agents and WAIT for them, bounded by {@link AGENT_REAP_BUDGET_MS}.
 * Never rejects.
 *
 * Two things depend on this being awaited, and both were broken while it was
 * fire-and-forget (TASK_2026_334):
 *
 *  - **The final metadata flush.** An agent exit stages the agent's bulk output
 *    and then its session reference. Flushing before those land loses the
 *    reference, and the reference is the only route to
 *    `ptah.agentOutput:<agentId>` — so the relaunched session shows no CLI
 *    agent and cannot continue it.
 *  - **"Agents before proxies."** `disposeBeforePersistence` documents that an
 *    agent must stop before the translation proxy serving it. The CLI registry
 *    on the next line is that proxy, and it used to be disposed while the
 *    agents were still exiting, so an agent mid-request hit a closed socket and
 *    logged a transport error before its SIGTERM landed. The CLI host has
 *    always awaited both (`shutdown-host-runtime.ts:131-132`); Electron was the
 *    outlier.
 *
 * Takes the manager rather than the deps because the caller must decide whether
 * to await at all — see the comment at that call site.
 */
async function reapAgents(
  manager: NonNullable<BootRefs['agentProcessManager']>,
  budgetMs: number,
): Promise<void> {
  await withBudget(
    'Agent process disposal',
    () => manager.disposeAll(),
    budgetMs,
    'flushing whatever the agents staged.',
  );
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
  await withBudget(
    'Messaging gateway stop',
    () => gateway.stop(),
    budgetMs,
    'closing SQLite anyway.',
  );
}

/**
 * Await one teardown step, give up after `budgetMs`, and never reject.
 *
 * The shape is shared by every await in this chain, and each one is bounded for
 * the same reason: a quit that hangs is a worse failure than the write the step
 * was going to make. `onExpiry` names what happens next, so the warning tells
 * the reader the consequence rather than only the timeout.
 *
 * A step that overruns is NOT cancelled — there is nothing to cancel, and
 * letting it finish is how its write still has a chance to land in the window
 * the rest of the teardown occupies.
 */
async function withBudget(
  label: string,
  step: () => Promise<void>,
  budgetMs: number,
  onExpiry: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(
      () => {
        console.warn(
          `[Ptah Electron] ${label} exceeded ${budgetMs} ms; ${onExpiry}`,
        );
        resolve();
      },
      Math.max(0, budgetMs),
    );
  });

  try {
    await Promise.race([Promise.resolve(step()), deadline]);
  } catch (error: unknown) {
    console.warn(
      `[Ptah Electron] ${label} failed (non-fatal):`,
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
 * Two handles qualify, and both because a WRITE happens after an `await`:
 *
 *  - The **messaging gateway**, whose stop drains buffered adapter sends into
 *    the SQLite database `SQLite close` is about to shut.
 *  - The **agent process manager**, whose `disposeAll()` makes each running
 *    agent exit and stage its session reference, which only the final
 *    {@link disposeBootRefs} flush writes.
 *
 * The agent reaper used to be listed here as the counter-example — "deliberately
 * fire-and-forget, whose settle nothing downstream depends on". That stopped
 * being true the moment a flush was placed after it (TASK_2026_334). An
 * undeferred quit gives that flush no window, and Electron tears the process
 * down with the reference still staged.
 */
export function requiresDeferredDisposal(refs: BootRefs): boolean {
  return refs.messagingGateway !== null || refs.agentProcessManager !== null;
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

  await disposeAfterPersistence(deps);

  // LAST, and AWAITED. The early flush in `handleWillQuit` drained what was
  // staged when the quit arrived; this one drains what the TEARDOWN ITSELF
  // produced — above all the session reference each agent stages as it exits.
  // Without it the reap above has nobody to hand its writes to, which is the
  // whole of TASK_2026_334 defect 1. Reaching this line at all is what
  // `requiresDeferredDisposal` guarantees whenever there are agents to reap.
  await deps.flushSessionMetadataStores();
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
  // ALREADY-staged snapshot the whole teardown window to reach storage —
  // without it nothing ever called `flush()` and a CLI agent that exited in the
  // final seconds lost its reference (TASK_2026_324 finding 3).
  //
  // It is deliberately not the only flush. It cannot see what the teardown is
  // about to stage, so `disposeBootRefs` runs a second, AWAITED one after the
  // agents have been reaped (TASK_2026_334). Keeping this one is what leaves
  // the undeferred path — where there is no window for that second flush — no
  // worse off than before.
  nonFatal('Session metadata flush', () => {
    void deps.flushSessionMetadataStores();
  });

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
    //
    // `disposeAfterPersistence` is async but takes no `await` here: its only
    // one is the agent reap, and `requiresDeferredDisposal` returning false is
    // exactly the statement that there is no agent manager to reap. So the body
    // runs to completion synchronously before the promise is returned, and the
    // `void` discards a promise that is already settled.
    disposeBeforePersistence(deps);
    void disposeAfterPersistence(deps);
    return true;
  }

  deps.deferQuit();
  void runDeferredDisposal(deps, bootRunning);
  return false;
}
