/**
 * agent-correlation.service — unit specs.
 *
 * Covers `AgentCorrelationService`, which links Task tool_uses in the main
 * session JSONL to the agent-*.jsonl files produced by subagents.
 *
 * Core invariants asserted:
 *   - `buildAgentDataMap` drops warmup agents (first user content === "warmup",
 *     case-insensitive) and defaults to `Date.now()` when no message carries
 *     a timestamp.
 *   - `extractTaskToolUses` walks assistant messages and surfaces Task/Agent
 *     tool uses with their block id, resume agentId, and subagent_type.
 *   - `correlateAgentsToTasks`:
 *       • Resume tasks map directly by `resumeAgentId` (first pass, no
 *         usedAgents consumption so initial Task can still timestamp-match).
 *       • Non-resume tasks match to the nearest agent in the
 *         [-1000ms, +60000ms) window; closer wins; each agent used once.
 *   - `extractAllToolResults` collects tool_result blocks keyed by
 *     `tool_use_id` from user messages, preserving `is_error`.
 */

import 'reflect-metadata';
import { AgentCorrelationService } from './agent-correlation.service';
import type { AgentSessionData, SessionHistoryMessage } from './history.types';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function msg(partial: Partial<SessionHistoryMessage>): SessionHistoryMessage {
  return partial as SessionHistoryMessage;
}

function agent(
  id: string,
  firstContent: string | unknown[],
  firstTimestampIso?: string,
): AgentSessionData {
  const messages: SessionHistoryMessage[] = [
    msg({
      uuid: `${id}-m1`,
      sessionId: 'parent',
      timestamp: firstTimestampIso,
      type: 'user',
      message: {
        role: 'user',
        // `content` is `readonly ContentBlock[] | string` — cast via unknown
        // rather than `as any`. The service treats non-string content as
        // "not warmup" which is what we want for most tests.
        content: firstContent as never,
      },
    }),
  ];
  return { agentId: id, filePath: `/tmp/${id}.jsonl`, messages };
}

