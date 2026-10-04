import 'reflect-metadata';

import type { AISessionConfig, AuthEnv } from '@ptah-extension/shared';
import { SdkQueryOptionsBuilder } from './sdk-query-options-builder';

const SENTINELS = ['zz_sentinel_610.ts', '0.610610', '610610', 'A5_SENTINEL_TEST_LABEL'] as const;

function makeBuilder(): SdkQueryOptionsBuilder {
  const hooks = { createHooks: jest.fn().mockReturnValue({}) };
  const ctor = SdkQueryOptionsBuilder as unknown as new (...args: unknown[]) => SdkQueryOptionsBuilder;
  return new ctor(
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    { createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })) }, hooks,
    { getConfig: jest.fn().mockReturnValue({ enabled: true, contextTokenThreshold: null }) }, hooks, hooks,
    {} as AuthEnv,
    { resolveModelId: jest.fn((model: string) => model), hasCachedModels: jest.fn(), getSupportedModels: jest.fn() },
    { buildBlock: jest.fn().mockResolvedValue(''), buildSessionStartBlock: jest.fn().mockResolvedValue(''), buildCorpusBlock: jest.fn().mockResolvedValue('') },
    hooks, hooks, hooks, hooks, hooks, hooks, hooks, hooks, hooks, hooks, undefined, undefined, undefined, 'electron',
  );
}

describe('SdkQueryOptionsBuilder host data boundary', () => {
  // The builder has no host-data input by construction: it receives only the user stream and the
  // session config. Host turn data (change sets, usage, test runs) lives in webview stores and is
  // pinned out of the outgoing params by `message-sender.host-data.spec.ts`. This spec pins the
  // backend half: with the ptah-ui hint enabled, the prompt and system prompt carry no host values.
  it('does not add host recap sentinels to the provider prompt or ptah-ui system hint', async () => {
    const userMessage = { type: 'user', message: { role: 'user', content: 'follow up after tests' } };
    const config = await makeBuilder().build({
      userMessageStream: (async function* () { yield userMessage as never; })(),
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
    const systemHint = typeof systemPrompt === 'object' && systemPrompt !== null && 'append' in systemPrompt
      ? systemPrompt.append ?? '' : '';
    for (const sentinel of SENTINELS) {
      expect(providerPrompt).not.toContain(sentinel);
      expect(systemHint).not.toContain(sentinel);
    }
    expect(systemHint).toContain('ptah-ui');
  });
});
