/**
 * session-replay.service — unit specs.
 *
 * Covers `SessionReplayService.replayToStreamEvents`, which converts parsed
 * JSONL messages to the `FlatStreamEventUnion` array consumed by the frontend.
 *
 * Focused invariants (the full replay engine is large; we assert the
 * behaviours most likely to silently break):
 *
 *   - post-compaction slicing: pre-compact_boundary messages are skipped.
 *   - user messages emit message_start → text_delta → message_complete.
 *   - assistant messages with tool_use emit tool_start; if a matching
 *     tool_result exists upstream, a tool_result event follows.
 *   - isMeta user messages are suppressed (no events).
 *   - task-notification user messages are suppressed.
 *
 * Wires `HistoryEventFactory` and `AgentCorrelationService` as real
 * instances (they're dependency-free, pure services), and stubs the
 * `ModelResolver` via a shape that matches the `resolveForPricing` contract
 * used by the replay path.
 */

import 'reflect-metadata';
import { SessionReplayService } from './session-replay.service';
import { HistoryEventFactory } from './history-event-factory';
import { AgentCorrelationService } from './agent-correlation.service';
import type { SessionHistoryMessage } from './history.types';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/**
 * Minimal `ModelResolver` shape consumed by the replay service.
 * The real class lives in `../../auth/model-resolver` and the replay only
 * calls `resolveForPricing`, so we satisfy that surface directly rather than
 * instantiating the full DI graph.
 */
interface ModelResolverLike {
  resolveForPricing(model: string): string;
}

function stubModelResolver(): ModelResolverLike {
  return {
    resolveForPricing: jest.fn((m: string) => m || 'unknown'),
  };
}

function u(content: SessionHistoryMessage['message']): SessionHistoryMessage {
  return {
    type: 'user',
    timestamp: '2026-01-01T00:00:00.000Z',
    uuid: 'u-' + Math.random().toString(36).slice(2, 8),
    message: content,
  } as SessionHistoryMessage;
}
function a(content: SessionHistoryMessage['message']): SessionHistoryMessage {
  return {
    type: 'assistant',
    timestamp: '2026-01-01T00:00:01.000Z',
    uuid: 'a-' + Math.random().toString(36).slice(2, 8),
    message: content,
  } as SessionHistoryMessage;
}

describe('SessionReplayService', () => {
  let service: SessionReplayService;
  let logger: MockLogger;

  beforeEach(() => {
    logger = createMockLogger();
    // HistoryEventFactory and AgentCorrelationService have no heavy deps,
    // so we instantiate them directly for higher-fidelity integration.
    const factory = new HistoryEventFactory();
    const correlation = new AgentCorrelationService(
      asLogger(createMockLogger()),
    );
    service = new SessionReplayService(
      asLogger(logger),
      correlation,
      factory,
      stubModelResolver() as unknown as ConstructorParameters<
        typeof SessionReplayService
      >[3],
    );
  });

  function eventTypes(events: FlatStreamEventUnion[]): string[] {
    return events.map((e) => e.eventType);
  }

  // -------------------------------------------------------------------------
  // Basic user/assistant round-trip
  // -------------------------------------------------------------------------

  it('emits message_start / text_delta / message_complete for a user message', () => {
    const out = service.replayToStreamEvents(
      'session-1',
      [u({ role: 'user', content: 'hello' })],
      [],
    );
    expect(eventTypes(out)).toEqual([
      'message_start',
      'text_delta',
      'message_complete',
    ]);
    // All events tagged as history-sourced for the frontend.
    for (const evt of out) {
      expect((evt as { source: string }).source).toBe('history');
    }
  });

  it('emits tool_start and tool_result for assistant tool_use with matching result', () => {
    const messages: SessionHistoryMessage[] = [
      u({ role: 'user', content: 'do thing' }),
      a({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't-1',
            name: 'Read',
            input: { path: '/tmp/x' },
          },
        ],
      }),
      u({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't-1',
            content: 'file body',
            is_error: false,
          },
        ],
      }),
    ];
    const out = service.replayToStreamEvents('s', messages, []);
    // Expect at least: user message triad, assistant message_start,
    // tool_start, tool_result, and a final message_complete.
    const types = eventTypes(out);
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_result');
    const toolStart = out.find((e) => e.eventType === 'tool_start') as {
      toolName: string;
      toolCallId: string;
    };
    expect(toolStart.toolName).toBe('Read');
    expect(toolStart.toolCallId).toBe('t-1');
  });

  // -------------------------------------------------------------------------
  // isMeta / task-notification suppression
  // -------------------------------------------------------------------------

  it('suppresses user messages flagged as isMeta', () => {
    const messages: SessionHistoryMessage[] = [
      {
        type: 'user',
        isMeta: true,
        timestamp: '2026-01-01T00:00:00.000Z',
        uuid: 'u-meta',
        message: { role: 'user', content: 'meta payload' },
      } as SessionHistoryMessage,
      u({ role: 'user', content: 'real user message' }),
    ];
    const out = service.replayToStreamEvents('s', messages, []);
    // Only the real message should produce a triad (3 events total).
    expect(eventTypes(out)).toEqual([
      'message_start',
      'text_delta',
      'message_complete',
    ]);
  });

  it('suppresses user messages starting with <task-notification>', () => {
    const messages: SessionHistoryMessage[] = [
      u({
        role: 'user',
        content: '<task-notification>subagent done</task-notification>',
      }),
      u({ role: 'user', content: 'real message' }),
    ];
    const out = service.replayToStreamEvents('s', messages, []);
    // task-notification dropped; only 'real message' triad survives.
    expect(eventTypes(out)).toEqual([
      'message_start',
      'text_delta',
      'message_complete',
    ]);
  });

  // -------------------------------------------------------------------------
  // compact_boundary
  // -------------------------------------------------------------------------

  it('skips all messages before a compact_boundary', () => {
    const messages: SessionHistoryMessage[] = [
      u({ role: 'user', content: 'OLD — should not appear' }),
      a({
        role: 'assistant',
        content: [{ type: 'text', text: 'OLD REPLY — should not appear' }],
      }),
      {
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: '2026-01-01T00:30:00.000Z',
        uuid: 'boundary',
      } as SessionHistoryMessage,
      u({ role: 'user', content: 'NEW — keep' }),
    ];
    const out = service.replayToStreamEvents('s', messages, []);
    const deltas = out.filter((e) => e.eventType === 'text_delta') as Array<{
      delta: string;
    }>;
    // Only the post-boundary user content shows up.
    expect(deltas.every((d) => !d.delta.includes('OLD'))).toBe(true);
    expect(deltas.some((d) => d.delta === 'NEW — keep')).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Found compact_boundary'),
    );
  });

  // -------------------------------------------------------------------------
  // Unknown message types (format drift)
  // -------------------------------------------------------------------------

  it('ignores messages whose type is neither user nor assistant', () => {
    const messages = [
      {
        type: 'future_event_from_the_gods',
        timestamp: '2026-01-01T00:00:00.000Z',
        uuid: 'future-1',
        message: { role: 'unknown' },
      },
      u({ role: 'user', content: 'real' }),
    ] as unknown as SessionHistoryMessage[];
    const out = service.replayToStreamEvents('s', messages, []);
    expect(eventTypes(out)).toEqual([
      'message_start',
      'text_delta',
      'message_complete',
    ]);
  });
});
