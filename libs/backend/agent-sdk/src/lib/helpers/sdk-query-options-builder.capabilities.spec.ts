/**
 * TASK_2026_560, C5 — the capability policy on a Claude SDK session.
 *
 * A verified policy is enforced on the FLAG tier (`Options.settings`), which
 * outranks user, project and local settings:
 * - `deniedMcpServers` + `disabledMcpjsonServers` for every OFF server, so a
 *   repository server stays off even under the user's `enableAllProjectMcpServers`;
 * - `enabledMcpjsonServers` for explicitly approved repository servers only;
 * - `skillOverrides: {name: 'off'}` for every denied skill, including a global
 *   OFF and every child of an OFF plugin.
 *
 * An unverified policy (unreadable store, missing or failing resolver) runs
 * strict MCP with ptah only, `skills: []`, and publishes the
 * `capability-policy-unverified` notice (R8).
 *
 * These specs drive the real `build()` with a mocked policy — the resolver
 * itself lives in `cli-agent-runtime` and is never imported here.
 */

import 'reflect-metadata';
import type {
  AISessionConfig,
  AuthEnv,
  EffectiveCapabilitySet,
  McpHttpServerOverride,
} from '@ptah-extension/shared';
import {
  SdkQueryOptionsBuilder,
  buildFlagSettings,
  capabilityFlagsFor,
  resolveSessionCapabilityPolicy,
  unverifiedCapabilityPolicy,
} from './sdk-query-options-builder';
import type {
  SessionMcpStatusCallbackRegistry,
  SessionMcpStatusEvent,
} from './session-mcp-status-callback-registry';
import type { Options } from '../types/sdk-types/claude-sdk.types';
import { PTAH_DISABLE_SDK_AUTO_MEMORY } from '../constants';

const PROJECT = 'D:/tmp/ws';
const PROXY_AUTH: AuthEnv = {
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080',
  ANTHROPIC_AUTH_TOKEN: 'proxy-token',
};

function policy(
  overrides: Partial<EffectiveCapabilitySet> = {},
): EffectiveCapabilitySet {
  return {
    physicalRoot: PROJECT,
    policyKey: PROJECT,
    status: 'verified',
    reasons: [],
    ptahEnabled: true,
    deniedMcpServers: [],
    approvedProjectMcpServers: [],
    deniedSkillNames: [],
    disabledPluginIds: [],
    harnessFingerprint: 'fp',
    ...overrides,
  };
}

interface BuildInput {
  capabilityPolicy?: EffectiveCapabilitySet;
  backingOff?: string[];
  authEnv?: AuthEnv;
  mcpServersOverride?: Record<string, McpHttpServerOverride>;
}

interface Built {
  options: Options;
  /** `options.settings`, parsed — it is serialized on the interactive path. */
  settings: Record<string, unknown>;
  events: SessionMcpStatusEvent[];
}

async function build(input: BuildInput = {}): Promise<Built> {
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const events: SessionMcpStatusEvent[] = [];
  const mcpStatus = {
    notifyAll: (event: SessionMcpStatusEvent) => {
      events.push(event);
    },
  } as unknown as SessionMcpStatusCallbackRegistry;
  const mcpBackoff = {
    getBackingOffServers: jest.fn().mockReturnValue(input.backingOff ?? []),
    trackStderrSession: jest.fn(),
    checkStderrForFailure: jest.fn(),
  };

  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  const builder = new ctor(
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    },
    noopHooks,
    {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: true, contextTokenThreshold: null }),
    },
    noopHooks,
    noopHooks,
    {},
    {
      resolveModelId: jest.fn().mockImplementation((m: string) => m),
      hasCachedModels: jest.fn().mockReturnValue(false),
      getSupportedModels: jest.fn(),
    },
    {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    },
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    undefined,
    mcpStatus,
    mcpBackoff,
  );

  const cfg = await builder.build({
    userMessageStream: (async function* () {
      // Intentionally empty — build() attaches the stream, it does not iterate.
    })(),
    abortController: new AbortController(),
    sessionConfig: {
      model: 'claude-sonnet-4-5',
      projectPath: PROJECT,
      tabId: 'tab-fixture',
    } as AISessionConfig,
    authEnvOverride: input.authEnv ?? {},
    mcpServersOverride: input.mcpServersOverride,
    capabilityPolicy: input.capabilityPolicy,
  });

  return {
    options: cfg.options,
    settings: JSON.parse(cfg.options.settings as string) as Record<
      string,
      unknown
    >,
    events,
  };
}