describe('AgentCorrelationService', () => {
  let service: AgentCorrelationService;
  let logger: MockLogger;

  beforeEach(() => {
    logger = createMockLogger();
    service = new AgentCorrelationService(asLogger(logger));
  });

  // -------------------------------------------------------------------------
  // buildAgentDataMap
  // -------------------------------------------------------------------------

  describe('buildAgentDataMap', () => {
    it('includes agents whose first user content is not the warmup marker', () => {
      const sessions = [
        agent('agent-a', 'actual task', '2026-01-01T00:00:01.000Z'),
      ];
      const map = service.buildAgentDataMap(sessions);
      expect(map.size).toBe(1);
      expect(map.get('agent-a')?.timestamp).toBe(
        new Date('2026-01-01T00:00:01.000Z').getTime(),
      );
    });

    it('filters out agents whose first user content is exactly "warmup" (case-insensitive)', () => {
      const sessions = [
        agent('agent-warm', 'Warmup', '2026-01-01T00:00:00.000Z'),
        agent('agent-real', 'real work', '2026-01-01T00:00:01.000Z'),
      ];
      const map = service.buildAgentDataMap(sessions);
      expect([...map.keys()]).toEqual(['agent-real']);
    });

    it('defaults timestamp to Date.now() when no messages carry a timestamp', () => {
      const before = Date.now();
      const sessions = [agent('agent-no-ts', 'hi')];
      const map = service.buildAgentDataMap(sessions);
      const ts = map.get('agent-no-ts')?.timestamp ?? 0;
      expect(ts).toBeGreaterThanOrEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // extractTaskToolUses
  // -------------------------------------------------------------------------

  describe('extractTaskToolUses', () => {
    it('extracts Task tool_use blocks from assistant messages', () => {
      const messages: SessionHistoryMessage[] = [
        msg({
          type: 'assistant',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Task',
                input: {
                  subagent_type: 'research',
                  description: 'find x',
                  prompt: 'go',
                },
              },
            ],
          },
        }),
      ];
      const out = service.extractTaskToolUses(messages);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        toolUseId: 'tool-1',
        subagentType: 'research',
      });
      expect(out[0].resumeAgentId).toBeUndefined();
    });

    it('captures resumeAgentId when Task input contains a `resume` field', () => {
      const messages: SessionHistoryMessage[] = [
        msg({
          type: 'assistant',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-resume',
                name: 'Task',
                input: {
                  subagent_type: 'research',
                  description: 'resume me',
                  prompt: 'go',
                  resume: 'a329b32',
                },
              },
            ],
          },
        }),
      ];
      const out = service.extractTaskToolUses(messages);
      expect(out[0].resumeAgentId).toBe('a329b32');
    });

    it('ignores assistant messages with non-Task tool_use blocks', () => {
      const messages: SessionHistoryMessage[] = [
        msg({
          type: 'assistant',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 't-read',
                name: 'Read',
                input: { path: '/tmp/x' },
              },
            ],
          },
        }),
      ];
      expect(service.extractTaskToolUses(messages)).toEqual([]);
    });

    it('returns [] when messages contain no assistant tool_use blocks', () => {
      const messages: SessionHistoryMessage[] = [
        msg({ type: 'user', message: { role: 'user', content: 'hi' } }),
      ];
      expect(service.extractTaskToolUses(messages)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // correlateAgentsToTasks
  // -------------------------------------------------------------------------

  describe('correlateAgentsToTasks', () => {
    it('directly maps resume tasks to the agent with matching resumeAgentId', () => {
      const tasks = [
        {
          toolUseId: 'tool-resume',
          timestamp: 10_000,
          subagentType: 'research',
          resumeAgentId: 'a329b32',
        },
      ];
      const map = new Map([
        [
          'agent-a329b32',
          {
            agentId: 'agent-a329b32',
            timestamp: 999_999,
            executionMessages: [],
          },
        ],
      ]);

      const out = service.correlateAgentsToTasks(tasks, map);
      expect(out.get('tool-resume')).toBe('agent-a329b32');
    });

    it('warns when a resume task references an unknown agent', () => {
      const tasks = [
        {
          toolUseId: 'tool-missing',
          timestamp: 0,
          subagentType: 'x',
          resumeAgentId: 'unknown',
        },
      ];
      const map = new Map<
        string,
        {
          agentId: string;
          timestamp: number;
          executionMessages: SessionHistoryMessage[];
        }
      >();

      const out = service.correlateAgentsToTasks(tasks, map);
      expect(out.size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Resume task agent not found'),
        expect.any(Object),
      );
    });

    it('timestamp-matches a non-resume task to the closest in-window agent', () => {
      const tasks = [
        {
          toolUseId: 'tool-A',
          timestamp: 1_000_000,
          subagentType: 'research',
        },
      ];
      const map = new Map([
        [
          'agent-far',
          {
            agentId: 'agent-far',
            timestamp: 1_000_000 + 50_000, // in window (50s)
            executionMessages: [],
          },
        ],
        [
          'agent-close',
          {
            agentId: 'agent-close',
            timestamp: 1_000_000 + 500, // in window (0.5s) — closer
            executionMessages: [],
          },
        ],
      ]);

      const out = service.correlateAgentsToTasks(tasks, map);
      expect(out.get('tool-A')).toBe('agent-close');
    });

    it('rejects agents outside the [-1000ms, +60000ms) correlation window', () => {
      const tasks = [
        { toolUseId: 'tool-A', timestamp: 1_000_000, subagentType: 'research' },
      ];
      const map = new Map([
        [
          'agent-too-early',
          {
            agentId: 'agent-too-early',
            timestamp: 1_000_000 - 2_000, // 2s before — out of window
            executionMessages: [],
          },
        ],
        [
          'agent-too-late',
          {
            agentId: 'agent-too-late',
            timestamp: 1_000_000 + 61_000, // 61s after — out of window
            executionMessages: [],
          },
        ],
      ]);

      const out = service.correlateAgentsToTasks(tasks, map);
      expect(out.size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No agent found for task'),
        expect.objectContaining({ toolUseId: 'tool-A' }),
      );
    });

    it('does not reassign the same agent to two different tasks', () => {
      const tasks = [
        { toolUseId: 'tool-1', timestamp: 1_000_000, subagentType: 'a' },
        { toolUseId: 'tool-2', timestamp: 1_000_100, subagentType: 'b' },
      ];
      const map = new Map([
        [
          'agent-only-one',
          {
            agentId: 'agent-only-one',
            timestamp: 1_000_200,
            executionMessages: [],
          },
        ],
      ]);

      const out = service.correlateAgentsToTasks(tasks, map);
      // One of them gets the agent; the other is orphaned.
      const values = [...out.values()];
      expect(values.length).toBe(1);
      expect(values[0]).toBe('agent-only-one');
    });
  });

  // -------------------------------------------------------------------------
  // extractAllToolResults
  // -------------------------------------------------------------------------

  describe('extractAllToolResults', () => {
    it('collects tool_result blocks from user messages keyed by tool_use_id', () => {
      const messages: SessionHistoryMessage[] = [
        msg({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-1',
                content: 'result text',
                is_error: false,
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-2',
                content: [
                  { type: 'text', text: 'line a' },
                  { type: 'text', text: 'line b' },
                ],
                is_error: true,
              },
            ],
          },
        }),
      ];

      const results = service.extractAllToolResults(messages);
      expect(results.get('tool-1')).toEqual({
        content: 'result text',
        isError: false,
      });
      expect(results.get('tool-2')).toEqual({
        content: 'line a\nline b',
        isError: true,
      });
    });

    it('skips non-user messages and string-content user messages', () => {
      const messages: SessionHistoryMessage[] = [
        msg({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'never-extracted',
                content: 'nope',
              },
            ],
          },
        }),
        msg({
          type: 'user',
          message: { role: 'user', content: 'plain user text, no tool_result' },
        }),
      ];

      expect(service.extractAllToolResults(messages).size).toBe(0);
    });
  });
});
