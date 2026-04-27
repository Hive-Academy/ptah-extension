/**
 * Integration coverage for the pure builder fns.
 *
 * The builders cooperate via the {@link BuilderDeps} callback bag (instead
 * of importing each other) — so this spec wires them up the same way
 * `ExecutionTreeBuilderService` does and drives realistic streaming-state
 * scenarios end-to-end. That structure exercises agent-node.fn,
 * message-node.fn, and tool-node.fn (incl. `tryBuildPlaceholderAgent`)
 * without mocking any of them.
 *
 * TASK_2026_105 Wave G1.
 */

import { TestBed } from '@angular/core/testing';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import type {
  AgentStartEvent,
  ExecutionNode,
  FlatStreamEventUnion,
  MessageCompleteEvent,
  MessageStartEvent,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import { AgentStatsService } from '../agent-stats.service';
import { buildAgentNode, buildInterleavedChildren } from './agent-node.fn';
import type { BackgroundAgentLookup, BuilderDeps } from './builder-deps';
import { buildMessageNode, findMessageStartEvent } from './message-node.fn';
import { buildToolChildren, buildToolNode, collectTools } from './tool-node.fn';

function makeBackgroundAgentStub(
  bgIds: ReadonlySet<string> = new Set(),
): BackgroundAgentLookup {
  return {
    isBackgroundAgent: (id: string) => bgIds.has(id),
  };
}

function setEvent(state: StreamingState, event: FlatStreamEventUnion): void {
  state.events.set(event.id, event);
  if (event.eventType === 'message_start') {
    if (!state.messageEventIds.includes(event.messageId)) {
      state.messageEventIds.push(event.messageId);
    }
  }
  const bucket = state.eventsByMessage.get(event.messageId) ?? [];
  bucket.push(event);
  state.eventsByMessage.set(event.messageId, bucket);
}

function makeDeps(
  agentStats: AgentStatsService,
  bgStore: BackgroundAgentLookup,
): BuilderDeps {
  const deps: BuilderDeps = {
    backgroundAgentStore: bgStore,
    agentStats,
    loggedUnmatchedToolCallIds: new Set<string>(),
    buildMessageNode: (messageId, st, depth = 0) =>
      buildMessageNode(deps, messageId, st, depth),
    findMessageStartEvent: (st, messageId) =>
      findMessageStartEvent(st, messageId),
    buildToolNode: (toolStart, st, depth = 0) =>
      buildToolNode(deps, toolStart, st, depth),
    buildToolChildren: (toolCallId, st, depth = 0) =>
      buildToolChildren(deps, toolCallId, st, depth),
    collectTools: (messageId, st, depth) =>
      collectTools(deps, messageId, st, depth),
    buildAgentNode: (agentStart, toolCallId, st, depth) =>
      buildAgentNode(deps, agentStart, toolCallId, st, depth),
    buildInterleavedChildren,
  };
  return deps;
}

describe('builder fns (integration)', () => {
  let agentStats: AgentStatsService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [AgentStatsService] });
    agentStats = TestBed.inject(AgentStatsService);
  });

  describe('buildMessageNode', () => {
    it('returns null when no message_start exists for the messageId', () => {
      const state = createEmptyStreamingState();
      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      expect(buildMessageNode(deps, 'unknown_msg', state)).toBeNull();
    });

    it('builds a streaming message node with a text child accumulator', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_msg';
      const messageId = 'msg_text';

      setEvent(state, {
        id: 'evt_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      // Text accumulator entry — message_node.fn collects "<msg>-block-<n>" keys.
      state.textAccumulators.set(`${messageId}-block-0`, 'hello world');
      // Anchor delta event for timestamp lookup.
      setEvent(state, {
        id: 'evt_text_delta',
        eventType: 'text_delta',
        timestamp: 110,
        sessionId,
        messageId,
        delta: 'hello world',
        blockIndex: 0,
      } as FlatStreamEventUnion);

      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const node = buildMessageNode(deps, messageId, state);

      expect(node).not.toBeNull();
      expect(node?.type).toBe('message');
      expect(node?.status).toBe('streaming'); // no message_complete yet
      expect(node?.children.length).toBe(1);
      expect(node?.children[0].type).toBe('text');
      expect(node?.children[0].content).toBe('hello world');
    });

    it('builds a complete message node with thinking + text blocks sorted by timestamp', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_msg2';
      const messageId = 'msg_thinking';

      setEvent(state, {
        id: 'evt_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      setEvent(state, {
        id: 'evt_complete',
        eventType: 'message_complete',
        timestamp: 500,
        sessionId,
        messageId,
        tokenUsage: { input: 10, output: 5 },
        cost: 0.0001,
        duration: 400,
      } as MessageCompleteEvent);

      // thinking block — earlier timestamp than text via delta anchors below.
      state.textAccumulators.set(`${messageId}-thinking-0`, 'pondering...');
      setEvent(state, {
        id: 'evt_thinking_delta',
        eventType: 'thinking_delta',
        timestamp: 105,
        sessionId,
        messageId,
        delta: 'pondering...',
        blockIndex: 0,
      } as FlatStreamEventUnion);

      // text block — later timestamp.
      state.textAccumulators.set(`${messageId}-block-0`, 'final answer');
      setEvent(state, {
        id: 'evt_text_delta',
        eventType: 'text_delta',
        timestamp: 200,
        sessionId,
        messageId,
        delta: 'final answer',
        blockIndex: 0,
      } as FlatStreamEventUnion);

      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const node = buildMessageNode(deps, messageId, state);

      expect(node?.status).toBe('complete');
      expect(node?.tokenUsage).toEqual({ input: 10, output: 5 });
      expect(node?.cost).toBe(0.0001);
      expect(node?.duration).toBe(400);
      expect(node?.children.map((c) => c.type)).toEqual(['thinking', 'text']);
    });

    it('findMessageStartEvent returns undefined for unknown messageId and the start event for known', () => {
      const state = createEmptyStreamingState();
      expect(findMessageStartEvent(state, 'nope')).toBeUndefined();

      const messageId = 'msg_known';
      setEvent(state, {
        id: 'evt_start_known',
        eventType: 'message_start',
        timestamp: 50,
        sessionId: 's',
        messageId,
        role: 'user',
      } as MessageStartEvent);
      const found = findMessageStartEvent(state, messageId);
      expect(found?.messageId).toBe(messageId);
      expect(found?.role).toBe('user');
    });
  });

  describe('buildToolNode + collectTools (regular tools)', () => {
    it('builds a tool node from a streaming tool_start without toolInput accumulator', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_tool';
      const messageId = 'msg_tool';
      const toolCallId = 'toolu_read_1';

      setEvent(state, {
        id: 'evt_msg_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      const toolStart: ToolStartEvent = {
        id: 'evt_tool_start',
        eventType: 'tool_start',
        timestamp: 110,
        sessionId,
        messageId,
        toolCallId,
        toolName: 'Read',
        isTaskTool: false,
      };
      setEvent(state, toolStart);

      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const node = buildToolNode(deps, toolStart, state, 0);

      expect(node.type).toBe('tool');
      expect(node.status).toBe('streaming');
      expect(node.toolName).toBe('Read');
      expect(node.toolInput).toBeUndefined();
    });

    it('parses accumulated JSON toolInput once tool_result arrives and marks node complete', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_tool2';
      const messageId = 'msg_tool2';
      const toolCallId = 'toolu_read_2';

      setEvent(state, {
        id: 'evt_msg_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      const toolStart: ToolStartEvent = {
        id: 'evt_tool_start',
        eventType: 'tool_start',
        timestamp: 110,
        sessionId,
        messageId,
        toolCallId,
        toolName: 'Read',
        isTaskTool: false,
      };
      setEvent(state, toolStart);

      state.toolInputAccumulators.set(
        `${toolCallId}-input`,
        JSON.stringify({ file_path: '/tmp/a.txt' }),
      );

      const toolResult: ToolResultEvent = {
        id: 'evt_tool_result',
        eventType: 'tool_result',
        timestamp: 200,
        sessionId,
        messageId,
        toolCallId,
        output: 'file contents',
        isError: false,
      };
      setEvent(state, toolResult);

      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const node = buildToolNode(deps, toolStart, state, 0);

      expect(node.status).toBe('complete');
      expect(node.toolInput).toEqual({ file_path: '/tmp/a.txt' });
      expect(node.toolOutput).toBe('file contents');
    });

    it('falls back to toolStart.toolInput when accumulator parse fails but toolInput is provided', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_tool3';
      const messageId = 'msg_tool3';
      const toolCallId = 'toolu_read_3';

      setEvent(state, {
        id: 'evt_msg_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      const toolStart: ToolStartEvent = {
        id: 'evt_tool_start',
        eventType: 'tool_start',
        timestamp: 110,
        sessionId,
        messageId,
        toolCallId,
        toolName: 'Read',
        isTaskTool: false,
        toolInput: { file_path: '/historical.txt' },
      };
      setEvent(state, toolStart);

      // Partial / invalid accumulator JSON.
      state.toolInputAccumulators.set(`${toolCallId}-input`, '{file_path:bad');

      setEvent(state, {
        id: 'evt_tool_result',
        eventType: 'tool_result',
        timestamp: 200,
        sessionId,
        messageId,
        toolCallId,
        output: 'data',
        isError: false,
      } as ToolResultEvent);

      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const node = buildToolNode(deps, toolStart, state, 0);
      expect(node.toolInput).toEqual({ file_path: '/historical.txt' });
    });

    it('collectTools collects only top-level tools at depth 0 (skips nested parentToolUseId tools)', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_tool4';
      const messageId = 'msg_tool4';

      setEvent(state, {
        id: 'evt_msg_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      // Top-level tool — should be collected.
      const topTool: ToolStartEvent = {
        id: 'evt_top',
        eventType: 'tool_start',
        timestamp: 110,
        sessionId,
        messageId,
        toolCallId: 'toolu_top',
        toolName: 'Read',
        isTaskTool: false,
      };
      setEvent(state, topTool);

      // Nested tool (has parentToolUseId) — should be skipped at depth 0.
      const nestedTool: ToolStartEvent = {
        id: 'evt_nested',
        eventType: 'tool_start',
        timestamp: 120,
        sessionId,
        messageId,
        parentToolUseId: 'toolu_top',
        toolCallId: 'toolu_nested',
        toolName: 'Bash',
        isTaskTool: false,
      };
      setEvent(state, nestedTool);

      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const tools = collectTools(deps, messageId, state, 0);
      expect(tools).toHaveLength(1);
      expect(tools[0].toolCallId).toBe('toolu_top');
    });
  });

  describe('agent dispatch + buildAgentNode', () => {
    it('builds an agent node when a Task tool has a matching agent_start', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_agent';
      const messageId = 'msg_agent';
      const taskToolCallId = 'toolu_task_1';

      setEvent(state, {
        id: 'evt_msg_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      const taskTool: ToolStartEvent = {
        id: 'evt_task',
        eventType: 'tool_start',
        timestamp: 110,
        sessionId,
        messageId,
        toolCallId: taskToolCallId,
        toolName: 'Task',
        isTaskTool: true,
        agentType: 'researcher',
        agentDescription: 'Research the topic',
      };
      setEvent(state, taskTool);

      // Task-tool needs an agent_start parent-linked + a tool_result for completion.
      setEvent(state, {
        id: 'evt_agent_start',
        eventType: 'agent_start',
        timestamp: 120,
        sessionId,
        messageId,
        parentToolUseId: taskToolCallId,
        toolCallId: taskToolCallId,
        agentType: 'researcher',
        agentDescription: 'Research the topic',
        agentId: 'agent_abc',
      } as AgentStartEvent);

      setEvent(state, {
        id: 'evt_task_result',
        eventType: 'tool_result',
        timestamp: 300,
        sessionId,
        messageId,
        toolCallId: taskToolCallId,
        output: 'done',
        isError: false,
      } as ToolResultEvent);

      const deps = makeDeps(
        agentStats,
        makeBackgroundAgentStub(new Set([taskToolCallId])),
      );
      const tools = collectTools(deps, messageId, state, 0);
      expect(tools).toHaveLength(1);
      const agent = tools[0];
      expect(agent.type).toBe('agent');
      expect(agent.status).toBe('complete'); // tool_result present
      expect(agent.agentType).toBe('researcher');
      expect(agent.isBackground).toBe(true); // bgStore returned true
    });

    it('emits a streaming placeholder agent when a Task tool has no agent_start yet', () => {
      const state = createEmptyStreamingState();
      const sessionId = 'session_agent2';
      const messageId = 'msg_agent2';
      const taskToolCallId = 'toolu_task_pending';

      setEvent(state, {
        id: 'evt_msg_start',
        eventType: 'message_start',
        timestamp: 100,
        sessionId,
        messageId,
        role: 'assistant',
      } as MessageStartEvent);

      const taskTool: ToolStartEvent = {
        id: 'evt_task_pending',
        eventType: 'tool_start',
        timestamp: 110,
        sessionId,
        messageId,
        toolCallId: taskToolCallId,
        toolName: 'Task',
        isTaskTool: true,
      };
      setEvent(state, taskTool);

      // Streaming-style accumulator-only JSON — no agent_start, no tool_result.
      state.toolInputAccumulators.set(
        `${taskToolCallId}-input`,
        '{"subagent_type":"reviewer","description":"Review code"',
      );

      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const tools = collectTools(deps, messageId, state, 0);
      expect(tools).toHaveLength(1);
      const placeholder = tools[0];
      expect(placeholder.type).toBe('agent');
      expect(placeholder.status).toBe('streaming');
      expect(placeholder.agentType).toBe('reviewer');
      expect(placeholder.id.startsWith('agent-placeholder-')).toBe(true);
    });

    it('returns null from buildAgentNode at MAX_DEPTH (recursion guard)', () => {
      const state = createEmptyStreamingState();
      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const agentStart: AgentStartEvent = {
        id: 'evt_agent_deep',
        eventType: 'agent_start',
        timestamp: 1,
        sessionId: 's',
        messageId: 'm',
        toolCallId: 'toolu_deep',
        agentType: 'deep',
      };
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = buildAgentNode(deps, agentStart, 'toolu_deep', state, 999);
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('buildToolChildren returns [] at MAX_DEPTH (recursion guard)', () => {
      const state = createEmptyStreamingState();
      const deps = makeDeps(agentStats, makeBackgroundAgentStub());
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = buildToolChildren(deps, 'toolu_x', state, 999);
      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('buildInterleavedChildren', () => {
    function makeToolNode(toolCallId: string): ExecutionNode {
      return {
        id: `node-${toolCallId}`,
        type: 'tool',
        status: 'complete',
        content: null,
        children: [],
        isCollapsed: false,
        toolCallId,
        toolName: 'Read',
      };
    }

    it('interleaves text nodes between tool refs in declared order', () => {
      const tools = [makeToolNode('toolu_a'), makeToolNode('toolu_b')];
      const result = buildInterleavedChildren(
        'agent_1',
        1000,
        [
          { type: 'text', text: 'before' },
          { type: 'tool_ref', toolUseId: 'toolu_a', toolName: 'Read' },
          { type: 'text', text: 'middle' },
          { type: 'tool_ref', toolUseId: 'toolu_b', toolName: 'Read' },
          { type: 'text', text: 'after' },
        ],
        tools,
      );
      expect(result.map((n) => n.type)).toEqual([
        'text',
        'tool',
        'text',
        'tool',
        'text',
      ]);
      expect(result[0].content).toBe('before');
      expect(result[1].toolCallId).toBe('toolu_a');
    });

    it('appends tools that were not referenced in content blocks', () => {
      const tools = [makeToolNode('toolu_a'), makeToolNode('toolu_orphan')];
      const result = buildInterleavedChildren(
        'agent_1',
        1000,
        [{ type: 'tool_ref', toolUseId: 'toolu_a' }],
        tools,
      );
      expect(result).toHaveLength(2);
      expect(result[0].toolCallId).toBe('toolu_a');
      expect(result[1].toolCallId).toBe('toolu_orphan');
    });

    it('logs a debug when a tool_ref points to a tool not present in toolChildren', () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
      const result = buildInterleavedChildren(
        'agent_1',
        1000,
        [{ type: 'tool_ref', toolUseId: 'toolu_missing', toolName: 'Bash' }],
        [],
      );
      expect(result).toEqual([]);
      expect(debugSpy).toHaveBeenCalled();
      debugSpy.mockRestore();
    });
  });
});
