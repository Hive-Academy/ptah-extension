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
import type { CompactionCallbackRegistry } from './compaction-callback-registry';
import type {
  SdkAdapterEvents,
  SdkAdapterCompactionCompleteEvent,
} from './sdk-adapter-events.service';

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
      cwd?: string | null;
    }> = [];

    const hooks = handler.createHooks('sess-42', null, (data) => {
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

/**
 * TASK_2026_293 — the closure id is captured when the query options are built,
 * which for a NEW session is before the SDK has told us the canonical id
 * (`SdkQueryOptionsBuilder` passes `sessionId ?? ''` there). The hook payload
 * always carries the real one, so it must win.
 */
describe('CompactionHookHandler — PreCompact sessionId resolution (TASK_2026_293)', () => {
  function makeRegistryStub(): {
    stub: CompactionCallbackRegistry;
    notified: Array<{ sessionId: string; cwd?: string | null }>;
  } {
    const notified: Array<{ sessionId: string; cwd?: string | null }> = [];
    const stub = {
      size: 1,
      notifyAll: jest.fn((data: { sessionId: string; cwd?: string | null }) => {
        notified.push(data);
      }),
    } as unknown as CompactionCallbackRegistry;
    return { stub, notified };
  }

  function preCompactInput(over: Record<string, unknown> = {}): HookInput {
    return {
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      custom_instructions: null,
      ...over,
    } as unknown as HookInput;
  }

  it('prefers input.session_id over an empty closure id', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(999);
    const { stub, notified } = makeRegistryStub();
    const received: Array<{ sessionId: string; cwd?: string | null }> = [];
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      stub,
    );

    const hooks = handler.createHooks('', null, (data) => {
      received.push(data);
    });
    const fn = hooks.PreCompact?.[0]?.hooks?.[0];

    const result = await fn?.(
      preCompactInput({ session_id: 'sdk-real-id', cwd: '/repo' }),
      undefined,
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({ continue: true });
    expect(notified).toHaveLength(1);
    expect(notified[0]).toEqual(
      expect.objectContaining({ sessionId: 'sdk-real-id', cwd: '/repo' }),
    );
    expect(received[0]).toEqual(
      expect.objectContaining({ sessionId: 'sdk-real-id', cwd: '/repo' }),
    );
    // preTokens must be sampled under the REAL id — '' tracks nothing, so a
    // wrong id here silently reports 0 as the pre-compaction total.
    expect(usageTracker.getCumulativeTokens).toHaveBeenCalledWith(
      'sdk-real-id',
    );
    expect(usageTracker.getCumulativeTokens).not.toHaveBeenCalledWith('');
  });

  it('falls back to the closure id when the payload carries none', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(7);
    const { stub, notified } = makeRegistryStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      stub,
    );

    const hooks = handler.createHooks('closure-id', '/fallback-cwd');
    const fn = hooks.PreCompact?.[0]?.hooks?.[0];

    await fn?.(preCompactInput(), undefined, {
      signal: new AbortController().signal,
    });

    expect(notified).toHaveLength(1);
    expect(notified[0]).toEqual(
      expect.objectContaining({
        sessionId: 'closure-id',
        cwd: '/fallback-cwd',
      }),
    );
  });

  it('treats an empty payload session_id as absent, not as a valid id', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(7);
    const { stub, notified } = makeRegistryStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      stub,
    );

    const hooks = handler.createHooks('closure-id', null);
    const fn = hooks.PreCompact?.[0]?.hooks?.[0];

    await fn?.(preCompactInput({ session_id: '', cwd: '' }), undefined, {
      signal: new AbortController().signal,
    });

    expect(notified[0]).toEqual(
      expect.objectContaining({ sessionId: 'closure-id', cwd: null }),
    );
  });

  it('skips the fan-out entirely when neither source has an id', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(7);
    const { stub, notified } = makeRegistryStub();
    const received: unknown[] = [];
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      stub,
    );

    const hooks = handler.createHooks('', null, (data) => {
      received.push(data);
    });
    const fn = hooks.PreCompact?.[0]?.hooks?.[0];

    const result = await fn?.(preCompactInput(), undefined, {
      signal: new AbortController().signal,
    });

    // Never block the SDK, but publish nothing — '' reaches the curator's
    // transcript reader as a path-traversal rejection and curates a placeholder.
    expect(result).toEqual({ continue: true });
    expect(notified).toHaveLength(0);
    expect(received).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing sessionId'),
      expect.objectContaining({ trigger: 'auto', hasCwd: false }),
    );
  });
});

