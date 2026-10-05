/**
 * TASK_2026_597 N1 — the subagent prompt-cache TTL on the flag tier.
 *
 * `build()` (the main-session path) is the ONLY caller that sets
 * `subagentPromptCacheTtl`. It reads `agentOrchestration.subagentPromptCacheTtl`
 * from the store `agent:setConfig` writes, resolves it with
 * `resolveSubagentPromptCacheTtl`, and logs one INFO line. Internal queries
 * (`SdkQueryRunner`) and the ptah-cli spawn paths pass no TTL, so their flag
 * tier is unchanged.
 */

import 'reflect-metadata';
import type { AISessionConfig } from '@ptah-extension/shared';
import { resolveSubagentPromptCacheTtl } from '@ptah-extension/shared';
import {
  SdkQueryOptionsBuilder,
  buildFlagSettings,
  buildFlagSettingsArg,
  canSpawnSubagents,
} from './sdk-query-options-builder';
import { PTAH_DISABLE_SDK_AUTO_MEMORY } from '../constants';

const ENV = 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL';
const SETTING_KEY = 'agentOrchestration.subagentPromptCacheTtl';
const TTL_LOG_PREFIX = '[SdkQueryOptionsBuilder] subagentPromptCacheTtl ';

interface Built {
  settings: Record<string, unknown>;
  /** The effective TTL the build result hands to the subagent monitor (D.7). */
  effective: unknown;
  info: jest.Mock;
  getConfiguration: jest.Mock;
}

/** Drive the real `build()`; `setting` is what the workspace store holds. */
async function build(setting?: unknown, withWorkspace = true): Promise<Built> {
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const info = jest.fn();
  const getConfiguration = jest.fn(
    (_section: string, key: string, fallback: unknown) =>
      key === SETTING_KEY && setting !== undefined ? setting : fallback,
  );
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  const builder = new ctor(
    { info, warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
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
    undefined,
    undefined,
    withWorkspace ? { getConfiguration } : undefined,
  );

  const cfg = await builder.build({
    userMessageStream: (async function* () {
      // Intentionally empty — build() attaches the stream, it does not iterate.
    })(),
    abortController: new AbortController(),
    sessionConfig: {
      model: 'claude-sonnet-4-5',
      projectPath: 'D:/tmp/ws',
      tabId: 'tab-fixture',
    } as AISessionConfig,
    authEnvOverride: {},
  });

  return {
    settings: JSON.parse(cfg.options.settings as string) as Record<
      string,
      unknown
    >,
    effective: cfg.subagentPromptCacheTtl,
    info,
    getConfiguration,
  };
}

function ttlLogLines(info: jest.Mock): string[] {
  return info.mock.calls
    .map(([message]) => message as string)
    .filter((message) => message.startsWith(TTL_LOG_PREFIX));
}

describe('SdkQueryOptionsBuilder.build — subagent prompt-cache TTL (N1)', () => {
  const originalEnv = process.env[ENV];
  beforeEach(() => {
    delete process.env[ENV];
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV];
    else process.env[ENV] = originalEnv;
  });

  it('auto + subagent-capable session → 1h, read from the setConfig store key', async () => {
    const built = await build('auto');
    expect(built.settings['subagentPromptCacheTtl']).toBe('1h');
    expect(built.getConfiguration).toHaveBeenCalledWith(
      'ptah',
      SETTING_KEY,
      'auto',
    );
    expect(ttlLogLines(built.info)).toEqual([
      `${TTL_LOG_PREFIX}effective=1h source=auto sdkOption=1h`,
    ]);
  });

  it('5m setting → 5m on the flag tier', async () => {
    const built = await build('5m');
    expect(built.settings['subagentPromptCacheTtl']).toBe('5m');
    expect(ttlLogLines(built.info)).toEqual([
      `${TTL_LOG_PREFIX}effective=5m source=setting sdkOption=5m`,
    ]);
  });

  it('1h setting → 1h with source=setting', async () => {
    const built = await build('1h');
    expect(built.settings['subagentPromptCacheTtl']).toBe('1h');
    expect(ttlLogLines(built.info)).toEqual([
      `${TTL_LOG_PREFIX}effective=1h source=setting sdkOption=1h`,
    ]);
  });

  it('an unknown stored value is treated as auto', async () => {
    const built = await build('2h');
    expect(built.settings['subagentPromptCacheTtl']).toBe('1h');
  });

  it('no workspace provider → the setting reads as auto', async () => {
    const built = await build(undefined, false);
    expect(built.settings['subagentPromptCacheTtl']).toBe('1h');
  });

  it('a valid env value is logged as source=env; the SDK option still follows the setting', async () => {
    process.env[ENV] = '5m';
    const built = await build('1h');
    expect(built.settings['subagentPromptCacheTtl']).toBe('1h');
    expect(ttlLogLines(built.info)).toEqual([
      `${TTL_LOG_PREFIX}effective=5m source=env sdkOption=1h`,
    ]);
  });

  it('an invalid env value is ignored for the effective TTL', async () => {
    process.env[ENV] = '30m';
    const built = await build('auto');
    expect(ttlLogLines(built.info)).toEqual([
      `${TTL_LOG_PREFIX}effective=1h source=auto sdkOption=1h`,
    ]);
  });

  it('the build result carries the effective TTL, not the SDK option (D.7)', async () => {
    expect((await build('auto')).effective).toBe('1h');
    expect((await build('5m')).effective).toBe('5m');
    process.env[ENV] = '5m';
    const envWins = await build('1h');
    expect(envWins.settings['subagentPromptCacheTtl']).toBe('1h');
    expect(envWins.effective).toBe('5m');
  });
});

