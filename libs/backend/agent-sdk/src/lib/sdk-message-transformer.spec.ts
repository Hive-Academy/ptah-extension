/**
 * SdkMessageTransformer specs — compact_boundary handling.
 *
 * Coverage:
 *   - A1: compact_boundary resolves sessionId via SessionLifecycleManager when
 *         the SDK omits session_id and the caller does not provide one.
 *   - A4: compact_boundary calls SubagentRegistry.pruneSession(resolvedId)
 *         and clears the live token snapshot for that session.
 *   - A1 guard: with no resolvable sessionId, no compaction_complete event
 *         is emitted and a warning is logged.
 *
 * Mocking posture:
 *   - The transformer is constructed directly via `new SdkMessageTransformer(...)`
 *     with hand-rolled typed mocks for all five constructor dependencies.
 *   - We avoid the tsyringe container entirely; tests assert purely on the
 *     return value of `transform()` and the side-effect mocks.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import type { ModelResolver } from './auth/model-resolver';
import type { SessionLifecycleManager } from './helpers/session-lifecycle-manager';

import { SdkMessageTransformer } from './sdk-message-transformer';
import { LiveUsageTracker } from './helpers/live-usage-tracker';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeSubagentRegistry(): jest.Mocked<
  Pick<
    SubagentRegistryService,
    'pruneSession' | 'markPendingBackground' | 'setTaskId'
  >
> {
  return {
    pruneSession: jest.fn(),
    markPendingBackground: jest.fn(),
    setTaskId: jest.fn(),
  };
}

function makeSessionLifecycle(
  activeIds: string[],
): jest.Mocked<Pick<SessionLifecycleManager, 'getActiveSessionIds'>> {
  return {
    getActiveSessionIds: jest.fn().mockReturnValue(activeIds),
  };
}

function makeModelResolver(): jest.Mocked<
  Pick<ModelResolver, 'resolveForPricing'>
> {
  return {
    resolveForPricing: jest.fn().mockImplementation((m: string) => m),
  };
}

function makeAuthEnv(): AuthEnv {
  return { provider: 'anthropic' } as unknown as AuthEnv;
}

// Build a synthetic SDKSystemMessage{compact_boundary} without the SDK types.
// The transformer narrows via isCompactBoundary which only checks
// `type === 'system' && subtype === 'compact_boundary'`.
function makeCompactBoundary(opts: {
  sessionId?: string;
  trigger?: 'manual' | 'auto';
  preTokens?: number;
}): unknown {
  const msg: Record<string, unknown> = {
    type: 'system',
    subtype: 'compact_boundary',
    compact_metadata: {
      trigger: opts.trigger ?? 'auto',
      pre_tokens: opts.preTokens ?? 12345,
    },
  };
  if (opts.sessionId !== undefined) {
    msg['session_id'] = opts.sessionId;
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SdkMessageTransformer — compact_boundary (TASK_2026_109)', () => {
  let logger: jest.Mocked<Logger>;
  let registry: ReturnType<typeof makeSubagentRegistry>;
  let lifecycle: ReturnType<typeof makeSessionLifecycle>;
  let modelResolver: ReturnType<typeof makeModelResolver>;
  let transformer: SdkMessageTransformer;

  function build(activeIds: string[] = []): SdkMessageTransformer {
    logger = makeLogger();
    registry = makeSubagentRegistry();
    lifecycle = makeSessionLifecycle(activeIds);
    modelResolver = makeModelResolver();
    return new SdkMessageTransformer(
      logger,
      makeAuthEnv(),
      registry as unknown as SubagentRegistryService,
      modelResolver as unknown as ModelResolver,
      lifecycle as unknown as SessionLifecycleManager,
      new LiveUsageTracker(),
    );
  }

  it('A1 — resolves sessionId from active lifecycle ids when SDK omits session_id and no caller id is provided', () => {
    transformer = build(['active-sess-7']);

    const events = transformer.transform(
      makeCompactBoundary({ trigger: 'auto', preTokens: 50000 }) as never,
      // No caller-provided sessionId — must fall back to lifecycle.
      undefined,
    );

    expect(events).toHaveLength(1);
    const evt = events[0] as { eventType: string; sessionId: string };
    expect(evt.eventType).toBe('compaction_complete');
    expect(evt.sessionId).toBe('active-sess-7');
    expect(lifecycle.getActiveSessionIds).toHaveBeenCalledTimes(1);
  });

  it('A4 — calls SubagentRegistry.pruneSession with the resolved id and clears the live token snapshot', () => {
    transformer = build(['active-sess-9']);

    // Seed the live token snapshot via getCumulativeTokens path: we cannot
    // directly call the private recorder, but the contract we care about is
    // post-boundary `getCumulativeTokens(resolvedId) === 0`. Drive a
    // streaming `message_start.usage` to populate the snapshot first.
    const messageStart = {
      type: 'stream_event',
      uuid: 'stream-uuid-1',
      event: {
        type: 'message_start',
        message: {
          id: 'gen-msg-1',
          model: 'claude-opus',
          usage: {
            input_tokens: 1000,
            output_tokens: 0,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 100,
          },
        },
      },
    } as unknown;

    transformer.transform(messageStart as never, 'active-sess-9' as never);
    expect(transformer.getCumulativeTokens('active-sess-9')).toBeGreaterThan(0);

    // Now drive compact_boundary.
    transformer.transform(
      makeCompactBoundary({ trigger: 'auto', preTokens: 100000 }) as never,
      undefined,
    );

    expect(registry.pruneSession).toHaveBeenCalledWith('active-sess-9');
    // Snapshot cleared — post-boundary cumulative reads zero.
    expect(transformer.getCumulativeTokens('active-sess-9')).toBe(0);
  });

  it('A1 guard — does NOT emit compaction_complete and warns when no sessionId can be resolved', () => {
    transformer = build([]); // no active sessions

    const events = transformer.transform(
      makeCompactBoundary({ trigger: 'auto', preTokens: 0 }) as never,
      // No caller-provided id, no SDK session_id, no active lifecycle id.
      undefined,
    );

    expect(events).toEqual([]);
    expect(registry.pruneSession).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'compact_boundary received without resolvable sessionId',
      ),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// Fix 1: task_started calls setTaskId on the registry
// ---------------------------------------------------------------------------

function makeTaskStarted(opts: {
  taskId: string;
  toolUseId: string;
  sessionId?: string;
  skipTranscript?: boolean;
}): unknown {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: opts.taskId,
    tool_use_id: opts.toolUseId,
    session_id: opts.sessionId,
    skip_transcript: opts.skipTranscript ?? false,
    task_type: 'Task',
  };
}

describe('SdkMessageTransformer — task_started (Fix 1 + Fix 2)', () => {
  let logger: jest.Mocked<Logger>;
  let registry: ReturnType<typeof makeSubagentRegistry>;
  let lifecycle: ReturnType<typeof makeSessionLifecycle>;
  let modelResolver: ReturnType<typeof makeModelResolver>;
  let transformer: SdkMessageTransformer;

  function build(activeIds: string[] = []): SdkMessageTransformer {
    logger = makeLogger();
    registry = makeSubagentRegistry();
    lifecycle = makeSessionLifecycle(activeIds);
    modelResolver = makeModelResolver();
    return new SdkMessageTransformer(
      logger,
      makeAuthEnv(),
      registry as unknown as SubagentRegistryService,
      modelResolver as unknown as ModelResolver,
      lifecycle as unknown as SessionLifecycleManager,
      new LiveUsageTracker(),
    );
  }

  it('Fix 1 — calls setTaskId(toolUseId, taskId) when task_started carries a tool_use_id', () => {
    transformer = build();

    transformer.transform(
      makeTaskStarted({
        taskId: 'task-abc',
        toolUseId: 'tool-use-xyz',
        sessionId: 'sess-1',
      }) as never,
      'sess-1' as never,
    );

    expect(registry.setTaskId).toHaveBeenCalledWith('tool-use-xyz', 'task-abc');
  });

  it('Fix 1 — does NOT call setTaskId when task_started has no tool_use_id', () => {
    transformer = build();
    const msg = {
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-no-tool',
      // No tool_use_id
      session_id: 'sess-2',
      skip_transcript: false,
    };

    transformer.transform(msg as never, 'sess-2' as never);

    expect(registry.setTaskId).not.toHaveBeenCalled();
  });

  it('Fix 2 — emits only one agent_start when task_started precedes the legacy assistant path for same tool_use_id', () => {
    transformer = build();

    // SDK path fires first
    transformer.transform(
      makeTaskStarted({
        taskId: 'task-dedup',
        toolUseId: 'tool-dedup-id',
        sessionId: 'sess-3',
      }) as never,
      'sess-3' as never,
    );

    // Legacy assistant path with isTaskTool block for same tool_use_id.
    // We simulate this by calling transformAssistantToFlatEvents indirectly
    // via a synthetic assistant message containing a Task tool_use block.
    const assistantMsg = {
      type: 'stream_event',
      uuid: 'se-1',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-dedup-id',
          name: 'Task',
          input: {
            description: 'Do something',
            prompt: 'Go do it',
          },
        },
      },
    };

    const legacyEvents = transformer.transform(
      assistantMsg as never,
      'sess-3' as never,
    );

    // Any agent_start events from the legacy path for this tool_use_id
    // should be suppressed because the SDK path already emitted one.
    const agentStarts = legacyEvents.filter(
      (e) => (e as { eventType: string }).eventType === 'agent_start',
    );
    expect(agentStarts).toHaveLength(0);
  });
});
