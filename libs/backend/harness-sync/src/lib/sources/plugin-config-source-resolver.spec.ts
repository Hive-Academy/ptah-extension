/**
 * `PluginConfigSourceResolver` over the layered capability policy
 * (TASK_2026_560, P9 G1).
 *
 * The pinned rules:
 *   - a reader with `getEffectivePluginConfig` is asked ONCE, and every policy
 *     field of the state comes from that one answer — no workspace-only sync
 *     call is mixed in;
 *   - the policy-unknown error (recognised by name, since agent-sdk may not be
 *     imported here) freezes the state, and any other failure keeps today's
 *     unfiltered `empty` state;
 *   - a reader without the method keeps the synchronous path.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CAPABILITY_POLICY_UNKNOWN_ERROR_NAME } from '@ptah-extension/shared';
import type { HarnessSourceLayout } from './harness-source.port';
import { McpIntentStore } from './mcp-intent-store';
import {
  PluginConfigSourceResolver,
  type HarnessEffectivePluginConfig,
  type HarnessPluginConfigReader,
} from './plugin-config-source-resolver';

/** Structurally what agent-sdk's `CapabilityPolicyUnknownError` looks like. */
function policyUnknownError(): Error {
  const error = new Error("Ptah couldn't read the capability policy");
  error.name = CAPABILITY_POLICY_UNKNOWN_ERROR_NAME;
  return error;
}

describe('PluginConfigSourceResolver — layered policy', () => {
  let home: string;
  let layout: HarnessSourceLayout;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'harness-source-resolver-'));
    layout = {
      skillsRoot: join(home, 'skills'),
      commandsRoot: join(home, 'commands'),
      agentsRoot: join(home, 'agents'),
    };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function resolverFor(
    reader: HarnessPluginConfigReader | null,
  ): PluginConfigSourceResolver {
    return new PluginConfigSourceResolver(
      () => reader,
      layout,
      new McpIntentStore(join(home, '.ptah', 'mcp-installed.json')),
    );
  }

  /** Sync members that fail the test if the effective path mixes them in. */
  function syncMembersThatMustNotRun(): HarnessPluginConfigReader {
    return {
      resolveCurrentPluginPaths: jest.fn(() => ['/sync/overlay']),
      getDisabledSkillIds: jest.fn(() => ['sync-skill']),
      getWorkspacePluginConfig: jest.fn(() => ({
        disabledPluginIds: ['sync-plugin'],
      })),
    };
  }

  const effective: HarnessEffectivePluginConfig = {
    config: {
      disabledSkillIds: ['global-off-skill'],
      disabledPluginIds: ['ptah-harness-release'],
      disabledAgentIds: ['reviewer'],
    },
    fingerprint: 'fp-1',
    overlayPluginPaths: ['/plugins/ptah-angular'],
  };

  it('takes every policy field from ONE effective read and calls no sync member', async () => {
    const sync = syncMembersThatMustNotRun();
    const getEffectivePluginConfig = jest.fn().mockResolvedValue(effective);
    const reader: HarnessPluginConfigReader = {
      ...sync,
      getEffectivePluginConfig,
    };

    const state = await resolverFor(reader).resolve('/ws/a');

    expect(getEffectivePluginConfig).toHaveBeenCalledTimes(1);
    expect(getEffectivePluginConfig).toHaveBeenCalledWith('/ws/a');
    expect(sync.resolveCurrentPluginPaths).not.toHaveBeenCalled();
    expect(sync.getDisabledSkillIds).not.toHaveBeenCalled();
    expect(sync.getWorkspacePluginConfig).not.toHaveBeenCalled();
    expect(state).toEqual(
      expect.objectContaining({
        overlayPluginPaths: ['/plugins/ptah-angular'],
        overlayPluginPathsKnown: true,
        disabledSkillIds: ['global-off-skill'],
        disabledPluginIds: ['ptah-harness-release'],
        disabledAgentIds: ['reviewer'],
        policyFingerprint: 'fp-1',
      }),
    );
    expect(state.policyUnknown).toBeUndefined();
  });

  it('maps the policy-unknown error to a frozen state that claims no overlay', async () => {
    const reader: HarnessPluginConfigReader = {
      ...syncMembersThatMustNotRun(),
      getEffectivePluginConfig: () => Promise.reject(policyUnknownError()),
    };

    const state = await resolverFor(reader).resolve('/ws/a');

    expect(state.policyUnknown).toBe(true);
    expect(state.overlayPluginPathsKnown).toBeUndefined();
    expect(state.policyFingerprint).toBeUndefined();
    expect(state.disabledSkillIds).toEqual([]);
  });

  it('keeps the unfiltered empty state for any other read failure, never frozen', async () => {
    const reader: HarnessPluginConfigReader = {
      ...syncMembersThatMustNotRun(),
      getEffectivePluginConfig: () => Promise.reject(new Error('disk on fire')),
    };

    const state = await resolverFor(reader).resolve('/ws/a');

    expect(state.policyUnknown).toBeUndefined();
    expect(state.overlayPluginPathsKnown).toBeUndefined();
    expect(state.overlayPluginPaths).toEqual([]);
  });

  it('catches a reader that throws synchronously instead of rejecting', async () => {
    const reader: HarnessPluginConfigReader = {
      ...syncMembersThatMustNotRun(),
      getEffectivePluginConfig: () => {
        throw policyUnknownError();
      },
    };

    await expect(resolverFor(reader).resolve()).resolves.toEqual(
      expect.objectContaining({ policyUnknown: true }),
    );
  });

  it('a reader without the method keeps the synchronous workspace path', () => {
    const reader = syncMembersThatMustNotRun();

    const state = resolverFor(reader).resolve('/ws/a');

    // Synchronous: not a Promise, so every existing caller sees today's shape.
    expect(state).not.toBeInstanceOf(Promise);
    expect(state).toEqual(
      expect.objectContaining({
        overlayPluginPaths: ['/sync/overlay'],
        overlayPluginPathsKnown: true,
        disabledSkillIds: ['sync-skill'],
        disabledPluginIds: ['sync-plugin'],
      }),
    );
  });
});
