jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

jest.mock('@ptah-extension/memory-curator', () => ({
  ...jest.requireActual('@ptah-extension/memory-curator'),
  deriveWorkspaceFingerprint: jest.fn(),
}));

import 'reflect-metadata';
import {
  PROVIDER_ACCOUNT_RPC_METHOD_NAMES,
  RPC_METHOD_NAMES,
} from '@ptah-extension/shared';
import { RPC_HANDLER_MANIFEST, assertManifestInvariants } from './manifest';
import type { HostCapabilities } from './capabilities';
import { capabilities, type HostProfile } from './host-profile';
import { deriveRpcSurface } from './register-rpc-surface';
import { ProviderAccountRpcHandlers } from '../handlers/provider-account-rpc.handlers';

function surfaceFor(caps: HostCapabilities) {
  return deriveRpcSurface({
    host: 'electron',
    platform: 'electron',
    capabilities: caps,
    hostHandlers: {},
    wiring: {
      worktree: false,
      copilotPermission: false,
      persistCliSession: false,
      sdkSessionIdLookup: false,
      sessionMetadataEvents: false,
    },
    assertOnDrift: false,
  });
}

describe('provider account RPC manifest (TASK_2026_712 D30)', () => {
  const accountMethods: string[] = [
    ...PROVIDER_ACCOUNT_RPC_METHOD_NAMES,
  ].sort();

  it('gates exactly the account methods behind providerAccounts', () => {
    const entry = RPC_HANDLER_MANIFEST.find(
      (candidate) => candidate.key === 'providerAccounts',
    );
    expect(entry?.requires).toEqual(['providerAccounts']);
    expect(entry?.handler).toBe(ProviderAccountRpcHandlers);
    expect([...(entry?.methods ?? [])].sort()).toEqual(accountMethods);
  });

  it('keeps every account method in the RPC registry', () => {
    expect(RPC_METHOD_NAMES).toEqual(expect.arrayContaining(accountMethods));
  });

  it('serves the account methods only when providerAccounts is on', () => {
    const off = surfaceFor(capabilities({}));
    expect(off.excluded).toEqual(expect.arrayContaining(accountMethods));
    expect(off.registered.filter((m) => accountMethods.includes(m))).toEqual(
      [],
    );

    const on = surfaceFor(capabilities({ providerAccounts: true }));
    expect(on.registered).toEqual(expect.arrayContaining(accountMethods));
    expect(on.excluded.filter((m) => accountMethods.includes(m))).toEqual([]);
  });
});

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
