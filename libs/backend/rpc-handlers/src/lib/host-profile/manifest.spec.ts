jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

jest.mock('@ptah-extension/memory-curator', () => ({
  ...jest.requireActual('@ptah-extension/memory-curator'),
  deriveWorkspaceFingerprint: jest.fn(),
}));

import 'reflect-metadata';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { RPC_HANDLER_MANIFEST, assertManifestInvariants } from './manifest';
import { capabilities, type HostProfile } from './host-profile';
import { deriveRpcSurface } from './register-rpc-surface';

const generationMethods = [
  'enhancedPrompts:cancel',
  'enhancedPrompts:getRunState',
  'wizard:get-generation-run-state',
];

describe('generation RPC manifest', () => {
  it('claims every registry method exactly once', () => {
    expect(() => assertManifestInvariants(RPC_METHOD_NAMES)).not.toThrow();
  });

  it.each(['vscode', 'electron', 'cli', 'tui'] as const)(
    '%s serves all generation methods alongside its existing methods',
    (host) => {
      const profile: HostProfile = {
        host,
        platform:
          host === 'vscode'
            ? 'vscode'
            : host === 'electron'
              ? 'electron'
              : 'cli',
        capabilities: capabilities({}),
        hostHandlers: {},
        wiring: {
          worktree: false,
          copilotPermission: false,
          persistCliSession: false,
          sdkSessionIdLookup: false,
          sessionMetadataEvents: false,
        },
        assertOnDrift: false,
      };
      const registered = deriveRpcSurface(profile).registered;
      expect(registered).toEqual(
        expect.arrayContaining([
          'enhancedPrompts:runWizard',
          'wizard:submit-selection',
          ...generationMethods,
        ]),
      );
      expect(RPC_HANDLER_MANIFEST.flatMap((entry) => entry.methods)).toEqual(
        expect.arrayContaining(generationMethods),
      );
    },
  );
});
