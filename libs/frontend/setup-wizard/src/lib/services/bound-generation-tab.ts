import type { TabManagerService } from '@ptah-extension/chat-state';
import type { SetupGenerationTabBinding } from '@ptah-extension/shared';

/** Resolve a binding in either a workspace partition or the VS Code active set. */
export function findBoundGenerationTab(
  tabs: TabManagerService,
  binding: Pick<SetupGenerationTabBinding, 'tabId' | 'workspacePath'>,
): ReturnType<TabManagerService['getWorkspaceTabs']>[number] | null {
  const located = tabs.findTabByIdAcrossWorkspaces(binding.tabId);
  if (!located) return null;
  if (located.workspacePath === binding.workspacePath) return located.tab;
  if (
    located.workspacePath === null &&
    tabs
      .getWorkspaceTabs(binding.workspacePath)
      .some((tab) => tab.id === binding.tabId)
  )
    return located.tab;
  return null;
}
