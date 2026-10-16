import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabViewMode } from '@ptah-extension/chat-types';

/** A docked open/closed choice the user made, tied to the view mode it was made in. */
interface DockedChoice {
  readonly open: boolean;
  readonly mode: TabViewMode;
}

/**
 * The per-tab docked inspector choice, in memory only. A choice made in
 * another view mode counts as absent, so a mode change falls back to the
 * default without a hook into `TabManagerService`. The overlay sheet never
 * writes here.
 */
@Injectable({ providedIn: 'root' })
export class InspectorOpenStateService {
  private readonly tabManager = inject(TabManagerService);
  private readonly choices = signal<ReadonlyMap<string, DockedChoice>>(
    new Map(),
  );

  constructor() {
    const unsubscribe = this.tabManager.onTabClosed(({ tabId }) =>
      this.forget(tabId),
    );
    inject(DestroyRef).onDestroy(unsubscribe);
  }

  /**
   * Docked open state: the stored choice for this mode, else
   * `initialOpen ?? (mode === 'full')`. Reads a signal, so it is reactive.
   */
  dockedOpen(
    tabId: string,
    mode: TabViewMode,
    initialOpen: boolean | null,
  ): boolean {
    const choice = this.choices().get(tabId);
    if (choice && choice.mode === mode) return choice.open;
    return initialOpen ?? mode === 'full';
  }

  setDocked(tabId: string, mode: TabViewMode, open: boolean): void {
    this.choices.update((current) => {
      const existing = current.get(tabId);
      if (existing?.open === open && existing.mode === mode) return current;
      return new Map(current).set(tabId, { open, mode });
    });
  }

  forget(tabId: string): void {
    this.choices.update((current) => {
      if (!current.has(tabId)) return current;
      const next = new Map(current);
      next.delete(tabId);
      return next;
    });
  }
}
