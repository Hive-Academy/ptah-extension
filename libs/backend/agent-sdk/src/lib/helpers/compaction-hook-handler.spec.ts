/**
 * CompactionHookHandler specs — PreCompact callback enrichment.
 *
 * Coverage:
 *   - The PreCompact hook callback enriches the start payload with
 *     `preTokens` (sampled from SdkMessageTransformer.getCumulativeTokens)
 *     and `trigger` (validated 'manual' | 'auto') from the hook input.
 *
 * Mocking posture:
 *   - Direct `new CompactionHookHandler(...)` with hand-rolled mocks for
 *     Logger and SdkMessageTransformer.
 *   - We invoke the produced PreCompact hook callback directly (the SDK
 *     would do this in production; we simulate the call edge).
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { LiveUsageTracker } from './live-usage-tracker';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';

import { CompactionHookHandler } from './compaction-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeUsageTracker(
  cumulative: number,
): jest.Mocked<Pick<LiveUsageTracker, 'getCumulativeTokens'>> {
  return {
    getCumulativeTokens: jest.fn().mockReturnValue(cumulative),
  };
}

describe('CompactionHookHandler — PreCompact callback (TASK_2026_109 A2)', () => {
  it('emits preTokens from getCumulativeTokens(sessionId) and trigger from hook input', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(54321);
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
    );

    const received: Array<{
      sessionId: string;
      trigger: 'manual' | 'auto';
      timestamp: number;
      preTokens: number;
    }> = [];

    const hooks = handler.createHooks('sess-42', (data) => {
      received.push(data);
    });

    // The handler returns { PreCompact: [{ hooks: [callback] }] }
    const matchers = hooks.PreCompact;
    expect(matchers).toBeDefined();
    const fn = matchers?.[0]?.hooks?.[0];
    expect(typeof fn).toBe('function');

    const hookInput: HookInput = {
      hook_event_name: 'PreCompact',
      trigger: 'auto',
    } as unknown as HookInput;

    const result = await fn?.(hookInput, undefined, {
      signal: new AbortController().signal,
    });

    // Hook never throws; always returns continue:true.
    expect(result).toEqual({ continue: true });
    // Sampled from the transformer at firing time.
    expect(usageTracker.getCumulativeTokens).toHaveBeenCalledWith('sess-42');
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        sessionId: 'sess-42',
        trigger: 'auto',
        preTokens: 54321,
      }),
    );
    expect(typeof received[0].timestamp).toBe('number');
  });
});