describe('canSpawnSubagents — the auto gate', () => {
  it('is true for the claude_code preset with nothing disallowed (the build() session)', () => {
    expect(
      canSpawnSubagents({ tools: { type: 'preset', preset: 'claude_code' } }),
    ).toBe(true);
  });

  it.each(['Task', 'Agent'])('is false when %s is disallowed', (tool) => {
    expect(
      canSpawnSubagents({
        tools: { type: 'preset', preset: 'claude_code' },
        disallowedTools: ['Read', tool],
      }),
    ).toBe(false);
  });

  it('follows an explicit tool list', () => {
    expect(canSpawnSubagents({ tools: ['Read', 'Edit'] })).toBe(false);
    expect(canSpawnSubagents({ tools: [] })).toBe(false);
    expect(canSpawnSubagents({ tools: ['Read', 'Agent'] })).toBe(true);
  });
});

describe('buildFlagSettings — TTL key absence rule', () => {
  it('auto + subagent tool disallowed → unset: no key, shared constant returned by identity', () => {
    const ttl = resolveSubagentPromptCacheTtl({
      setting: 'auto',
      envValue: undefined,
      canSpawnSubagents: canSpawnSubagents({
        tools: { type: 'preset', preset: 'claude_code' },
        disallowedTools: ['Task', 'Agent'],
      }),
    });
    expect(ttl).toMatchObject({ sdkValue: undefined, source: 'sdk-default' });
    expect(
      buildFlagSettings(undefined, undefined, undefined, ttl.sdkValue),
    ).toBe(PTAH_DISABLE_SDK_AUTO_MEMORY);
  });

  it('internal-query caller shape (SdkQueryRunner) → no TTL key', () => {
    const settings = buildFlagSettings(undefined, undefined, {
      deniedMcpServers: ['x'],
    });
    expect('subagentPromptCacheTtl' in settings).toBe(false);
  });

  it('ptah-cli caller shape (five arguments) → no TTL key', () => {
    const arg = buildFlagSettingsArg(
      { outputStyleName: 'Explanatory' },
      'accept',
      undefined,
      { autoCompactWindow: 200_000 },
      { deniedMcpServers: [] },
    );
    expect(JSON.parse(arg)).not.toHaveProperty('subagentPromptCacheTtl');
  });

  it('a defined TTL is merged into a fresh object, never into the constant', () => {
    const snapshot = { ...PTAH_DISABLE_SDK_AUTO_MEMORY };
    const settings = buildFlagSettings(undefined, undefined, undefined, '5m');
    expect(settings).not.toBe(PTAH_DISABLE_SDK_AUTO_MEMORY);
    expect(settings).toEqual({ ...snapshot, subagentPromptCacheTtl: '5m' });
    expect(PTAH_DISABLE_SDK_AUTO_MEMORY).toEqual(snapshot);
  });
});