/** Only the capability keys of the flag tier, for parity comparisons. */
function capabilityKeys(built: Built): Record<string, unknown> {
  const {
    deniedMcpServers,
    disabledMcpjsonServers,
    enabledMcpjsonServers,
    skillOverrides,
  } = built.settings;
  return {
    deniedMcpServers,
    disabledMcpjsonServers,
    enabledMcpjsonServers,
    skillOverrides,
    strictMcpConfig: built.options.strictMcpConfig,
    skills: built.options.skills,
    mcpServers: Object.keys(built.options.mcpServers ?? {}),
  };
}

describe('SdkQueryOptionsBuilder — capability policy (TASK_2026_560, C5)', () => {
  describe('verified policy → flag tier', () => {
    it('denies a repository server that is OFF, whatever the user enableAll says', async () => {
      // The user's `enableAllProjectMcpServers: true` lives in a lower tier
      // (user/local settings); the flag tier outranks it, so the denial here is
      // what keeps `repo-off` from loading. Ptah itself never emits enableAll.
      const built = await build({
        capabilityPolicy: policy({ deniedMcpServers: ['repo-off'] }),
      });

      expect(built.settings['deniedMcpServers']).toEqual([
        { serverName: 'repo-off' },
      ]);
      expect(built.settings['disabledMcpjsonServers']).toEqual(['repo-off']);
      expect(built.settings).not.toHaveProperty('enableAllProjectMcpServers');
      expect(built.options.strictMcpConfig).toBeUndefined();
      expect(built.options.skills).toBeUndefined();
    });

    it('approves an explicitly-ON repository server, and only that one', async () => {
      const built = await build({
        capabilityPolicy: policy({
          approvedProjectMcpServers: ['firecrawl'],
          deniedMcpServers: ['davinci-resolve'],
        }),
      });

      expect(built.settings['enabledMcpjsonServers']).toEqual(['firecrawl']);
    });

    it('emits no capability key and no notice when nothing is off', async () => {
      const built = await build({ capabilityPolicy: policy() });

      expect(built.settings).toEqual({
        autoMemoryEnabled: false,
        autoDreamEnabled: false,
        crossSessionInbound: 'accept',
      });
      expect(built.events).toEqual([]);
    });

    it('gives a direct and a proxied (custom base URL) session the same lists', async () => {
      const shared = policy({
        deniedMcpServers: ['davinci-resolve', 'shopify-dev-mcp'],
        approvedProjectMcpServers: ['firecrawl'],
        deniedSkillNames: ['off-skill', 'plug:child'],
      });
      const direct = await build({ capabilityPolicy: shared });
      const proxied = await build({
        capabilityPolicy: shared,
        authEnv: PROXY_AUTH,
      });

      // Really two different routes: the proxy drops the `user` source …
      expect(direct.options.settingSources).toContain('user');
      expect(proxied.options.settingSources).not.toContain('user');
      // … and the flag tier, which it never drops, carries identical lists.
      expect(capabilityKeys(proxied)).toEqual(capabilityKeys(direct));
      expect(capabilityKeys(direct)).toMatchObject({
        disabledMcpjsonServers: ['davinci-resolve', 'shopify-dev-mcp'],
        enabledMcpjsonServers: ['firecrawl'],
      });
    });

    it('keeps ptah by default', async () => {
      const built = await build({ capabilityPolicy: policy() });

      expect(Object.keys(built.options.mcpServers ?? {})).toEqual(['ptah']);
    });

    it('drops ptah — and denies it — only when the policy turned it OFF', async () => {
      const built = await build({
        capabilityPolicy: policy({ ptahEnabled: false }),
      });

      expect(built.options.mcpServers).toEqual({});
      expect(built.settings['deniedMcpServers']).toEqual([
        { serverName: 'ptah' },
      ]);
    });

    it('lets back-off win over an explicit approval (AC-4.7)', async () => {
      const built = await build({
        capabilityPolicy: policy({ approvedProjectMcpServers: ['flaky'] }),
        backingOff: ['flaky'],
      });

      expect(built.settings['disabledMcpjsonServers']).toEqual(['flaky']);
      expect(built.settings).not.toHaveProperty('enabledMcpjsonServers');
    });

    it('still suppresses a backing-off server the policy leaves ON', async () => {
      const built = await build({
        capabilityPolicy: policy(),
        backingOff: ['flaky'],
      });

      expect(built.settings['deniedMcpServers']).toEqual([
        { serverName: 'flaky' },
      ]);
    });

    it('denies every child skill of an OFF plugin, bare and plugin-qualified', async () => {
      const built = await build({
        capabilityPolicy: policy({
          disabledPluginIds: ['plug'],
          deniedSkillNames: [
            'child-a',
            'plug:child-a',
            'child-b',
            'plug:child-b',
          ],
        }),
      });

      expect(built.settings['skillOverrides']).toEqual({
        'child-a': 'off',
        'plug:child-a': 'off',
        'child-b': 'off',
        'plug:child-b': 'off',
      });
    });

    it('denies a global-OFF skill that arrives in deniedSkillNames (P9)', async () => {
      // The resolver folds the GLOBAL layer into `deniedSkillNames`; the
      // builder reads skills from the set only, never from the loader's
      // workspace-only sync methods.
      const built = await build({
        capabilityPolicy: policy({ deniedSkillNames: ['global-off-skill'] }),
      });

      expect(built.settings['skillOverrides']).toEqual({
        'global-off-skill': 'off',
      });
      expect(built.options.skills).toBeUndefined();
    });

    it('removes a denied server a caller override supplied', async () => {
      const built = await build({
        capabilityPolicy: policy({ deniedMcpServers: ['firecrawl'] }),
        mcpServersOverride: {
          firecrawl: { type: 'http', url: 'http://127.0.0.1:9/firecrawl' },
          allowed: { type: 'http', url: 'http://127.0.0.1:9/allowed' },
        } as Record<string, McpHttpServerOverride>,
      });

      expect(Object.keys(built.options.mcpServers ?? {}).sort()).toEqual([
        'allowed',
        'ptah',
      ]);
    });
  });

  describe('unverified policy → strict MCP, no skills, notice', () => {
    const unverified = policy({
      status: 'unverified',
      reasons: [
        {
          path: '/home/u/.ptah/capabilities/global/mcp__l_x.json',
          error: 'invalid JSON',
        },
      ],
      // Whatever an unreadable store half-computed must be ignored.
      deniedMcpServers: ['x'],
      approvedProjectMcpServers: ['y'],
      deniedSkillNames: ['z'],
    });

    it('runs strict MCP with ptah only and skills: []', async () => {
      const built = await build({
        capabilityPolicy: unverified,
        mcpServersOverride: {
          other: { type: 'http', url: 'http://127.0.0.1:9/other' },
        } as Record<string, McpHttpServerOverride>,
      });

      expect(built.options.strictMcpConfig).toBe(true);
      expect(built.options.skills).toEqual([]);
      expect(Object.keys(built.options.mcpServers ?? {})).toEqual(['ptah']);
      expect(built.settings).not.toHaveProperty('enabledMcpjsonServers');
      expect(built.settings).not.toHaveProperty('skillOverrides');
    });

    it('omits ptah only when a readable store says it is OFF', async () => {
      const built = await build({
        capabilityPolicy: { ...unverified, ptahEnabled: false },
      });

      expect(built.options.strictMcpConfig).toBe(true);
      expect(built.options.mcpServers).toEqual({});
    });

    it('also denies ptah on the flag tier when a readable store says it is OFF', async () => {
      // Same defence in depth as the verified-OFF path: a user-scope `ptah`
      // entry cannot come back through any lower settings tier.
      const built = await build({
        capabilityPolicy: { ...unverified, ptahEnabled: false },
        backingOff: ['flaky'],
      });

      expect(built.settings['deniedMcpServers']).toEqual([
        { serverName: 'ptah' },
        { serverName: 'flaky' },
      ]);
      expect(built.settings['disabledMcpjsonServers']).toEqual([
        'ptah',
        'flaky',
      ]);
    });

    it('does not deny ptah on the flag tier while it is ON', async () => {
      const built = await build({ capabilityPolicy: unverified });

      expect(built.settings).not.toHaveProperty('deniedMcpServers');
    });

    it('publishes the capability-policy-unverified notice naming the path', async () => {
      const built = await build({ capabilityPolicy: unverified });

      expect(built.events).toHaveLength(1);
      expect(built.events[0]).toMatchObject({
        kind: 'notice',
        sessionId: 'tab-fixture',
        notice: { code: 'capability-policy-unverified' },
      });
      const event = built.events[0];
      const message = event.kind === 'notice' ? event.notice.message : '';
      expect(message).toContain(
        'Only Ptah tools are loaded and skills are off',
      );
      expect(message).toContain(
        '/home/u/.ptah/capabilities/global/mcp__l_x.json (invalid JSON)',
      );
    });

    it('fails closed for the fallback policy of a missing resolver', async () => {
      const built = await build({
        capabilityPolicy: unverifiedCapabilityPolicy(
          PROJECT,
          'the capability resolver is not available',
        ),
      });

      expect(built.options.strictMcpConfig).toBe(true);
      expect(built.options.skills).toEqual([]);
      expect(Object.keys(built.options.mcpServers ?? {})).toEqual(['ptah']);
      expect(built.events).toHaveLength(1);
    });

    it('fails closed when a caller supplies no policy at all', async () => {
      const built = await build({});

      expect(built.options.strictMcpConfig).toBe(true);
      expect(built.options.skills).toEqual([]);
      expect(Object.keys(built.options.mcpServers ?? {})).toEqual(['ptah']);
    });

    it('keeps suppressing back-off servers', async () => {
      const built = await build({
        capabilityPolicy: unverified,
        backingOff: ['flaky'],
      });

      expect(built.settings['disabledMcpjsonServers']).toEqual(['flaky']);
    });
  });
});

