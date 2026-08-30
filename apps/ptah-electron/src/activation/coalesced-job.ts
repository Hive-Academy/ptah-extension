/**
 * A per-key, trailing-window job coalescer (TASK_2026_345).
 *
 * ## The defect it exists to close
 *
 * One switch to `property-hub` ran the user-layer mirror TWICE and the skill
 * registry catalog sync FOUR times (`tmp/logs/log.log:1206-1223`), because a
 * workspace switch is not one event — it is `activation`,
 * `workspace-folders-changed`, `content-download-complete` and, when a folder is
 * added and then made active, an `addFolder` immediately followed by a `switch`.
 * Every one of those triggers is individually correct; each was asking for the
 * same directory walk over the same tree, and the two that landed together did
 * not merely waste work, they INTERLEAVED — the log shows one pass reporting
 * `fastForwarded: 15` while its twin reported `fastForwarded: 0` on the same
 * clones in the same second.
 *
 * ## The contract
 *
 * - **The first request for a key opens a window.** Every request that arrives
 *   during it joins the same batch and gets the same promise. N triggers inside
 *   the window produce ONE run, and the run is told every reason that asked for
 *   it, in arrival order, deduplicated — so a coalesced pass logs
 *   `activation + workspace-folders-changed` rather than pretending it had one
 *   cause.
 * - **Runs for one key never overlap.** A batch whose window has closed still
 *   waits for the previous run to settle. That is the half that fixes the
 *   interleaving above, and it is why this is not a plain `debounce`.
 * - **A request that arrives after a run has drained gets its own run.** This is
 *   a coalescer, not a cache: a trigger that fires later is reporting a change
 *   the finished run could not have seen.
 * - **A request that arrives WHILE a run is in flight joins the batch already
 *   queued behind it**, rather than starting a third. At most one run is queued
 *   per key at any moment.
 *
 * ## Why trailing and not leading
 *
 * A leading-edge runner starts the first trigger immediately and can only offer
 * the stragglers a second pass — which is two passes, the very thing being
 * fixed. The cost is that every pass now waits out the window before it starts.
 * That is paid once per burst, off the window-paint critical path (this runs in
 * the post-window boot phase), and it buys a deterministic single pass.
 *
 * The window is NOT a lock file and NOT a scheduler: it holds no state across
 * process restarts and it never delays a caller by more than one window plus
 * whatever the previous run for that key still owes.
 */

/** What a run is told about the batch that produced it. */
export interface CoalescedJobBatch<TPayload> {
  /** The normalized key this batch ran for. */
  key: string;
  /**
   * Every distinct reason that joined the batch, in arrival order.
   *
   * Kept as a LIST rather than collapsed to the first reason so a log line can
   * still name all of them — "why did this run" is the question every one of
   * these passes gets asked, and answering it with the winner of a race is how
   * the duplicate triggers stayed invisible for so long.
   */
  reasons: readonly string[];
  /**
   * The payload of the most recent request in the batch.
   *
   * Last-write-wins, because for the one payload this carries today — the raw
   * (un-normalized) workspace root — every request in a batch describes the
   * same directory and the most recent spelling is the one the newest trigger
   * actually observed.
   */
  payload: TPayload;
}

export interface CoalescedJobOptions<TPayload> {
  /**
   * How long a batch collects requests before it is allowed to run.
   *
   * Must be > 0: a zero window would still coalesce a synchronous burst (the
   * timer is a macrotask), but it would not coalesce the common case here,
   * where two triggers are separated by an `await` on a directory read.
   */
  windowMs: number;
  /**
   * The work. MUST be effectively non-fatal — a rejection is caught, reported
   * through {@link CoalescedJobOptions.onError} and never propagated to the
   * requesters, because every caller of this in the activation path is itself
   * declared non-fatal.
   */
  run: (batch: CoalescedJobBatch<TPayload>) => Promise<void>;
  /** Reporting hook for a rejected run. Defaults to a `console.warn`. */
  onError?: (error: unknown, batch: CoalescedJobBatch<TPayload>) => void;
}

export interface CoalescedJob<TPayload> {
  /**
   * Ask for a run of `key`, naming the trigger.
   *
   * Resolves when the batch this request joined has finished running (or
   * failed). Never rejects.
   */
  request(key: string, reason: string, payload: TPayload): Promise<void>;
  /**
   * The reasons currently waiting for a run of `key`.
   *
   * Diagnostics and tests only — the app never branches on this.
   */
  pendingReasons(key: string): readonly string[];
}

interface PendingBatch<TPayload> {
  reasons: string[];
  seen: Set<string>;
  payload: TPayload;
  promise: Promise<void>;
  settle: () => void;
}

function defaultOnError(error: unknown, key: string, reasons: string[]): void {
  console.warn(
    `[Ptah Electron] Coalesced job failed (non-fatal) [${key}] (${reasons.join(' + ')}):`,
    error instanceof Error ? error.message : String(error),
  );
}

export function createCoalescedJob<TPayload>(
  options: CoalescedJobOptions<TPayload>,
): CoalescedJob<TPayload> {
  const { windowMs, run } = options;

  /**
   * At most ONE pending batch per key, by construction: a batch is removed from
   * this map inside the chain link that drains it, and only a key with no entry
   * here creates a new batch (and therefore a new timer). That invariant is what
   * lets a late joiner attach to a batch that is already queued behind an
   * in-flight run instead of starting a third pass.
   */
  const pending = new Map<string, PendingBatch<TPayload>>();

  /** The tail of the per-key run chain; absent when nothing is queued. */
  const chains = new Map<string, Promise<void>>();

  const drain = (key: string): void => {
    const previous = chains.get(key) ?? Promise.resolve();
    const link = previous.then(async () => {
      // Read the batch HERE, not when the timer was armed: everything that
      // joined while the previous run was in flight belongs to this pass.
      const batch = pending.get(key);
      if (batch === undefined) return;
      pending.delete(key);

      const described: CoalescedJobBatch<TPayload> = {
        key,
        reasons: [...batch.reasons],
        payload: batch.payload,
      };
      try {
        await run(described);
      } catch (error: unknown) {
        if (options.onError !== undefined) {
          options.onError(error, described);
        } else {
          defaultOnError(error, key, batch.reasons);
        }
      } finally {
        batch.settle();
      }
    });

    chains.set(key, link);
    void link.then(() => {
      // Only the CURRENT tail may clear the entry; a later link that has
      // already replaced it must keep its place in the chain.
      if (chains.get(key) === link) chains.delete(key);
    });
  };

  return {
    request(key: string, reason: string, payload: TPayload): Promise<void> {
      const existing = pending.get(key);
      if (existing !== undefined) {
        if (!existing.seen.has(reason)) {
          existing.seen.add(reason);
          existing.reasons.push(reason);
        }
        existing.payload = payload;
        return existing.promise;
      }

      let settle: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        settle = resolve;
      });
      pending.set(key, {
        reasons: [reason],
        seen: new Set([reason]),
        payload,
        promise,
        settle,
      });

      const timer = setTimeout(() => drain(key), windowMs);
      // A window that is still open must never be the reason the process cannot
      // exit. Node/Electron main only; guarded because a browser-shaped timer
      // has no `unref`.
      if (typeof timer === 'object' && typeof timer.unref === 'function') {
        timer.unref();
      }

      return promise;
    },

    pendingReasons(key: string): readonly string[] {
      return pending.get(key)?.reasons ?? [];
    },
  };
}
