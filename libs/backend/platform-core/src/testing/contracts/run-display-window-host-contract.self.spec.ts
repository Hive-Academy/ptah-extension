import 'reflect-metadata';
import type {
  DisplayWindowAction,
  DisplayWindowOpenResult,
  DisplayWindowSnapshot,
} from '@ptah-extension/shared';
import { DesktopOnlyDisplayWindowHost } from '../../display-window/desktop-only-display-window-host';
import type { IDisplayWindowHost } from '../../interfaces/display-window-host.interface';
import { runDisplayWindowHostContract } from './run-display-window-host-contract';

runDisplayWindowHostContract('DesktopOnlyDisplayWindowHost', {
  createHost: () => new DesktopOnlyDisplayWindowHost(),
});

/** In-memory supported host: proves the suite's supported branch is satisfiable. */
class InMemoryDisplayWindowHost implements IDisplayWindowHost {
  readonly supported = true;
  readonly delivered: { tabId: string; action: DisplayWindowAction }[] = [];
  private windowOpen = false;
  private latest: DisplayWindowSnapshot | null = null;

  open(): Promise<DisplayWindowOpenResult> {
    this.windowOpen = true;
    return Promise.resolve({ ok: true });
  }

  close(): Promise<boolean> {
    const wasOpen = this.windowOpen;
    this.windowOpen = false;
    return Promise.resolve(wasOpen);
  }

  isOpen(): boolean {
    return this.windowOpen;
  }

  publishState(snapshot: DisplayWindowSnapshot): boolean {
    this.latest = snapshot;
    return true;
  }

  getState(): DisplayWindowSnapshot | null {
    return this.latest;
  }

  relayAction(tabId: string, action: DisplayWindowAction): boolean {
    this.delivered.push({ tabId, action });
    return true;
  }
}

let inMemory = new InMemoryDisplayWindowHost();
runDisplayWindowHostContract('in-memory supported host', {
  createHost: () => {
    inMemory = new InMemoryDisplayWindowHost();
    return inMemory;
  },
  relayed: () => inMemory.delivered,
});
