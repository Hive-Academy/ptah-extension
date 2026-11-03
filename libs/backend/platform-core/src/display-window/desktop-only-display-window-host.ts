import type {
  DisplayWindowOpenResult,
  DisplayWindowSnapshot,
} from '@ptah-extension/shared';
import type { IDisplayWindowHost } from '../interfaces/display-window-host.interface';

/**
 * `IDisplayWindowHost` for hosts without a detached window (VS Code, CLI).
 * `open` resolves with the typed `desktop-only` result; every other method
 * returns its negative value and keeps no state.
 */
export class DesktopOnlyDisplayWindowHost implements IDisplayWindowHost {
  readonly supported = false;

  open(): Promise<DisplayWindowOpenResult> {
    return Promise.resolve({ ok: false, reason: 'desktop-only' });
  }

  close(): Promise<boolean> {
    return Promise.resolve(false);
  }

  isOpen(): boolean {
    return false;
  }

  /** Keeps nothing: there is no window to forward the snapshot to. */
  publishState(): boolean {
    return false;
  }

  getState(): DisplayWindowSnapshot | null {
    return null;
  }

  /** Relays nothing: no child window exists to send an action. */
  relayAction(): boolean {
    return false;
  }
}
