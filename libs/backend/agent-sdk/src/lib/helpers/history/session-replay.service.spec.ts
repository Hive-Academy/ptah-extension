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
 *   - matched task-notification records settle background agents without a user bubble.
 *
 * Wires `HistoryEventFactory` and `AgentCorrelationService` as real
 * instances (they're dependency-free, pure services), and stubs the
 * `ModelResolver` via a shape that matches the `resolveForCost` contract
 * used by the replay path.
 */

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SessionReplayService,
  type HistoryReplayCollector,
} from './session-replay.service';
import { HistoryEventFactory } from './history-event-factory';
import { AgentCorrelationService } from './agent-correlation.service';
import type { AgentSessionData, SessionHistoryMessage } from './history.types';
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
 * calls `resolveForCost`, so we satisfy that surface directly rather than
 * instantiating the full DI graph.
 */
interface ModelResolverLike {
  resolveForCost(model: string): {
    modelId: string;
    pricing: null;
    subscriptionCovered: false;
  };
}

function stubModelResolver(): ModelResolverLike {
  return {
    resolveForCost: jest.fn((m: string) => ({
      modelId: m || 'unknown',
      pricing: null,
      subscriptionCovered: false,
    })),
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

function jsonlFixture(...parts: string[]): SessionHistoryMessage[] {
  return readFileSync(join(__dirname, '__fixtures__', ...parts), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as SessionHistoryMessage);
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

  function collector(): HistoryReplayCollector {
    return { blockOwners: new Map(), syntheticToolResults: new Set() };
  }

  it('replays missing SDK ids and timestamps identically across reads', () => {
    const messages: SessionHistoryMessage[] = [
      {
        ...a({
          role: 'assistant',
          content: [
            { type: 'text', text: 'answer' },
            { type: 'tool_use', name: 'Read', input: {} },
          ],
        }),
        timestamp: 'not-a-timestamp',
        uuid: 'fixed-line',
      },
    ];
    const first = service.replayAgentToStreamEvents('s', 'task', messages);
    const second = service.replayAgentToStreamEvents('s', 'task', messages);
    expect(second).toEqual(first);
    expect(first[0].messageId).toBe('agent_msg_task_0_fixed-line');
  });

  it('keeps one message envelope across skipped lines with the same SDK id', () => {
    const messages: SessionHistoryMessage[] = [
      a({
        role: 'assistant',
        id: 'api-one',
        content: [{ type: 'text', text: 'first' }],
      }),
      u({ role: 'user', content: 'interleaved result' }),
      a({
        role: 'assistant',
        id: 'api-one',
        content: [{ type: 'text', text: 'second' }],
      }),
    ];
    const events = service.replayAgentToStreamEvents('s', 'task', messages);
    expect(eventTypes(events)).toEqual([
      'message_start',
      'text_delta',
      'text_delta',
      'message_complete',
    ]);
    expect(
      events
        .filter((event) => event.eventType === 'text_delta')
        .map((event) => event.blockIndex),
    ).toEqual([0, 1]);
  });

  it('records main blocks without changing the uncollected event output', () => {
    const message = {
      ...a({
        role: 'assistant',
        id: 'api-main',
        content: [
          { type: 'thinking', thinking: 't' },
          { type: 'text', text: 'a' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
        ],
      }),
      uuid: 'fixed-uuid',
    };
    const metadata = collector();
    const withCollector = service.replayToStreamEvents(
      's',
      [message],
      [],
      metadata,
    );
    expect(service.replayToStreamEvents('s', [message], [])).toEqual(
      withCollector,
    );
    expect([...metadata.blockOwners.values()]).toEqual([
      'api-main',
      'api-main',
      'api-main',
    ]);
    expect(metadata.syntheticToolResults.size).toBe(0);
  });

  it('records correlated subagent thinking and text and marks only synthetic results', () => {
    const task = a({
      role: 'assistant',
      id: 'api-main',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_task',
          name: 'Task',
          input: { subagent_type: 'general-purpose' },
        },
      ],
    });
    const agent = {
      agentId: 'agent-one',
      filePath: '/tmp/agent-one.jsonl',
      messages: [
        a({
          role: 'assistant',
          id: 'api-thinking',
          content: [{ type: 'thinking', thinking: 'hidden' }],
        }),
        a({
          role: 'assistant',
          id: 'api-agent',
          content: [{ type: 'text', text: 'agent output' }],
        }),
      ],
    };
    const metadata = collector();
    const events = service.replayToStreamEvents('s', [task], [agent], metadata);
    expect([...metadata.blockOwners.values()]).toEqual([
      'api-main',
      'api-thinking',
      'api-agent',
    ]);
    expect([...metadata.syntheticToolResults]).toEqual([
      events.find((event) => event.eventType === 'tool_result'),
    ]);

    const persisted = collector();
    service.replayToStreamEvents(
      's',
      [
        task,
        u({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_task',
              content: 'real',
            },
          ],
        }),
      ],
      [agent],
      persisted,
    );
    expect(persisted.syntheticToolResults.size).toBe(0);
  });

  it('replays agent JSONL lines with real message ids, running block indices and timestamps', () => {
    const timestamp = '2026-01-02T03:04:05.000Z';
    const messages: SessionHistoryMessage[] = [
      {
        type: 'assistant',
        timestamp,
        message: {
          role: 'assistant',
          id: 'msg-real',
          content: [
            { type: 'thinking', thinking: 'reason' },
            { type: 'text', text: 'answer' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'result' },
          ],
        },
      },
    ];
    const events = service.replayAgentToStreamEvents(
      'session',
      'task',
      messages,
    );
    expect(eventTypes(events)).toEqual([
      'message_start',
      'thinking_delta',
      'text_delta',
      'tool_start',
      'tool_result',
      'message_complete',
    ]);
    expect(events.every((event) => event.messageId === 'msg-real')).toBe(true);
    expect(events.map((event) => event.timestamp)).toEqual(
      Array(events.length).fill(Date.parse(timestamp)),
    );
    expect(
      events
        .filter(
          (event) =>
            event.eventType === 'thinking_delta' ||
            event.eventType === 'text_delta',
        )
        .map((event) => event.blockIndex),
    ).toEqual([0, 1]);
  });

  it('groups adjacent lines with one API message id and skips empty thinking', () => {
    const timestamp = '2026-01-02T03:04:05.000Z';
    const messages: SessionHistoryMessage[] = [
      {
        type: 'assistant',
        timestamp,
        message: {
          role: 'assistant',
          id: 'msg-one',
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: 'first' },
          ],
        },
      },
      {
        type: 'assistant',
        timestamp,
        message: {
          role: 'assistant',
          id: 'msg-one',
          content: [{ type: 'thinking', thinking: 'second' }],
        },
      },
    ];
    const events = service.replayAgentToStreamEvents(
      'session',
      'task',
      messages,
    );
    expect(eventTypes(events)).toEqual([
      'message_start',
      'text_delta',
      'thinking_delta',
      'message_complete',
    ]);
    expect(
      events
        .filter(
          (event) =>
            event.eventType === 'text_delta' ||
            event.eventType === 'thinking_delta',
        )
        .map((event) => event.blockIndex),
    ).toEqual([0, 1]);
  });

  it('does not collect orphan agent records before a compact boundary', () => {
    const task = a({
      role: 'assistant',
      id: 'api-before',
      content: [{ type: 'tool_use', id: 'toolu_old', name: 'Task', input: {} }],
    });
    const agent = {
      agentId: 'agent-orphan',
      filePath: '/tmp/agent-orphan.jsonl',
      messages: [
        a({
          role: 'assistant',
          id: 'api-orphan',
          content: [{ type: 'text', text: 'old' }],
        }),
      ],
    };
    const metadata = collector();
    service.replayToStreamEvents(
      's',
      [
        task,
        { type: 'system', subtype: 'compact_boundary' },
        a({
          role: 'assistant',
          id: 'api-after',
          content: [{ type: 'text', text: 'new' }],
        }),
      ],
      [agent],
      metadata,
    );
    expect([...metadata.blockOwners.values()]).toEqual(['api-after']);
  });

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

  describe('peer turns recognised by their lane envelope', () => {
    function peerOf(events: FlatStreamEventUnion[]): unknown {
      const start = events.find((e) => e.eventType === 'message_start');
      return start && 'inboundPeer' in start ? start.inboundPeer : undefined;
    }

    it('labels an <agent-report> user record with its lane', () => {
      const text =
        '<agent-report agent-id="lane-1" agent="Glm" cli="ptah-cli">\nAll green.\n</agent-report>';
      const out = service.replayToStreamEvents(
        'session-1',
        [u({ role: 'user', content: text })],
        [],
      );
      expect(peerOf(out)).toEqual({ label: 'ptah-cli · Glm' });
      // The text stays the raw envelope; the webview renders the header.
      const delta = out.find((e) => e.eventType === 'text_delta');
      expect(delta && 'delta' in delta ? delta.delta : undefined).toBe(text);
    });

    it('labels an <agent-lane-completed> user record with its lane', () => {
      const out = service.replayToStreamEvents(
        'session-1',
        [
          u({
            role: 'user',
            content:
              '<agent-lane-completed agent-id="lane-2" agent="Glm" cli="ptah-cli" status="completed">\nDone.\n</agent-lane-completed>',
          }),
        ],
        [],
      );
      expect(peerOf(out)).toEqual({ label: 'ptah-cli · Glm' });
    });

    it('labels a child session envelope as session · <agent>', () => {
      const out = service.replayToStreamEvents(
        'session-1',
        [
          u({
            role: 'user',
            content:
              '<agent-report agent-id="sess-9" agent="Reviewer" cli="ptah-session">\nLooks fine.\n</agent-report>',
          }),
        ],
        [],
      );
      expect(peerOf(out)).toEqual({ label: 'session · Reviewer' });
    });

    it('labels an SDK subagent message with its short sender id', () => {
      const text = [
        'Another Claude session sent a message:',
        '<agent-message from="ad589f82c811f90e5">',
        'Source follow-up finding.',
        '</agent-message>',
        '',
        'That "other Claude session" is an agent working inside this same session.',
      ].join('\n');
      const out = service.replayToStreamEvents(
        'session-1',
        [u({ role: 'user', content: text })],
        [],
      );
      expect(peerOf(out)).toEqual({ label: 'ad589f82' });
    });

    it('does not label plain user text', () => {
      const out = service.replayToStreamEvents(
        'session-1',
        [u({ role: 'user', content: 'please run the tests' })],
        [],
      );
      expect(peerOf(out)).toBeUndefined();
    });

    it('does not label a sidechain user record carrying an envelope', () => {
      const record: SessionHistoryMessage = {
        ...u({
          role: 'user',
          content:
            '<agent-report agent-id="lane-1" agent="Glm" cli="ptah-cli">\nx\n</agent-report>',
        }),
        isSidechain: true,
      };
      const out = service.replayToStreamEvents('session-1', [record], []);
      expect(peerOf(out)).toBeUndefined();
    });

    it.each([
      ['origin', { origin: { kind: 'human' } }],
      ['turnOrigin', { turnOrigin: 'human' }],
    ])(
      'does not label an envelope the human typed (marked by %s)',
      (_marker, mark) => {
        const record: SessionHistoryMessage = {
          ...u({
            role: 'user',
            content:
              '<agent-report agent-id="lane-1" agent="Reviewer" cli="codex">\nPlease explain this example.\n</agent-report>',
          }),
          ...mark,
        };
        const out = service.replayToStreamEvents('session-1', [record], []);
        expect(peerOf(out)).toBeUndefined();
      },
    );

    it('labels an injected record the CLI marks as an sdk turn', () => {
      const record: SessionHistoryMessage = {
        ...u({
          role: 'user',
          content:
            '<agent-report agent-id="lane-1" agent="Glm" cli="ptah-cli">\nx\n</agent-report>',
        }),
        turnOrigin: 'sdk',
      };
      const out = service.replayToStreamEvents('session-1', [record], []);
      expect(peerOf(out)).toEqual({ label: 'ptah-cli · Glm' });
    });
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

  it('preserves an unknown model cost as null on replay', () => {
    const message = {
      type: 'assistant',
      timestamp: '2026-01-01T00:00:01.000Z',
      uuid: 'a-unpriced',
      message: {
        role: 'assistant',
        model: 'unpriced-model',
        content: [{ type: 'text', text: 'answer' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    } as SessionHistoryMessage;

    const complete = service
      .replayToStreamEvents('s', [message], [])
      .find((event) => event.eventType === 'message_complete');

    expect(complete).toEqual(
      expect.objectContaining({
        tokenUsage: { input: 10, output: 5 },
        cost: null,
      }),
    );
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

  it('suppresses user messages flagged as isSynthetic', () => {
    // Regression (PR #493 review A): JsonlReaderService used to drop the
    // isSynthetic flag during conversion, so these records reached replay.
    const messages: SessionHistoryMessage[] = [
      {
        type: 'user',
        isSynthetic: true,
        timestamp: '2026-01-01T00:00:00.000Z',
        uuid: 'u-synthetic',
        message: { role: 'user', content: 'synthetic cue' },
      } as SessionHistoryMessage,
      u({ role: 'user', content: 'real user message' }),
    ];
    const out = service.replayToStreamEvents('s', messages, []);
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

  describe('background task notifications from parent JSONL', () => {
    const fixtureDir = ['with-background-subagent'];

    function fixtureReplay(): FlatStreamEventUnion[] {
      const agents: AgentSessionData[] = ['bgone', 'bgtwo'].map((id) => ({
        agentId: `agent-${id}`,
        filePath: `agent-${id}.jsonl`,
        messages: jsonlFixture(...fixtureDir, `agent-${id}.jsonl`),
      }));
      return service.replayToStreamEvents(
        'history-bg',
        jsonlFixture(...fixtureDir, 'parent.jsonl'),
        agents,
      );
    }

    it('settles both background tasks after their agent events without rendering notifications as user messages', () => {
      const events = fixtureReplay();
      const completed = events.filter((event) => event.eventType === 'agent_completed');
      expect(completed).toEqual([
        expect.objectContaining({
          eventType: 'agent_completed',
          parentToolUseId: 'toolu_bg_1',
          taskId: 'bgone',
          status: 'completed',
          summary: 'Agent "First check" finished',
          source: 'history',
        }),
        expect.objectContaining({
          eventType: 'agent_completed',
          parentToolUseId: 'toolu_bg_2',
          taskId: 'bgtwo',
          status: 'completed',
          source: 'history',
        }),
      ]);
      for (const event of completed) {
        const startIndex = events.findIndex(
          (candidate) =>
            candidate.eventType === 'agent_start' &&
            candidate.parentToolUseId === event.parentToolUseId,
        );
        const childIndex = events.findIndex(
          (candidate) =>
            candidate.eventType === 'text_delta' &&
            candidate.parentToolUseId === event.parentToolUseId,
        );
        expect(startIndex).toBeGreaterThanOrEqual(0);
        expect(childIndex).toBeGreaterThan(startIndex);
        expect(events.indexOf(event)).toBeGreaterThan(childIndex);
      }
      expect(events.some((event) =>
        event.eventType === 'agent_completed' &&
        event.parentToolUseId === 'toolu_fg_1',
      )).toBe(false);
      expect(events.filter((event) =>
        event.eventType === 'message_start' && event.role === 'user',
      )).toHaveLength(1);
      expect(events.some((event) =>
        event.eventType === 'text_delta' && event.delta.includes('<task-notification>'),
      )).toBe(false);
    });

    it('parses a notification with a large summary from a bounded head', () => {
      const parent = jsonlFixture(...fixtureDir, 'parent.jsonl');
      const notification = parent[parent.length - 2];
      const content = notification.message?.content;
      if (typeof content !== 'string') throw new Error('Expected text notification fixture');
      const expanded = { ...notification, message: {
        role: 'user',
        content: content.replace('Agent "First check" finished', 'x'.repeat(40_000)),
      } };
      const events = service.replayToStreamEvents('history-bg', [...parent.slice(0, 3), expanded], []);
      expect(events.find((event) => event.eventType === 'agent_completed')).toMatchObject({
        taskId: 'bgone', summary: 'x'.repeat(240),
      });
    });

    it('emits one completion for duplicate notifications of the same task', () => {
      const parent = jsonlFixture(...fixtureDir, 'parent.jsonl');
      const notification = parent[parent.length - 2];
      const events = service.replayToStreamEvents(
        'history-bg',
        [...parent.slice(0, 3), notification, { ...notification, uuid: 'duplicate-task' }],
        [],
      );
      expect(events.filter((event) => event.eventType === 'agent_completed' && event.taskId === 'bgone')).toHaveLength(1);
    });

    it('drops unmatched and malformed notifications and ignores a human-typed example', () => {
      const parent = jsonlFixture(...fixtureDir, 'parent.jsonl');
      const notification = parent[parent.length - 2];
      const badRecords: SessionHistoryMessage[] = [
        { ...notification, uuid: 'unmatched', message: {
          role: 'user',
          content: '<task-notification><task-id>other</task-id><tool-use-id>toolu_missing</tool-use-id><status>completed</status></task-notification>',
        } },
        { ...notification, uuid: 'malformed', message: {
          role: 'user',
          content: '<task-notification><task-id>bgone</task-id><tool-use-id>toolu_bg_1</tool-use-id><status>running</status></task-notification>',
        } },
        { ...notification, uuid: 'typed', origin: { kind: 'human' }, message: notification.message },
      ];
      const taskOnly = parent.slice(0, 3);
      const events = service.replayToStreamEvents('history-bg', [...taskOnly, ...badRecords], []);
      expect(events.filter((event) => event.eventType === 'agent_completed')).toHaveLength(0);
      expect(events.some((event) =>
        event.eventType === 'text_delta' && event.delta.includes('<task-notification>'),
      )).toBe(false);
    });

    it.each([
      ['failed', 'failed'],
      ['error', 'failed'],
      ['killed', 'stopped'],
      ['stopped', 'stopped'],
    ] as const)('maps notification status %s to %s', (rawStatus, expected) => {
      const parent = jsonlFixture(...fixtureDir, 'parent.jsonl');
      const notification = parent[parent.length - 2];
      const content = notification.message?.content;
      if (typeof content !== 'string') throw new Error('Expected text notification fixture');
      const changed = {
        ...notification,
        message: {
          role: 'user',
          content: content
            .replace('<status>completed</status>', `<status>${rawStatus}</status>`)
            .replace('Agent "First check" finished', 'x'.repeat(300)),
        },
      };
      const events = service.replayToStreamEvents(
        'history-bg',
        [...parent.slice(0, 3), changed],
        [],
      );
      expect(events.find((event) => event.eventType === 'agent_completed')).toMatchObject({
        parentToolUseId: 'toolu_bg_1',
        status: expected,
        summary: 'x'.repeat(240),
      });
    });
  });

  describe('M9 history parity with live lane user turns', () => {
    it('keeps report and completion before the held prompt with their peer ids', () => {
      const fixturePath = join(
        __dirname,
        '..', '..', '__fixtures__', 'lane-order',
        'cli-transcript-user-lines.json',
      );
      const records = JSON.parse(readFileSync(fixturePath, 'utf8')) as Array<{
        type: string;
        uuid: string;
        timestamp: string;
        content: string;
        origin?: { kind?: string };
        turnOrigin?: string;
      }>;
      const messages: SessionHistoryMessage[] = records.map((record) => ({
        type: 'user',
        uuid: record.uuid,
        timestamp: record.timestamp,
        origin: record.origin,
        turnOrigin: record.turnOrigin,
        message: { role: 'user', content: record.content },
      }));
      const events = service.replayToStreamEvents('m9', messages, []);
      const starts = events.filter(
        (event): event is Extract<FlatStreamEventUnion, { eventType: 'message_start' }> =>
          event.eventType === 'message_start' && event.role === 'user',
      );
      expect(starts.map((event) => event.messageId)).toEqual([
        '5f8c5e05-e601-450d-9d13-3fdfb4083465',
        '11d28bff-5729-459c-b8d2-d6f9b40ebeb8',
        '45f1f8cc-81ed-4446-a2d7-d308466e7738',
        'e40d14e1-6713-4ad3-a6f9-f717a808933f',
      ]);
      // The captured fixture abbreviates content, so identify peer turns by
      // their envelope prefix while preserving the CLI's original UUIDs.
      expect(events.filter((event) =>
        event.eventType === 'text_delta' &&
        /^<agent-(report|lane-completed)\b/.test(event.delta),
      ).map((event) => event.messageId)).toEqual([
        '11d28bff-5729-459c-b8d2-d6f9b40ebeb8',
        '45f1f8cc-81ed-4446-a2d7-d308466e7738',
      ]);
    });
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
