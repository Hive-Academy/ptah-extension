import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { createGrokSessionUsageReader } from './grok-session-usage.reader';
import { createOpenCodeLocalUsageReader } from './opencode-local-usage.reader';

const logger = createMockLogger() as unknown as Logger;
const target = (providerId: string, cliSessionId?: string) => ({
  providerId,
  ownerRef: {
    key: `${providerId}#unknown:test`,
    providerId,
    identityKind: 'unknown' as const,
    label: 'Test account',
  },
  ...(cliSessionId && { cliSessionId }),
});

describe('local usage readers', () => {
  it('maps OpenCode local token and cost accounting without a plan window', async () => {
    const run = jest.fn(async () => `OpenCode stats\n${JSON.stringify({
      range: { from: 1_700_000_000_000, to: 1_700_000_086_400 },
      sessions: 2,
      subagents: 1,
      prompts: 3,
      steps: 4,
      tokens: { input: 2, output: 3, reasoning: 5, cache: { read: 7, write: 11 } },
      cost: 1.25,
      tools: { bash: 2 },
    })}`);
    const result = await createOpenCodeLocalUsageReader(logger, () => 10, run)(
      { target: target('opencode'), refresh: true, localUsageDays: 0 },
    );
    expect(run).toHaveBeenCalledWith(
      'opencode',
      ['stats', '--json', '--cost', '--days', '0'],
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'available',
      windows: [],
      localUsage: {
        label: 'Local usage: tokens & estimated cost',
        tokens: 28,
        estimatedCostUsd: 1.25,
        range: expect.stringContaining('2023-'),
      },
    });
  });

  it('only invokes Grok with an explicitly supplied Ptah session id', async () => {
    const run = jest.fn(async () => JSON.stringify({ tokens: 12, cost: 0.5 }));
    const reader = createGrokSessionUsageReader(logger, () => 10, run);
    const unavailable = await reader({ target: target('grok'), refresh: true });
    expect(unavailable.status).toBe('service-unavailable');
    expect(run).not.toHaveBeenCalled();

    const result = await reader({
      target: target('grok', 'ptah-created-session'),
      refresh: true,
    });
    expect(run).toHaveBeenCalledWith(
      'grok',
      ['usage', 'ptah-created-session'],
      expect.any(AbortSignal),
    );
    expect(result.localUsage).toMatchObject({
      label: 'Session usage: tokens & cost',
      tokens: 12,
      estimatedCostUsd: 0.5,
    });
  });
});
