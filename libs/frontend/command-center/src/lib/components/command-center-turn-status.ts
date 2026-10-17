import {
  computed,
  DestroyRef,
  effect,
  inject,
  untracked,
  type Signal,
} from '@angular/core';
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
  const registered = new Map<string, number>();
  inject(DestroyRef).onDestroy(() => {
    for (const tabId of registered.keys()) tabs.unregisterVisibleTab(tabId);
    registered.clear();
  });
  effect(() => {
    const tabId = store.markedTabId();
    tabs.tabs();
    const pulses = tabs.lastTerminalPulseByTab();
    for (const [previous, initialPulseSeq] of registered) {
      if (previous === tabId) continue;
      const status = tabs.findTabByIdAcrossWorkspaces(previous)?.tab.status;
      const settled = (pulses.get(previous)?.seq ?? 0) > initialPulseSeq;
      if (
        !settled &&
        (status === 'streaming' ||
          status === 'resuming' ||
          status === 'switching')
      )
        continue;
      untracked(() => tabs.unregisterVisibleTab(previous));
      registered.delete(previous);
    }
    if (tabId && !registered.has(tabId)) {
      untracked(() => tabs.registerVisibleTab(tabId));
      registered.set(tabId, pulses.get(tabId)?.seq ?? 0);
    }
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
  let statusPulseSeq = untracked(
    () =>
      tabs.lastTerminalPulseByTab().get(store.markedTabId() ?? '')?.seq ?? 0,
  );
  let previousTurnAbortable = false;
  effect(() => {
    const tabId = store.markedTabId();
    const pulse = tabId ? tabs.lastTerminalPulseByTab().get(tabId) : undefined;
    if (!pulse || pulse.seq <= statusPulseSeq) return;
    const root = tabId ? tabs.findTabByIdAcrossWorkspaces(tabId)?.tab : null;
    if (
      !turnAbortable() &&
      root?.status !== 'awaiting-background' &&
      root?.status !== 'sleeping' &&
      pulse.terminalReason !== 'aborted_streaming' &&
      pulse.terminalReason !== 'aborted_tools' &&
      store.sessionStatus() !== 'stopped' &&
      (store.sessionStatus() === 'running' || pulse.classification === 'error')
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
    if (
      !turnAbortable() &&
      root?.status !== 'awaiting-background' &&
      root?.status !== 'sleeping'
    )
      statusPulseSeq = pulse.seq;
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
          root.lastTerminalReason !== 'completed' &&
          root.lastTerminalReason !== 'aborted_streaming' &&
          root.lastTerminalReason !== 'aborted_tools') ||
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
