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
 *
 * The host-owned fixture key was the EDITOR entries until TASK_2026_385
 * Batch 4.4 deleted the whole editor RPC surface. `host.fileOpen` is now the
 * ONLY entry in `HostOwnedRpcHandlerKey` — every other P3 handler family has
 * already moved into this library — so the "constructs each class once"
 * dedup test below can no longer exercise two distinct host-owned keys
 * sharing one class. It instead proves the same `seen`-set dedup branch
 * (`register-rpc-surface.ts`) fires across a lib-owned and a host-owned
 * entry that happen to share a constructor: `'agent'` has no capability
 * requirement (`requires: []`), so it is always in the plan, and assigning
 * its real class as the `host.fileOpen` override forces both entries onto
 * the same ctor.
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
import { AgentRpcHandlers } from '../handlers';

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
    hostHandlers: {},
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
    // `agent` is lib-owned with no capability requirement, so it is always in
    // the plan. Assigning its real class as the `host.fileOpen` override too
    // means both manifest entries resolve to the same ctor.
    const shared = AgentRpcHandlers as unknown as RpcHandlerCtor;
    const plan = resolveRpcHandlerPlan(
      profile({
        capabilities: capabilities({ fileOpen: true }),
        hostHandlers: { 'host.fileOpen': shared },
      }),
    );

    expect(plan.filter((step) => step.ctor === shared)).toHaveLength(1);
  });

  it('throws when a capability is on but nothing implements the entry', () => {
    expect(() =>
      resolveRpcHandlerPlan(
        profile({ capabilities: capabilities({ fileOpen: true }) }),
      ),
    ).toThrow(/'host.fileOpen' is enabled but no handler is available/);
  });

  it('throws when a handler is supplied for a switched-off entry', () => {
    expect(() =>
      resolveRpcHandlerPlan(
        profile({
          hostHandlers: {
            'host.fileOpen': FakeHandler as unknown as RpcHandlerCtor,
          },
        }),
      ),
    ).toThrow(/supplies a handler for 'host.fileOpen'/);
  });

  it('marks library-owned entries so their failures stay fatal', () => {
    const plan = resolveRpcHandlerPlan(
      profile({
        capabilities: capabilities({ fileOpen: true }),
        hostHandlers: {
          'host.fileOpen': OtherFakeHandler as unknown as RpcHandlerCtor,
        },
      }),
    );

    const hostOwned = plan.filter((step) => !step.libOwned);
    expect(hostOwned.map((step) => step.key)).toEqual(['host.fileOpen']);
    expect(plan.some((step) => step.libOwned)).toBe(true);
  });
});
