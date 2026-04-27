import 'reflect-metadata';
import { createMockWorkspaceProvider } from '../mocks/workspace-provider.mock';
import { runWorkspaceContract } from './run-workspace-contract';

runWorkspaceContract('createMockWorkspaceProvider', () => {
  const provider = createMockWorkspaceProvider();
  return {
    provider,
    seed({ folders, config }): void {
      if (folders) provider.__state.setFolders(folders);
      if (config) {
        for (const [fullKey, value] of Object.entries(config)) {
          provider.__state.config.set(fullKey, value);
        }
      }
    },
  };
});
