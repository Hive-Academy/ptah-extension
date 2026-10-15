import { effect, inject, type Signal, untracked } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';
import { EffortStateService, ModelStateService } from '@ptah-extension/core';

/** Freeze defaults on first load for the session hosted by a canvas view. */
export function freezeSessionOverrides(tabId: Signal<string>): void {
  const effortState = inject(EffortStateService);
  const modelState = inject(ModelStateService);
  const tabManager = inject(TabManagerService);

  effect(() => {
    const id = tabId();
    if (!effortState.isLoaded()) return;
    untracked(() => {
      const tab = tabManager.tabs().find((t) => t.id === id);
      if (tab && tab.overrideEffort === undefined) {
        tabManager.setOverrideEffort(
          id,
          effortState.currentEffort() ?? null,
        );
      }
    });
  });

  effect(() => {
    const id = tabId();
    if (!modelState.isLoaded()) return;
    untracked(() => {
      const tab = tabManager.tabs().find((t) => t.id === id);
      if (tab && tab.overrideModel === undefined) {
        const current = modelState.currentModel();
        if (current) {
          tabManager.setOverrideModel(id, current);
        }
      }
    });
  });
}
