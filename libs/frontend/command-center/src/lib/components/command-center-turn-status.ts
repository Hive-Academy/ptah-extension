import { computed, effect, untracked, type Signal } from '@angular/core';
import type { TabManagerService } from '@ptah-extension/chat-state';
import type {
  CommandCenterStore,
  CommandSessionStatus,
} from '../model/command-center.store';

export function shownSessionStatus(
  tabs: TabManagerService,
  store: CommandCenterStore,
): Signal<CommandSessionStatus> {
  return computed(() => {
    const root = tabs.tabs().find((tab) => tab.id === store.markedTabId());
    if (
      root?.status === 'streaming' ||
      root?.status === 'awaiting-background' ||
      root?.status === 'sleeping'
    )
      return 'running';
    const stored = store.sessionStatus();
    return stored === 'running' ? 'idle' : stored;
  });
}

/**
 * Keeps the marked tab in the stream viewport while the page lives: off the chat surface the host
 * otherwise retains its chunks and `turn_state`, so no terminal pulse reaches the page (N5). A tab
 * that was already visible is left to the surface that registered it (the set is not ref-counted).
 * Call from an injection context.
 */
export function trackMarkedTabVisibility(
  tabs: TabManagerService,
  store: CommandCenterStore,
): void {
  effect((onCleanup) => {
    const tabId = store.markedTabId();
    if (!tabId) return;
    const registered = untracked(() => {
      if (tabs.visibleTabIds().has(tabId)) return false;
      tabs.registerVisibleTab(tabId);
      return true;
    });
    if (registered) onCleanup(() => tabs.unregisterVisibleTab(tabId));
  });
}

/**
 * Settles a `running` session status when the root turn ends: on a terminal pulse once the root
 * tab is no longer streaming, or when the root leaves `streaming` with no pulse (M-2).
 * Call from an injection context.
 */
export function trackTurnStatus(
  tabs: TabManagerService,
  store: CommandCenterStore,
  turnAbortable: Signal<boolean>,
): void {
  let statusPulseSeq = 0;
  let previousTurnAbortable = false;
  effect(() => {
    const tabId = store.markedTabId();
    const pulse = tabId ? tabs.lastTerminalPulseByTab().get(tabId) : undefined;
    if (!pulse || pulse.seq <= statusPulseSeq) return;
    statusPulseSeq = pulse.seq;
    const root = tabs.tabs().find((tab) => tab.id === tabId);
    if (
      !turnAbortable() &&
      root?.status !== 'awaiting-background' &&
      root?.status !== 'sleeping' &&
      store.sessionStatus() === 'running'
    )
      store.setSessionStatus(
        pulse.classification === 'success' ? 'idle' : 'error',
      );
  });
  effect(() => {
    const streaming = turnAbortable();
    const root = tabs.tabs().find((tab) => tab.id === store.markedTabId());
    if (
      previousTurnAbortable &&
      !streaming &&
      root?.status !== 'awaiting-background' &&
      root?.status !== 'sleeping' &&
      store.sessionStatus() === 'running'
    ) {
      store.setSessionStatus(
        root?.lastTerminalReason && root.lastTerminalReason !== 'completed'
          ? 'error'
          : 'idle',
      );
    }
    previousTurnAbortable = streaming;
  });
}
