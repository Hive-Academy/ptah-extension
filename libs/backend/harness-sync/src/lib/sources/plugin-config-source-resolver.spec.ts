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
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import {
  CAPABILITY_POLICY_UNKNOWN_ERROR_NAME,
  type AgentModelLayers,
} from '@ptah-extension/shared';
import type { HarnessSourceLayout } from './harness-source.port';
import { McpIntentStore } from './mcp-intent-store';
import {
  PluginConfigSourceResolver,
  createPluginConfigSourceResolver,
  type HarnessEffectivePluginConfig,
  type HarnessPluginConfigReader,
} from './plugin-config-source-resolver';

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: jest.fn(),
}));

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
    jest.mocked(homedir).mockReturnValue(home);
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

  it.each(['sync', 'effective', 'unavailable'] as const)(
    'reads fresh model layers for the exact reconcile root on the %s path',
    async (mode) => {
      const reader =
        mode === 'unavailable'
          ? null
          : {
              ...syncMembersThatMustNotRun(),
              ...(mode === 'effective'
                ? { getEffectivePluginConfig: async () => effective }
                : {}),
            };
      let layers: AgentModelLayers = {
        workspace: { reviewer: { codex: 'first' } },
      };
      const layersForPath = jest.fn(() => layers);
      const getter = jest.fn(() => ({ layersForPath }));
      const resolver = createPluginConfigSourceResolver(
        () => reader,
        undefined,
        undefined,
        getter,
      );
      expect(getter).not.toHaveBeenCalled();
      expect((await resolver.resolve('/ws/a')).agentModels).toBe(layers);
      layers = { machine: { '*': { codex: 'second' } } };
      expect((await resolver.resolve('/ws/b')).agentModels).toBe(layers);
      expect(layersForPath.mock.calls).toEqual([['/ws/a'], ['/ws/b']]);
      expect(getter).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['absent', 'null', 'getter throws', 'layers throws'] as const)(
    '%s model getter leaves the entire source state unchanged',
    async (mode) => {
      const reader = syncMembersThatMustNotRun();
      const getter =
        mode === 'absent'
          ? undefined
          : () => {
              if (mode === 'null') return null;
              if (mode === 'getter throws') throw new Error('not initialized');
              return {
                layersForPath: () => {
                  throw new Error('unreadable');
                },
              };
            };
      const baseline = await createPluginConfigSourceResolver(
        () => reader,
      ).resolve('/ws/a');
      const actual = await createPluginConfigSourceResolver(
        () => reader,
        undefined,
        undefined,
        getter,
      ).resolve('/ws/a');
      expect(actual.agentModels).toBeUndefined();
      expect(actual).not.toHaveProperty('agentModels');
      expect(JSON.stringify(actual)).toBe(JSON.stringify(baseline));
    },
  );

  it.each([undefined, ''])(
    'does not read model settings without a workspace root (%s)',
    async (root) => {
      const getter = jest.fn(() => ({ layersForPath: jest.fn(() => ({})) }));
      const state = await new PluginConfigSourceResolver(
        () => null,
        undefined,
        undefined,
        getter,
      ).resolve(root);
      expect(getter).not.toHaveBeenCalled();
      expect(state.agentModels).toBeUndefined();
    },
  );
});
