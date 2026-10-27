/**
 * The `boot:progress` push side (TASK_2026_721 component 5).
 *
 * The heavy boot runs while the preparing shell is on screen, before any
 * `WEBVIEW_MANAGER` exists, so messages go straight to the main window's
 * `webContents` on the `to-renderer` channel, which the preload relays to
 * `window` as a `message` event. The same window later loads Angular; the
 * latest snapshot of every started step is replayed on `did-finish-load` so the
 * new page sees where the boot is. The same snapshots are readable through
 * {@link BootProgressPublisher.snapshots} for the `boot:getReadiness` pull,
 * which covers a replay the page's listener was not yet attached for.
 *
 * Properties that matter:
 *
 * - **Never throws, never awaits.** Every send is wrapped. A lost display update
 *   must not fail or slow the boot it narrates.
 * - **Coalesced ticks.** Count updates of an active step go out at most once per
 *   {@link BOOT_PROGRESS_TICK_MS} through a trailing timer. Step transitions
 *   (active, done, failed) go out immediately.
 * - **Terminal states stick.** Once a step is `done` or `failed`, later updates
 *   for it are ignored, so a detached step that settles after the boot already
 *   marked it failed cannot overwrite that.
 */

import {
  BOOT_PROGRESS_STEP_IDS,
  MESSAGE_TYPES,
  type BootProgressPayload,
  type BootProgressStepId,
  type BootProgressStepState,
} from '@ptah-extension/shared';

/** Minimum gap between two count ticks of one step. */
export const BOOT_PROGRESS_TICK_MS = 100;

/** The slice of `webContents` the publisher touches. */
export interface BootProgressContents {
  isDestroyed(): boolean;
  send(channel: string, message: unknown): void;
  on(event: 'did-finish-load', listener: () => void): unknown;
  removeListener(event: 'did-finish-load', listener: () => void): unknown;
}

/** The slice of a `BrowserWindow` the publisher touches. */
export interface BootProgressWindow {
  isDestroyed(): boolean;
  webContents: BootProgressContents;
}

/** Work counts for a step that can count what it does. */
export interface BootProgressCounts {
  done: number;
  count: number;
}

export interface BootProgressPublisher {
  /** Record and publish the state of one step. */
  step(
    stepId: BootProgressStepId,
    state: BootProgressStepState,
    counts?: BootProgressCounts,
  ): void;
  /** Mark every step that is still active as `failed`. */
  failActive(): void;
  /**
   * The latest payload of every started step, in step order. The pull side of
   * the replay: `boot:getReadiness` returns it, so a page whose listener
   * missed the `did-finish-load` replay (or that got none, after a window
   * replacement) still learns where the boot is. Still answers after dispose.
   */
  snapshots(): readonly BootProgressPayload[];
  /** Clear pending ticks and stop listening for page loads. Idempotent. */
  dispose(): void;
}

interface StepRecord {
  payload: BootProgressPayload;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

function warn(action: string, error: unknown): void {
  console.warn(
    `[BootProgress] ${action} failed (non-fatal):`,
    error instanceof Error ? error.message : String(error),
  );
}

export function createBootProgressPublisher(
  getWindow: () => BootProgressWindow | null,
  now: () => number = Date.now,
): BootProgressPublisher {
  const records = new Map<BootProgressStepId, StepRecord>();
  let contents: BootProgressContents | null = null;
  let disposed = false;

  const clearTimer = (record: StepRecord): void => {
    if (record.timer === null) return;
    clearTimeout(record.timer);
    record.timer = null;
  };

  const detach = (): void => {
    const previous = contents;
    contents = null;
    if (previous === null || previous.isDestroyed()) return;
    previous.removeListener('did-finish-load', replay);
  };

  // Follows the window: if it was replaced, the listener moves to the new one.
  const liveContents = (): BootProgressContents | null => {
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
    if (win.webContents !== contents) {
      detach();
      win.webContents.on('did-finish-load', replay);
      contents = win.webContents;
    }
    return contents;
  };

  const flush = (record: StepRecord): void => {
    clearTimer(record);
    record.lastSentAt = now();
    try {
      liveContents()?.send('to-renderer', {
        type: MESSAGE_TYPES.BOOT_PROGRESS,
        payload: record.payload,
      });
    } catch (error: unknown) {
      // degradation-audit: reported - logged by warn(); a lost display update
      // must not fail the boot it narrates.
      warn('send', error);
    }
  };

  function replay(): void {
    if (disposed) return;
    for (const stepId of BOOT_PROGRESS_STEP_IDS) {
      const record = records.get(stepId);
      if (record) flush(record);
    }
  }

  const step: BootProgressPublisher['step'] = (stepId, state, counts) => {
    if (disposed) return;
    const existing = records.get(stepId);
    if (existing && existing.payload.state !== 'active') return;

    const at = now();
    const startedAt = existing?.payload.startedAt ?? at;
    const done = counts?.done ?? existing?.payload.done;
    const count = counts?.count ?? existing?.payload.count;
    const payload: BootProgressPayload = {
      stepId,
      index: BOOT_PROGRESS_STEP_IDS.indexOf(stepId),
      total: BOOT_PROGRESS_STEP_IDS.length,
      state,
      ...(done !== undefined && count !== undefined ? { done, count } : {}),
      ...(state === 'active' ? {} : { elapsedMs: Math.max(0, at - startedAt) }),
      startedAt,
    };

    if (!existing) {
      const record: StepRecord = { payload, lastSentAt: at, timer: null };
      records.set(stepId, record);
      flush(record);
      return;
    }

    existing.payload = payload;
    const wait = existing.lastSentAt + BOOT_PROGRESS_TICK_MS - at;
    if (state !== 'active' || wait <= 0) {
      flush(existing);
      return;
    }
    if (existing.timer === null) {
      existing.timer = setTimeout(() => {
        existing.timer = null;
        flush(existing);
      }, wait);
    }
  };

  // Subscribe now, so a page load before the first step still replays later.
  try {
    liveContents();
  } catch (error: unknown) {
    // degradation-audit: reported - logged by warn(); without the listener only
    // the replay is lost, live sends still subscribe on first use.
    warn('subscribe', error);
  }

  return {
    step,
    failActive: () => {
      for (const stepId of BOOT_PROGRESS_STEP_IDS) {
        if (records.get(stepId)?.payload.state === 'active') {
          step(stepId, 'failed');
        }
      }
    },
    snapshots: () =>
      BOOT_PROGRESS_STEP_IDS.flatMap((stepId) => {
        const record = records.get(stepId);
        return record ? [record.payload] : [];
      }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      records.forEach(clearTimer);
      try {
        detach();
      } catch (error: unknown) {
        // degradation-audit: reported - logged by warn(); disposal runs on quit
        // and a failed listener removal must not block shutdown.
        warn('unsubscribe', error);
      }
    },
  };
}

/**
 * The publisher of the boot in flight, so `shutdown.ts` can dispose it without
 * `main.ts` wiring (its `bootstrapElectron` call is pinned by
 * `state-storage-readiness-gate.spec.ts`).
 */
let current: BootProgressPublisher | null = null;

/** Start publishing for a new boot, disposing the previous publisher. */
export function openBootProgress(
  getWindow: () => BootProgressWindow | null,
): BootProgressPublisher {
  current?.dispose();
  current = createBootProgressPublisher(getWindow);
  return current;
}

/** Dispose the current boot's publisher, if any. */
export function disposeBootProgress(): void {
  current?.dispose();
  current = null;
}
