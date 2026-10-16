import { effect } from '@angular/core';
import type { TabManagerService } from '@ptah-extension/chat-state';
import type { CommandCenterStore } from '../model/command-center.store';
import type { CommandCenterSessionCoordinator } from '../model/session-coordinator';

/** Follows workspace changes for the lifetime of the page. Call from an injection context. */
export function trackWorkspaceBinding(
  tabs: TabManagerService,
  store: CommandCenterStore,
  coordinator: CommandCenterSessionCoordinator,
): { open: () => Promise<string | null>; canSend: () => boolean } {
  let opening: Promise<string | null> | null = null;
  let observedWorkspace = tabs.activeWorkspacePath;
  const clear = (): void => {
    store.setSession(null, null, null);
    store.setSessionStatus('error');
    store.setToast({
      message: 'Open a workspace to use Command Center.',
      tone: 'error',
    });
  };
  const open = (): Promise<string | null> => {
    if (opening) return opening;
    if (!tabs.activeWorkspacePath) {
      clear();
      return Promise.resolve(null);
    }
    const pending = (async (): Promise<string | null> => {
      let result: string | null;
      // Always open once; open again only if the workspace changed while opening.
      do {
        const before = store.workspace();
        result = await coordinator.openOrResume();
        if (!result || store.workspace() === before) break;
      } while (
        tabs.activeWorkspacePath &&
        tabs.activeWorkspacePath !== store.workspace()
      );
      if (!tabs.activeWorkspacePath) clear();
      return result;
    })();
    opening = pending;
    void pending
      .finally(() => {
        if (opening === pending) opening = null;
      })
      .catch(() => {
        // degradation-audit: reported — the caller of open() handles the rejection; this chain only clears the in-flight marker
      });
    return pending;
  };
  /** A send goes only to the session of the active workspace; a stale binding rebinds first. */
  const canSend = (): boolean => {
    const active = tabs.activeWorkspacePath;
    if (active && store.workspace() === active) return true;
    store.setToast({
      message: active
        ? 'Command Center is switching to the selected workspace. Send again when it is ready.'
        : 'Open a workspace to use Command Center.',
      tone: 'error',
    });
    if (active)
      void open().catch(() => {
        // degradation-audit: reported — the coordinator reports open failures through the safe toast
      });
    return false;
  };
  effect(() => {
    const workspace = tabs.activeWorkspacePath$();
    if (workspace === observedWorkspace) return;
    observedWorkspace = workspace;
    if (!workspace) {
      if (store.workspace()) clear();
    } else if (workspace !== store.workspace()) {
      void open().catch(() => {
        // degradation-audit: reported — the coordinator reports open failures through the safe toast
      });
    }
  });
  return { open, canSend };
}