describe('CompactionHookHandler — PostCompact hook (TASK_2026_137 Phase 1)', () => {
  function makeAdapterEventsStub(): {
    stub: SdkAdapterEvents;
    emitted: SdkAdapterCompactionCompleteEvent[];
  } {
    const emitted: SdkAdapterCompactionCompleteEvent[] = [];
    const stub = {
      emitCompactionComplete: jest.fn(
        (event: SdkAdapterCompactionCompleteEvent) => {
          emitted.push(event);
        },
      ),
    } as unknown as SdkAdapterEvents;
    return { stub, emitted };
  }

  it('emits compactionComplete via SdkAdapterEvents bus with manual trigger', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const { stub, emitted } = makeAdapterEventsStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      undefined,
      stub,
    );

    const hooks = handler.createHooks('sess-pc-1', '/repo');
    const fn = hooks.PostCompact?.[0]?.hooks?.[0];
    expect(typeof fn).toBe('function');

    const hookInput: HookInput = {
      hook_event_name: 'PostCompact',
      session_id: 'sess-pc-1',
      cwd: '/repo',
      trigger: 'manual',
      compact_summary: 'first-compaction-summary',
      transcript_path: '/tmp/tx',
    } as unknown as HookInput;

    const result = await fn?.(hookInput, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.objectContaining({
        sessionId: 'sess-pc-1',
        cwd: '/repo',
        trigger: 'manual',
        compactSummary: 'first-compaction-summary',
      }),
    );
    expect(typeof emitted[0].timestamp).toBe('number');
  });

  it('emits compactionComplete via SdkAdapterEvents bus with auto trigger', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const { stub, emitted } = makeAdapterEventsStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      undefined,
      stub,
    );

    const hooks = handler.createHooks('sess-pc-2', '/repo');
    const fn = hooks.PostCompact?.[0]?.hooks?.[0];

    const hookInput: HookInput = {
      hook_event_name: 'PostCompact',
      session_id: 'sess-pc-2',
      cwd: '/repo',
      trigger: 'auto',
      compact_summary: 'auto-summary',
      transcript_path: '/tmp/tx',
    } as unknown as HookInput;

    const result = await fn?.(hookInput, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.objectContaining({
        sessionId: 'sess-pc-2',
        cwd: '/repo',
        trigger: 'auto',
        compactSummary: 'auto-summary',
      }),
    );
  });

  it('registers PostCompact entry in createHooks returned record', () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const { stub } = makeAdapterEventsStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      undefined,
      stub,
    );

    const hooks = handler.createHooks('sess-pc-3', '/repo');
    expect(hooks.PostCompact).toBeDefined();
    expect(Array.isArray(hooks.PostCompact)).toBe(true);
    expect(hooks.PostCompact?.[0]?.hooks?.[0]).toEqual(expect.any(Function));
  });

  it('does not throw when sdkAdapterEvents dependency is absent', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
    );

    const hooks = handler.createHooks('sess-pc-4', '/repo');
    const fn = hooks.PostCompact?.[0]?.hooks?.[0];

    const hookInput: HookInput = {
      hook_event_name: 'PostCompact',
      session_id: 'sess-pc-4',
      cwd: '/repo',
      trigger: 'manual',
      compact_summary: 'summary',
      transcript_path: '/tmp/tx',
    } as unknown as HookInput;

    const result = await fn?.(hookInput, undefined, {
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ continue: true });
  });

  it('skips emit when trigger value is invalid', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const { stub, emitted } = makeAdapterEventsStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      undefined,
      stub,
    );

    const hooks = handler.createHooks('sess-pc-5', '/repo');
    const fn = hooks.PostCompact?.[0]?.hooks?.[0];

    const hookInput: HookInput = {
      hook_event_name: 'PostCompact',
      session_id: 'sess-pc-5',
      cwd: '/repo',
      trigger: 'bogus',
      compact_summary: 's',
      transcript_path: '/tmp/tx',
    } as unknown as HookInput;

    const result = await fn?.(hookInput, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(emitted).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips emit when resolved sessionId is empty (would silently drop at Zod boundary)', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const { stub, emitted } = makeAdapterEventsStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      undefined,
      stub,
    );

    const hooks = handler.createHooks('', '/repo');
    const fn = hooks.PostCompact?.[0]?.hooks?.[0];

    const hookInput: HookInput = {
      hook_event_name: 'PostCompact',
      cwd: '/repo',
      trigger: 'manual',
      compact_summary: 's',
      transcript_path: '/tmp/tx',
    } as unknown as HookInput;

    const result = await fn?.(hookInput, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(emitted).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing sessionId or cwd'),
      expect.objectContaining({ hasSessionId: false, hasCwd: true }),
    );
  });

  it('treats an empty payload session_id as absent rather than letting it beat the closure id (TASK_2026_293)', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const { stub, emitted } = makeAdapterEventsStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      undefined,
      stub,
    );

    const hooks = handler.createHooks('closure-id', '/repo');
    const fn = hooks.PostCompact?.[0]?.hooks?.[0];

    const hookInput: HookInput = {
      hook_event_name: 'PostCompact',
      session_id: '',
      cwd: '',
      trigger: 'manual',
      compact_summary: 's',
      transcript_path: '/tmp/tx',
    } as unknown as HookInput;

    await fn?.(hookInput, undefined, { signal: new AbortController().signal });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.objectContaining({ sessionId: 'closure-id', cwd: '/repo' }),
    );
  });

  it('skips emit when resolved cwd is empty (would silently drop at Zod boundary)', async () => {
    const logger = makeLogger();
    const usageTracker = makeUsageTracker(0);
    const { stub, emitted } = makeAdapterEventsStub();
    const handler = new CompactionHookHandler(
      logger,
      usageTracker as unknown as LiveUsageTracker,
      undefined,
      stub,
    );

    const hooks = handler.createHooks('sess-pc-6', '');
    const fn = hooks.PostCompact?.[0]?.hooks?.[0];

    const hookInput: HookInput = {
      hook_event_name: 'PostCompact',
      session_id: 'sess-pc-6',
      trigger: 'manual',
      compact_summary: 's',
      transcript_path: '/tmp/tx',
    } as unknown as HookInput;

    const result = await fn?.(hookInput, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(emitted).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing sessionId or cwd'),
      expect.objectContaining({ hasSessionId: true, hasCwd: false }),
    );
  });
});
