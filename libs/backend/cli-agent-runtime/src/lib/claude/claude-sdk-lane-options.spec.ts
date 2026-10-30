/**
 * TASK_2026_853 A-3 — Claude built-ins on a Claude lane.
 *
 * The assembly carries the built-in policy; `buildClaudeSdkLaneOptions` turns
 * it into `disallowedTools` on every route, and the skill denials ride the
 * flag tier on the verified path only. The assemblies here are built with the
 * real agent-sdk rules, not hand-written lists.
 */

import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ClaudeAccountNamedRoute,
  ClaudeCertifiedLaunchContext,
} from '@ptah-extension/auth-providers-tokens';
import type { AuthEnv, EffectiveCapabilitySet } from '@ptah-extension/shared';
import {
  assertCertifiedLaunch,
  capabilityFlagsFor,
  capabilityIsolationOptions,
  certifiedEnvDigest,
  resolveClaudeBuiltinPolicy,
  unverifiedCapabilityPolicy,
  withClaudeBuiltinSkillDenials,
  type SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import type { PtahSpawnAssembly } from '../ptah-cli/helpers/ptah-cli-spawn-options.service';
import {
  buildClaudeSdkLaneOptions,
  claudeActualLaunch,
  type ClaudeSdkLaneOptionsInput,
} from './claude-sdk-lane-options';

const CWD = 'D:/workspace';
const DEFAULT_TOOLS = [
  'DesignSync',
  'EnterWorktree',
  'ExitWorktree',
  'PushNotification',
  'ReportFindings',
  'Workflow',
];

function verifiedPolicy(): EffectiveCapabilitySet {
  return {
    physicalRoot: CWD,
    policyKey: CWD,
    status: 'verified',
    reasons: [],
    ptahEnabled: true,
    deniedMcpServers: [],
    approvedProjectMcpServers: [],
    deniedSkillNames: ['orchestration'],
    disabledPluginIds: [],
    harnessFingerprint: 'fp',
  };
}

/** The assembly `PtahCliSpawnOptions` produces for `policy` and the opt-ins. */
function assemblyFor(
  policy: EffectiveCapabilitySet,
  enabledTools: string[] = [],
  enabledSkills: string[] = [],
): PtahSpawnAssembly {
  const builtinPolicy = resolveClaudeBuiltinPolicy({
    enabledTools,
    enabledSkills,
  });
  return {
    systemPromptMode: 'preset-append',
    systemPromptContent: 'Role: reviewer',
    mcpServers: {},
    hooks: {},
    autoCompact: {},
    outputStyleName: undefined,
    capabilityFlags: withClaudeBuiltinSkillDenials(
      capabilityFlagsFor(policy, []),
      policy,
      builtinPolicy,
    ),
    capabilityIsolation: capabilityIsolationOptions(policy),
    builtinPolicy,
  };
}

function laneInput(
  assembly: PtahSpawnAssembly,
  authEnv: AuthEnv = {},
): ClaudeSdkLaneOptionsInput {
  const callback: ReturnType<SdkPermissionHandler['createCallback']> =
    async () => ({ behavior: 'deny', message: 'fixture' });
  return {
    assembly,
    authEnv,
    abortController: new AbortController(),
    model: 'sonnet',
    cwd: CWD,
    agentName: 'Reviewer',
    agentId: 'abcdef-run',
    routingId: 'ptah-cli:fixture',
    permissionHandler: {
      getPermissionLevel: jest.fn(() => 'ask' as const),
      createCallback: jest.fn(() => callback),
    },
    logger: createMockLogger() as unknown as Logger,
    processSpawner: { spawn: jest.fn() },
    executable: 'D:/cli/cli.js',
  };
}

function skillOverrides(settings: unknown): Record<string, string> | undefined {
  const parsed = JSON.parse(String(settings)) as {
    skillOverrides?: Record<string, string>;
  };
  return parsed.skillOverrides;
}

function certifiedLaunch(): ClaudeCertifiedLaunchContext {
  const dir = 'D:/accounts/selected';
  const env = {
    PATH: 'D:/bin',
    CLAUDE_CONFIG_DIR: dir,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: dir,
  };
  return {
    executable: {
      command: 'D:/cli/claude.exe',
      prefixArgs: [],
      sdkExecutablePath: 'D:/cli/cli.js',
      version: '2.1.310',
      fingerprint: { size: 1, mtimeMs: 1 },
    },
    env,
    envDigest: certifiedEnvDigest(env),
    cwd: CWD,
    settingSources: ['user', 'project', 'local'],
    policy: {
      coverage: 'win32@2.1.310',
      managedFile: 'absent',
      managedDropIn: 'absent',
      registry: 'absent',
      remoteSignals: 'absent',
    },
    accountClass: 'personal',
    identityReference: 'b'.repeat(64),
  };
}

describe('buildClaudeSdkLaneOptions — Claude built-in policy (TASK_2026_853)', () => {
  it('ambient lane: denies the default tools and hides the terminal skills', () => {
    const options = buildClaudeSdkLaneOptions(
      laneInput(assemblyFor(verifiedPolicy())),
    );
    expect(options.disallowedTools).toEqual(DEFAULT_TOOLS);
    const overrides = skillOverrides(options.settings);
    expect(overrides?.['code-review']).toBe('off');
    expect(overrides?.['keybindings-help']).toBe('off');
    expect(overrides?.['orchestration']).toBe('off');
    expect(options.tools).toEqual({ type: 'preset', preset: 'claude_code' });
  });

  it('carries the user opt-ins: an enabled tool and skill pair loads', () => {
    const options = buildClaudeSdkLaneOptions(
      laneInput(
        assemblyFor(verifiedPolicy(), ['ReportFindings'], ['code-review']),
      ),
    );
    expect(options.disallowedTools).not.toContain('ReportFindings');
    expect(skillOverrides(options.settings)?.['code-review']).toBeUndefined();
  });

  it('proxied lane: the same tool and skill denials', () => {
    const options = buildClaudeSdkLaneOptions(
      laneInput(assemblyFor(verifiedPolicy()), {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080',
        ANTHROPIC_AUTH_TOKEN: 'proxy-token',
      }),
    );
    expect(options.disallowedTools).toEqual(DEFAULT_TOOLS);
    expect(skillOverrides(options.settings)?.['init']).toBe('off');
  });

  it('unverified policy: tools denied, skills isolated, no skill override added', () => {
    const options = buildClaudeSdkLaneOptions(
      laneInput(assemblyFor(unverifiedCapabilityPolicy(CWD, 'fixture'))),
    );
    expect(options.disallowedTools).toEqual(DEFAULT_TOOLS);
    expect(options.skills).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(skillOverrides(options.settings)).toBeUndefined();
  });

  it('named lane: certified launch passes with the policy and no credential reaches the settings', () => {
    const launch = certifiedLaunch();
    const input = laneInput(assemblyFor(verifiedPolicy()));
    input.accountRoute = {
      kind: 'named',
      provider: 'claude',
      profileId: 'profile',
      canonicalConfigDir: 'D:/accounts/selected',
      routeFingerprint: 'fingerprint',
      routeRevision: 0,
      authEpoch: 0,
      runId: 'run',
    } as ClaudeAccountNamedRoute;
    input.launch = launch;
    const options = buildClaudeSdkLaneOptions(input);
    expect(options.disallowedTools).toEqual(DEFAULT_TOOLS);
    expect(options.env).toEqual(launch.env);
    expect(String(options.settings)).not.toContain('accounts/selected');
    expect(() =>
      assertCertifiedLaunch(launch, claudeActualLaunch(options), 'final'),
    ).not.toThrow();
  });
});