describe('capability helpers', () => {
  it('buildFlagSettings returns the shared constant when the flags are empty', () => {
    expect(
      buildFlagSettings(undefined, undefined, capabilityFlagsFor(policy(), [])),
    ).toBe(PTAH_DISABLE_SDK_AUTO_MEMORY);
  });

  it('capabilityFlagsFor never lists ptah as denied while it is ON', () => {
    const flags = capabilityFlagsFor(
      policy({ deniedMcpServers: ['ptah', 'a', 'a'] }),
      ['a'],
    );
    expect(flags.deniedMcpServers).toEqual(['a']);
  });

  it('resolveSessionCapabilityPolicy fails closed with no resolver', async () => {
    const warn = jest.fn();
    const set = await resolveSessionCapabilityPolicy(null, PROJECT, { warn });
    expect(set).toMatchObject({ status: 'unverified', ptahEnabled: true });
    expect(warn).toHaveBeenCalled();
  });

  it('resolveSessionCapabilityPolicy fails closed when the resolver throws', async () => {
    const warn = jest.fn();
    const set = await resolveSessionCapabilityPolicy(
      { resolve: jest.fn().mockRejectedValue(new Error('EACCES')) } as never,
      PROJECT,
      { warn },
    );
    expect(set.status).toBe('unverified');
    // The UI-facing reason is a fixed phrase; the detail stays in the log.
    expect(set.reasons[0].error).toBe('the capability resolver failed');
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: 'EACCES' }),
    );
  });
});
