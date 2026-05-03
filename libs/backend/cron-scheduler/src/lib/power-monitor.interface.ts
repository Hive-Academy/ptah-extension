/**
 * IPowerMonitor — platform abstraction for OS power events.
 *
 * The cron scheduler is the only consumer today (gateway adapters maintain
 * their own internal reconnect loops — see architecture §8.5). The Electron
 * implementation wraps `electron.powerMonitor.on('resume', ...)` /
 * `'suspend'`; the VS Code app registers a no-op stub since cron jobs never
 * actually run inside the extension host (see architecture §8.2).
 *
 * Subscriptions return a `dispose` closure rather than emitter-style
 * `removeListener(cb)` calls so consumers don't have to retain the original
 * callback reference for cleanup.
 */
export interface IPowerMonitor {
  /**
   * Subscribe to power-resume events. The returned function unsubscribes the
   * listener; safe to call more than once (subsequent calls are no-ops).
   */
  onResume(cb: () => void): () => void;
  /**
   * Subscribe to power-suspend events. The returned function unsubscribes the
   * listener; safe to call more than once.
   */
  onSuspend(cb: () => void): () => void;
}

/** Stub implementation that registers no listeners — used in VS Code host. */
export class NoopPowerMonitor implements IPowerMonitor {
  onResume(_cb: () => void): () => void {
    return () => {
      /* no-op */
    };
  }

  onSuspend(_cb: () => void): () => void {
    return () => {
      /* no-op */
    };
  }
}
