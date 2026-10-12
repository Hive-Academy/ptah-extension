import 'reflect-metadata';

import type { AISessionConfig, AuthEnv } from '@ptah-extension/shared';
import { SdkQueryOptionsBuilder } from './sdk-query-options-builder';

/**
 * Host values that must never reach the provider prompt or the system hint:
 * the 610 recap set (also every value the R6.7 turn summary shows, since the
 * summary is built from the same turn data), the R5.8 `$agents` name and cost,
 * and the R10.5 `$limits` lane and used value. The names match the webview
 * fixture in `message-sender.host-data.spec.ts`.
 */
const SENTINELS = [
  'zz_sentinel_610.ts',
  '0.610610',
  '610610',
  'A5_SENTINEL_TEST_LABEL',
  'zz_sentinel_623_agent',
  '0.623623',
  'zz_sentinel_623_lane',
  '62.3623%',
] as const;

function makeBuilder(): SdkQueryOptionsBuilder {
  const hooks = { createHooks: jest.fn().mockReturnValue({}) };
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  return new ctor(
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    },
    hooks,
    {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: true, contextTokenThreshold: null }),
    },
    hooks,
    hooks,
    {} as AuthEnv,
    {
      resolveModelId: jest.fn((model: string) => model),
      hasCachedModels: jest.fn(),
      getSupportedModels: jest.fn(),
    },
    {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    },
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    undefined,
    undefined,
    undefined,
    undefined,
    'electron',
  );
}

describe('SdkQueryOptionsBuilder host data boundary', () => {
  // The builder has no host-data input by construction: it receives only the user stream and the
  // session config. Host turn data (change sets, usage, test runs) lives in webview stores and is
  // pinned out of the outgoing params by `message-sender.host-data.spec.ts`. This spec pins the
  // backend half: with the ptah-ui hint enabled, the prompt and system prompt carry no host values.
  it('does not add host recap sentinels to the provider prompt or ptah-ui system hint', async () => {
    const userMessage = {
      type: 'user',
      message: { role: 'user', content: 'follow up after tests' },
    };
    const config = await makeBuilder().build({
      userMessageStream: (async function* () {
        yield userMessage as never;
      })(),
      abortController: new AbortController(),
      sessionConfig: {
        model: 'claude-sonnet-4',
        projectPath: 'D:/repo',
        tabId: 'a5-host-data-tab',
        mcpToolProfile: 'coding',
        ptahUiFence: true,
      } as AISessionConfig,
    });
    const promptMessages: unknown[] = [];
    for await (const message of config.prompt) promptMessages.push(message);
    const providerPrompt = JSON.stringify(promptMessages);
    const systemPrompt = config.options.systemPrompt;
    const systemHint =
      typeof systemPrompt === 'object' &&
      systemPrompt !== null &&
      'append' in systemPrompt
        ? (systemPrompt.append ?? '')
        : '';
    for (const sentinel of SENTINELS) {
      expect(providerPrompt).not.toContain(sentinel);
      expect(systemHint).not.toContain(sentinel);
    }
    expect(systemHint).toContain('ptah-ui');
  });

  it('keeps a prior assistant ptah-ui fence raw in the provider prompt and system hint', async () => {
    const rawFence = [
      '```ptah-ui',
      'stats',
      '  Files | $diff.files',
      '  Cost | $usage.cost',
      'table $diff',
      'list $tests',
      '```',
    ].join('\n');
    const priorAssistantMessage = {
      type: 'user',
      message: { role: 'assistant', content: rawFence },
    };
    const config = await makeBuilder().build({
      userMessageStream: (async function* () {
        yield priorAssistantMessage as never;
      })(),
      abortController: new AbortController(),
      sessionConfig: {
        model: 'claude-sonnet-4',
        projectPath: 'D:/repo',
        tabId: 'a5-host-data-tab',
        mcpToolProfile: 'coding',
        ptahUiFence: true,
      } as AISessionConfig,
    });
    const promptMessages: unknown[] = [];
    for await (const message of config.prompt) promptMessages.push(message);
    const providerPrompt = JSON.stringify(promptMessages);
    const systemPrompt = config.options.systemPrompt;
    const systemHint =
      typeof systemPrompt === 'object' &&
      systemPrompt !== null &&
      'append' in systemPrompt
        ? (systemPrompt.append ?? '')
        : '';

    expect(promptMessages).toContainEqual(priorAssistantMessage);
    expect(providerPrompt).toContain('$diff.files');
    for (const sentinel of SENTINELS) {
      expect(providerPrompt).not.toContain(sentinel);
      expect(systemHint).not.toContain(sentinel);
    }
  });

  it('keeps a prior display fence naming $agents and $limits raw, with no resolved host values', async () => {
    // R5.8 / R10.5 / R6.7: the builder's only inputs are the user stream and the
    // session config, so a display fence that names live sources travels as the
    // model wrote it — references, never the agent names, costs, lane rows or
    // summary values the panel resolved for display.
    const rawDisplayFence = [
      '```ptah-ui display agent-usage',
      'stats',
      '  Agents | $agents.total',
      '  Agent cost | $agents.cost',
      '  Lanes at limit | $limits.atLimit',
      'table $agents',
      'table $limits',
      '```',
    ].join('\n');
    const priorAssistantMessage = {
      type: 'user',
      message: { role: 'assistant', content: rawDisplayFence },
    };
    const config = await makeBuilder().build({
      userMessageStream: (async function* () {
        yield priorAssistantMessage as never;
      })(),
      abortController: new AbortController(),
      sessionConfig: {
        model: 'claude-sonnet-4',
        projectPath: 'D:/repo',
        tabId: 'a5-host-data-tab',
        mcpToolProfile: 'coding',
        ptahUiFence: true,
      } as AISessionConfig,
    });
    const promptMessages: unknown[] = [];
    for await (const message of config.prompt) promptMessages.push(message);
    const providerPrompt = JSON.stringify(promptMessages);
    const systemPrompt = config.options.systemPrompt;
    const systemHint =
      typeof systemPrompt === 'object' &&
      systemPrompt !== null &&
      'append' in systemPrompt
        ? (systemPrompt.append ?? '')
        : '';
    // Functions carry no data and a provider object may be cyclic; every other
    // option value is serialized and searched.
    const seen = new WeakSet<object>();
    const options = JSON.stringify(config.options, (_key, value: unknown) => {
      if (typeof value === 'function') return undefined;
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });

    expect(promptMessages).toContainEqual(priorAssistantMessage);
    expect(providerPrompt).toContain('$agents.cost');
    expect(providerPrompt).toContain('table $limits');
    // The hint names both live sources by reference only.
    expect(systemHint).toContain('$agents');
    expect(systemHint).toContain('$limits');
    for (const sentinel of SENTINELS) {
      expect(providerPrompt).not.toContain(sentinel);
      expect(systemHint).not.toContain(sentinel);
      expect(options).not.toContain(sentinel);
    }
  });
});
