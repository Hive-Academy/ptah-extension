import { Injectable, signal } from '@angular/core';

export interface CommandCenterSendLockState {
  rootTabId: string;
  sdkSessionId: string | null;
  ownerToken: string;
  active: boolean;
}

/** Page-lifetime ownership of sends into the Command Center root session. */
@Injectable({ providedIn: 'root' })
export class CommandCenterSendLockService {
  private readonly _state = signal<CommandCenterSendLockState | null>(null);
  private readonly releaseListeners = new Set<(rootTabId: string) => void>();
  readonly state = this._state.asReadonly();

  onRelease(listener: (rootTabId: string) => void): () => void {
    this.releaseListeners.add(listener);
    return () => this.releaseListeners.delete(listener);
  }

  engage(
    rootTabId: string,
    sdkSessionId: string | null,
    ownerToken: string,
  ): void {
    if (!rootTabId || !ownerToken) return;
    const previous = this._state();
    this._state.set({ rootTabId, sdkSessionId, ownerToken, active: true });
    if (previous?.active && previous.rootTabId !== rootTabId) {
      this.notifyRelease(previous.rootTabId);
    }
  }

  release(ownerToken: string): void {
    const current = this._state();
    if (!current?.active || current.ownerToken !== ownerToken) return;
    this._state.set(null);
    this.notifyRelease(current.rootTabId);
  }

  clearForRoot(tabId: string): void {
    const current = this._state();
    if (!current?.active || current.rootTabId !== tabId) return;
    this._state.set(null);
    this.notifyRelease(current.rootTabId);
  }

  rekey(rootTabId: string, sdkSessionId: string): void {
    const current = this._state();
    if (!current?.active || current.rootTabId !== rootTabId || !sdkSessionId)
      return;
    this._state.set({ ...current, sdkSessionId });
  }

  isHeld(tabIdOrSdkId: string, ownerToken?: string): boolean {
    const current = this._state();
    return (
      !!current?.active &&
      (current.rootTabId === tabIdOrSdkId ||
        current.sdkSessionId === tabIdOrSdkId) &&
      current.ownerToken !== ownerToken
    );
  }

  private notifyRelease(rootTabId: string): void {
    // Each listener is isolated so one failure cannot skip a later queue flush.
    for (const listener of Array.from(this.releaseListeners)) {
      try {
        listener(rootTabId);
      } catch (error) {
        console.warn('[CommandCenterSendLock] Release listener failed:', error);
      }
    }
  }
}
