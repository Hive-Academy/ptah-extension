/**
 * Handler-plan derivation guards.
 *
 * `resolveRpcHandlerPlan` is the contract between a host profile and the
 * manifest. These tests pin the two failure modes it exists to make loud,
 * both of which used to surface as a crash during host activation:
 *
 *  1. a capability is on but nothing implements the entry, and
 *  2. a host supplies a handler for an entry its capabilities switched off.
 *
 * Uses the real manifest — a synthetic one would not prove the guards fire
 * against the shapes hosts actually build.
 */

jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

jest.mock('@ptah-extension/memory-curator', () => ({
  // Pass through the real module so MEMORY_TOKENS and other DI symbols are
  // intact (memory-curator has no native bindings). Only stub the heavy
  // async helper that makes network/FS calls.
  ...jest.requireActual('@ptah-extension/memory-curator'),
  deriveWorkspaceFingerprint: jest.fn(),
}));

import 'reflect-metadata';

import {
  capabilities,
  resolveRpcHandlerPlan,
  type HostProfile,
  type RpcHandlerCtor,
} from './index';

class FakeHandler {
  register(): void {
    /* no-op */
  }
}

class OtherFakeHandler {
  register(): void {
    /* no-op */
  }
}

function profile(overrides: Partial<HostProfile> = {}): HostProfile {
  return {
    platform: 'cli',
    host: 'cli',
    capabilities: capabilities({}),
    // `host.agent` requires nothing, so every host must supply it.
    hostHandlers: { 'host.agent': FakeHandler as unknown as RpcHandlerCtor },
    wiring: {
      worktree: false,
      copilotPermission: false,
      persistCliSession: false,
      sdkSessionIdLookup: false,
      sessionMetadataEvents: false,
    },
    assertOnDrift: false,
    ...overrides,
  };
}

describe('resolveRpcHandlerPlan', () => {
  it('constructs each class once even when it serves several entries', () => {
    const shared = OtherFakeHandler as unknown as RpcHandlerCtor;
    const plan = resolveRpcHandlerPlan(
      profile({
        capabilities: capabilities({ fileOpen: true, filePicker: true }),
        hostHandlers: {
          'host.agent': FakeHandler as unknown as RpcHandlerCtor,
          'host.fileOpen': shared,
          'host.filePicker': shared,
        },
      }),
    );

    expect(plan.filter((step) => step.ctor === shared)).toHaveLength(1);
  });

  it('throws when a capability is on but nothing implements the entry', () => {
    expect(() =>
      resolveRpcHandlerPlan(
        profile({ capabilities: capabilities({ pty: true }) }),
      ),
    ).toThrow(/'host.terminal' is enabled but no handler is available/);
  });

  it('throws when a handler is supplied for a switched-off entry', () => {
    expect(() =>
      resolveRpcHandlerPlan(
        profile({
          hostHandlers: {
            'host.agent': FakeHandler as unknown as RpcHandlerCtor,
            'host.terminal': FakeHandler as unknown as RpcHandlerCtor,
          },
        }),
      ),
    ).toThrow(/supplies a handler for 'host.terminal'/);
  });

  it('marks library-owned entries so their failures stay fatal', () => {
    const plan = resolveRpcHandlerPlan(
      profile({
        capabilities: capabilities({ fileOpen: true }),
        hostHandlers: {
          'host.agent': FakeHandler as unknown as RpcHandlerCtor,
          'host.fileOpen': OtherFakeHandler as unknown as RpcHandlerCtor,
        },
      }),
    );

    const hostOwned = plan.filter((step) => !step.libOwned);
    expect(hostOwned.map((step) => step.key)).toEqual([
      'host.agent',
      'host.fileOpen',
    ]);
    expect(plan.some((step) => step.libOwned)).toBe(true);
  });
});
