/**
 * Macrotask scheduling for renderer work that must let the event loop turn
 * (TASK_2026_437 C15 / C18).
 *
 * Why a `MessageChannel` message, and not the obvious alternatives:
 * - `setTimeout(fn, 0)` is clamped to 4 ms once nested, and Chromium throttles
 *   timers in a hidden or occluded Electron window to about once per second.
 * - `requestAnimationFrame` never fires for a hidden window at all.
 * A `MessageChannel` message is an ordinary task in both cases, so a yield or a
 * drain wake-up costs one event-loop turn wherever the renderer is.
 *
 * Every shipping host (Electron renderer, VS Code webview) provides
 * `MessageChannel`. jsdom does not: there `scheduleMacrotask` invokes the
 * callback synchronously and `yieldToMacrotask` resolves on a microtask. A
 * spec that needs real task boundaries installs its own `MessageChannel`. The
 * global is read on every call, so a stub installed after this module loaded
 * is honoured.
 */

/** A scheduled callback that has not necessarily run yet. */
export interface MacrotaskHandle {
  /**
   * Prevent the callback from running and release its channel. A no-op once
   * the callback has run, and on a host without `MessageChannel` (where the
   * callback already ran before `scheduleMacrotask` returned).
   */
  cancel(): void;
}

const NOTHING_TO_CANCEL: MacrotaskHandle = { cancel: () => undefined };

/**
 * Run `callback` in its own macrotask. One fresh channel per call; both ports
 * are closed when the callback runs or the handle is cancelled.
 *
 * Throws what `postMessage` throws, after closing the channel, so the caller
 * can recover (the callback will never run in that case).
 */
export function scheduleMacrotask(callback: () => void): MacrotaskHandle {
  if (typeof MessageChannel === 'undefined') {
    callback();
    return NOTHING_TO_CANCEL;
  }

  const channel = new MessageChannel();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
  };

  channel.port1.onmessage = () => {
    if (released) return;
    release();
    callback();
  };
  try {
    channel.port2.postMessage(null);
  } catch (error: unknown) {
    release();
    throw error;
  }
  return { cancel: release };
}

/**
 * Resolve after one macrotask turn — or after a microtask on a host without
 * `MessageChannel`. Rejects if the underlying post throws.
 */
export function yieldToMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => {
    scheduleMacrotask(resolve);
  });
}
