/**
 * The 2 000-event monitor cap must not blank the card it is capping.
 *
 * `AgentMonitorStore` trims an agent's `streamEvents` back to
 * `MAX_AGENT_STREAM_EVENTS`, keeping the recent tail plus the LANDMARK events
 * (`message_start`, `tool_start`, `tool_result`, …) before it.
 * `AgentMonitorTreeBuilderService` does not render events, though — it renders
 * the ACCUMULATORS it folds them into, keyed by `${messageId}-block-${index}`
 * and `${toolCallId}-input`. Keeping landmarks alone therefore kept every
 * message and tool NODE while deleting everything that gives them content, and
 * because the builder folds each event exactly once, nothing could restore it:
 * a long-running agent's card turned into empty message bodies and tool calls
 * with no input (TASK_2026_327 finding 3).
 *
 * The trim now folds the dropped delta content into the surviving structure.
 * The assertion here is the strong one: the tree built from the CAPPED buffer
 * renders the same text and the same tool input as the tree built from the
 * whole, uncapped stream.
 */

import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { createMockRpcService } from '@ptah-extension/core/testing';
import type {
  AgentOutputDelta,
  ExecutionNode,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { AgentMonitorTreeBuilderService } from './agent-monitor-tree-builder.service';

/** Mirrors the private constants in `agent-monitor.store.ts`. */
const MAX_AGENT_STREAM_EVENTS = 2000;
const AGENT_STREAM_EVENTS_CAP_SLACK = 200;

const MESSAGE_ID = 'm-long-running';
const TOOL_CALL_ID = 'toolu_capped';
const TOOL_INPUT = { file_path: '/src/very/long/path.ts', limit: 400 };

const mockActiveTab = signal<{ claudeSessionId?: string } | null>(null);
const mockTabManager = {
  activeTab: mockActiveTab,
  activeTabSessionId: computed(() => mockActiveTab()?.claudeSessionId ?? null),
  tabs: signal([]),
};
const mockVSCodeService = {
  config: signal({ panelId: '' }),
  postMessage: jest.fn(),
};

let clock = 0;
const nextTimestamp = (): number => (clock += 1);

function event(
  eventType: string,
  fields: Record<string, unknown>,
): FlatStreamEventUnion {
  return {
    timestamp: nextTimestamp(),
    sessionId: undefined,
    source: 'stream',
    eventType,
    ...fields,
  } as unknown as FlatStreamEventUnion;
}

/**
 * A stream shaped like a long agent turn: one message, one tool whose input
 * arrives as streamed JSON, then thousands of text deltas. Everything except
 * the three landmarks and the last 400 deltas falls outside the cap.
 */
function longAgentStream(): {
  events: FlatStreamEventUnion[];
  expectedText: string;
} {
  clock = 0;
  const events: FlatStreamEventUnion[] = [
    event('message_start', {
      id: 'evt-msg',
      messageId: MESSAGE_ID,
      role: 'assistant',
    }),
    event('tool_start', {
      id: 'evt-tool',
      messageId: MESSAGE_ID,
      toolCallId: TOOL_CALL_ID,
      toolName: 'Read',
      isTaskTool: false,
    }),
  ];

  // Streamed tool input, split into chunks the way the SDK sends it. Every one
  // of these sits well before the tail and is dropped by the trim.
  const inputJson = JSON.stringify(TOOL_INPUT);
  for (let i = 0; i < inputJson.length; i += 4) {
    events.push(
      event('tool_delta', {
        id: `evt-tool-delta-${i}`,
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        delta: inputJson.slice(i, i + 4),
      }),
    );
  }
  events.push(
    event('tool_result', {
      id: 'evt-tool-result',
      messageId: MESSAGE_ID,
      toolCallId: TOOL_CALL_ID,
      output: 'file contents',
      isError: false,
    }),
  );

  // Enough deltas to blow past the cap and its slack several times over.
  const DELTA_COUNT = MAX_AGENT_STREAM_EVENTS + AGENT_STREAM_EVENTS_CAP_SLACK;
  let expectedText = '';
  for (let i = 0; i < DELTA_COUNT; i++) {
    const delta = `w${i} `;
    expectedText += delta;
    events.push(
      event('text_delta', {
        id: `evt-text-${i}`,
        messageId: MESSAGE_ID,
        blockIndex: 0,
        delta,
      }),
    );
  }

  return { events, expectedText };
}

function findByType(
  nodes: readonly ExecutionNode[],
  type: ExecutionNode['type'],
): ExecutionNode | undefined {
  for (const node of nodes) {
    if (node.type === type) return node;
    const nested = findByType(node.children, type);
    if (nested) return nested;
  }
  return undefined;
}

describe('agent monitor — the 2 000-event cap keeps the card renderable', () => {
  let store: AgentMonitorStore;
  let treeBuilder: AgentMonitorTreeBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AgentMonitorStore,
        AgentMonitorTreeBuilderService,
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: VSCodeService, useValue: mockVSCodeService },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
      ],
    });
    store = TestBed.inject(AgentMonitorStore);
    treeBuilder = TestBed.inject(AgentMonitorTreeBuilderService);
    mockActiveTab.set(null);
  });

  afterEach(() => TestBed.resetTestingModule());

  /** Push `events` through the store and hand back the capped buffer. */
  function capped(
    agentId: string,
    events: readonly FlatStreamEventUnion[],
  ): readonly FlatStreamEventUnion[] {
    store.onAgentSpawned({
      agentId,
      cli: 'ptah-cli',
      task: agentId,
      status: 'running',
      startedAt: new Date(0).toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    store.onAgentOutput({
      agentId,
      streamEvents: [...events],
    } as AgentOutputDelta);
    const agent = store.agents().find((a) => a.agentId === agentId);
    if (!agent) throw new Error(`missing agent ${agentId}`);
    return agent.streamEvents;
  }

  it('renders the same text and tool input from the capped buffer as from the whole stream', () => {
    const { events, expectedText } = longAgentStream();
    // Build the reference tree from a pristine copy — the cap trims in place.
    const reference = treeBuilder.buildTree('reference', [...events]);

    const trimmed = capped('capped', events);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_AGENT_STREAM_EVENTS);
    expect(trimmed.length).toBeLessThan(events.length);

    const tree = treeBuilder.buildTree('capped', trimmed);

    const text = findByType(tree, 'text');
    expect(text?.content).toBe(expectedText);
    expect(text?.content).toBe(findByType(reference, 'text')?.content);

    const tool = findByType(tree, 'tool');
    expect(tool?.toolInput).toEqual(TOOL_INPUT);
    expect(tool?.toolInput).toEqual(findByType(reference, 'tool')?.toolInput);
    expect(tool?.status).toBe('complete');
  });

  it('leaves no empty message body behind, and the body still starts at the start of the turn', () => {
    const { events, expectedText } = longAgentStream();
    const tree = treeBuilder.buildTree('capped', capped('capped', events));

    const text = findByType(tree, 'text');
    expect(text).toBeDefined();
    expect(text?.content).toBeTruthy();
    // Not just "non-empty": the surviving 400-event tail alone is already
    // thousands of characters, so length proves nothing on its own. The
    // opening words are the ones the trim dropped.
    expect(text?.content?.startsWith('w0 w1 w2 ')).toBe(true);
    expect(text?.content).toHaveLength(expectedText.length);
  });

  it('keeps a tool input that arrived entirely as dropped tool_deltas', () => {
    const { events } = longAgentStream();
    const trimmed = capped('capped', events);

    // Every tool_delta really is gone — the input survives on the landmark.
    expect(trimmed.some((e) => e.eventType === 'tool_delta')).toBe(false);

    const tool = findByType(treeBuilder.buildTree('capped', trimmed), 'tool');
    expect(tool?.toolInput).toEqual(TOOL_INPUT);
  });

  it('a tool whose deltas straddle the trim boundary still parses as one input', () => {
    clock = 0;
    const inputJson = JSON.stringify(TOOL_INPUT);
    const events: FlatStreamEventUnion[] = [
      event('message_start', {
        id: 'evt-msg',
        messageId: MESSAGE_ID,
        role: 'assistant',
      }),
      event('tool_start', {
        id: 'evt-tool',
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        toolName: 'Read',
        isTaskTool: false,
      }),
    ];

    // Filler that will be dropped, then the tool input split across the
    // boundary: its first half is dropped, its second half survives in the tail.
    const FILLER = MAX_AGENT_STREAM_EVENTS + AGENT_STREAM_EVENTS_CAP_SLACK;
    for (let i = 0; i < FILLER; i++) {
      events.push(
        event('text_delta', {
          id: `evt-text-${i}`,
          messageId: MESSAGE_ID,
          blockIndex: 0,
          delta: 'x',
        }),
      );
    }
    // 400 events are always kept; splitting the input across the last ~600
    // events puts part of it either side of that line.
    const split = Math.floor(inputJson.length / 2);
    events.splice(
      events.length - 600,
      0,
      event('tool_delta', {
        id: 'evt-tool-delta-head',
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        delta: inputJson.slice(0, split),
      }),
    );
    events.splice(
      events.length - 200,
      0,
      event('tool_delta', {
        id: 'evt-tool-delta-tail',
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        delta: inputJson.slice(split),
      }),
    );
    events.push(
      event('tool_result', {
        id: 'evt-tool-result',
        messageId: MESSAGE_ID,
        toolCallId: TOOL_CALL_ID,
        output: 'file contents',
        isError: false,
      }),
    );

    const trimmed = capped('straddle', events);
    const tool = findByType(treeBuilder.buildTree('straddle', trimmed), 'tool');

    // Both halves are present and concatenate to one parseable document — the
    // failure mode being ruled out is the tail fragment being parsed alone.
    expect(tool?.toolInput).toEqual(TOOL_INPUT);
  });
});
