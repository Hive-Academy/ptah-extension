import 'reflect-metadata';
import { createMockWorkspaceLifecycleProvider } from '../mocks/workspace-lifecycle-provider.mock';
import {
  runWorkspaceLifecycleContract,
  type WorkspaceLifecycleProviderSetup,
} from './run-workspace-lifecycle-contract';

runWorkspaceLifecycleContract('createMockWorkspaceLifecycleProvider', () => {
  const mock = createMockWorkspaceLifecycleProvider();
  const setup: WorkspaceLifecycleProviderSetup = {
    provider: mock,
    seed(folders: string[]): void {
      mock.__state.setFolders(folders);
    },
    getFolders(): string[] {
      return [...mock.__state.folders];
    },
    subscribeToFolderChanges(fn: () => void) {
      return mock.onDidChangeWorkspaceFolders(fn);
    },
  };
  return setup;
});
