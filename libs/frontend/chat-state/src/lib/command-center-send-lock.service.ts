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
  readonly state = this._state.asReadonly();

  engage(
    rootTabId: string,
    sdkSessionId: string | null,
    ownerToken: string,
  ): void {
    if (!rootTabId || !ownerToken) return;
    this._state.set({ rootTabId, sdkSessionId, ownerToken, active: true });
  }

  release(ownerToken: string): void {
    if (this._state()?.ownerToken !== ownerToken) return;
    this._state.set(null);
  }

  clearForRoot(tabId: string): void {
    if (this._state()?.rootTabId !== tabId) return;
    this._state.set(null);
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
}
