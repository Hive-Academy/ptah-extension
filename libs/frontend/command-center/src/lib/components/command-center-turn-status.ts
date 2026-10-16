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
    const stored = store.sessionStatus();
    if (stored === 'stopped' || stored === 'error') return stored;
    const root = tabs.tabs().find((tab) => tab.id === store.markedTabId());
    if (
      root?.status === 'streaming' ||
      root?.status === 'awaiting-background' ||
      root?.status === 'sleeping'
    )
      return 'running';
    return stored === 'running' ? 'idle' : stored;
  });
}

/**
 * Keeps the marked tab in the stream viewport while the page lives: off the chat surface the host
 * otherwise retains its chunks and `turn_state`, so no terminal pulse reaches the page (N5).
 * Every page instance owns one registration, including during overlapping surface transitions.
 * Call from an injection context.
 */
export function trackMarkedTabVisibility(
  tabs: TabManagerService,
  store: CommandCenterStore,
): void {
  effect((onCleanup) => {
    const tabId = store.markedTabId();
    if (!tabId) return;
    untracked(() => tabs.registerVisibleTab(tabId));
    onCleanup(() => tabs.unregisterVisibleTab(tabId));
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
    ) {
      store.setSessionStatus(
        pulse.classification === 'success' ? 'idle' : 'error',
      );
      if (pulse.classification === 'error')
        store.setToast({
          message: 'The Command Center turn could not finish.',
          tone: 'error',
        });
    }
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
      const failed =
        (!!root?.lastTerminalReason &&
          root.lastTerminalReason !== 'completed') ||
        (root?.status === 'loaded' &&
          !root.claudeSessionId &&
          root.hasLiveSession === false);
      store.setSessionStatus(failed ? 'error' : 'idle');
      if (failed)
        store.setToast({
          message: 'The Command Center turn could not finish.',
          tone: 'error',
        });
    }
    previousTurnAbortable = streaming;
  });
}
