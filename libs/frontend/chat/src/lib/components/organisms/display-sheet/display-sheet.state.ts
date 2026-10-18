import { Injectable, signal } from '@angular/core';

export type DisplaySheetMode = 'peek' | 'full';

/** Height preference is per chat tab. Expanded state lives in DisplayDockState.open. */
@Injectable()
export class DisplaySheetState {
  private readonly modes = signal<ReadonlyMap<string, DisplaySheetMode>>(new Map());

  mode(tabId: string): DisplaySheetMode {
    return this.modes().get(tabId) ?? 'peek';
  }

  setMode(tabId: string, mode: DisplaySheetMode): void {
    this.modes.update((previous) => new Map(previous).set(tabId, mode));
  }

  forgetTab(tabId: string): void {
    this.modes.update((previous) => {
      const next = new Map(previous);
      next.delete(tabId);
      return next;
    });
  }
}
