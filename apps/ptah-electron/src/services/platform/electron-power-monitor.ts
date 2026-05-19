/**
 * ElectronPowerMonitor — `IPowerMonitor` implementation for the Electron host
 * (cron scheduler).
 *
 * Wraps `electron.powerMonitor.on('resume', ...)` / `'suspend'`. The cron
 * scheduler subscribes via this adapter so the `CatchupCoordinator` can
 * replay missed slots when the laptop wakes from sleep.
 *
 * `onResume` / `onSuspend` return a dispose closure rather than emitter-style
 * `removeListener(cb)` so consumers
 * don't have to retain the original callback reference. We adopt the same
 * shape as the gateway's ElectronSafeStorageVault — a stateless implementation
 * that defers entirely to the Electron API and never throws.
 */
import { powerMonitor } from 'electron';
import type { IPowerMonitor } from '@ptah-extension/cron-scheduler';

export class ElectronPowerMonitor implements IPowerMonitor {
  onResume(cb: () => void): () => void {
    const listener = () => {
      cb();
    };
    powerMonitor.on('resume', listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;

      powerMonitor.off('resume', listener);
    };
  }

  onSuspend(cb: () => void): () => void {
    const listener = () => {
      cb();
    };
    powerMonitor.on('suspend', listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;

      powerMonitor.off('suspend', listener);
    };
  }
}
