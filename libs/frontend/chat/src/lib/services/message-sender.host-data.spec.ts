/**
 * `MessageSenderService` — the host-built recap data boundary
 * (TASK_2026_610 Req 1.5 / 5.12; logic review finding e).
 *
 * The recap the HOST builds after a turn — change sets, per-turn cost / token
 * usage and test runs — must never reach the serialized `chat:continue`
 * request. The sentinel data lives in the REAL services the app uses, not in
 * a local Map the sender never sees:
 *
 * - `ChangeSetStore` is the real store, seeded through its public
 *   `handleMessage` push path (`git:turnChangeSet`) exactly as the host
 *   router delivers it, so a future regression where the sender starts
 *   reading it has real data to leak.
 * - The transcript the sender reads through `TabManagerService` carries the
 *   sentinel usage (cost, tokens) and the sentinel Bash test run.
 *
 * A positive control proves the sentinels are readable from the injected
 * services — so a passing boundary test means the data was really held back —
 * and a negative control proves the assertion helper can fail.
 *
 * TASK_2026_623 extends the fixture (R5.8, R6.7, R10.5):
 *
 * - `$agents`: the `AgentMonitorStore` the `$agents` adapter reads holds a
 *   subagent and a CLI lane named after a sentinel, each costing `0.623623`.
 * - `$limits`: the `agent:getLanePlanLimits` read the `$limits` adapter makes
 *   answers a sentinel lane with the used value `62.3623%`.
 * - The turn summary: the REAL `DisplayDockState` holds the host-built
 *   summary of the seeded turn (its file, cost and test-run values).
 */
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AuthStateService,
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  PtahCliStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  SessionManager,
  StreamingHandlerService,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import {
  MESSAGE_TYPES,
  buildTurnSourceSnapshot,
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type TurnChangeSet,
} from '@ptah-extension/shared';
import {
  renderPtahUiBlock,
  type PtahUiAgentsInput,
  type PtahUiLimitsInput,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { buildTurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type { TabState } from '@ptah-extension/chat-types';
import { anchorTurnTests } from '../components/organisms/transcript/transcript-turns';
import { ChangeSetStore } from './change-set/change-set.store';
import { DisplayDockState } from './display-dock/display-dock.state';
import { MessageValidationService } from './message-validation.service';
import {
  MessageSenderService,
  type SendOutcome,
} from './message-sender.service';

const SESSION_ID = 'sess-host-data';
const TAB_ID = 'tab-host-data';
const WORKSPACE_ROOT = 'D:/repo';

const SENTINEL_PATH = 'zz_sentinel_610.ts';
const SENTINEL_COST = 0.61061;
const SENTINEL_TOKENS = 610610;
const SENTINEL_LABEL = 'A5_SENTINEL_TEST_LABEL';

/** R5.8: the `$agents` sentinel name and cost. */
const AGENT_SENTINEL_NAME = 'zz_sentinel_623_agent';
const AGENT_SENTINEL_COST = 0.623623;
const AGENT_TOOL_USE_ID = 'tool-agents-host-data';
/** R10.5: the `$limits` sentinel lane and used value. */
const LIMITS_SENTINEL_LANE = 'zz_sentinel_623_lane';
const LIMITS_SENTINEL_USED = '62.3623%';
const SUMMARY_TURN_KEY = 'turn-host-data';

const PTAH_UI_FENCE_BODY = [
  'stats',
  '  Files | $diff.files',
  '  Cost | $usage.cost',
  'table $diff',
  'list $tests',
].join('\n');
/** A panel block naming both live sources (R2.1); it stays raw in the transcript. */
const DISPLAY_FENCE_BODY = [
  'stats',
  '  Agents | $agents.total',
  '  Agent cost | $agents.cost',
  '  Lanes at limit | $limits.atLimit',
  'table $agents',
  'table $limits',
].join('\n');
const ASSISTANT_TEXT = [
  'All tests passed and 3 files changed.',
  '```ptah-ui',
  PTAH_UI_FENCE_BODY,
  '```',
  '```ptah-ui display agent-usage',
  DISPLAY_FENCE_BODY,
  '```',
].join('\n');

/** The `agent:getLanePlanLimits` result the `$limits` adapter reads. */
const LIMITS_RESULT = {
  rows: [
    {
      lane: LIMITS_SENTINEL_LANE,
      window: '5h',
      used: LIMITS_SENTINEL_USED,
      state: 'near limit',
      reset: '14:00',
    },
  ],
  lanes: 1,
  atLimit: 0,
  nearLimit: 1,
  unknown: 0,
  asOf: 1,
} as const;

/** The 623 sentinels (R5.8, R10.5): absent from params and stored message text. */
const SENTINELS_623: readonly string[] = [
  AGENT_SENTINEL_NAME,
  `${AGENT_SENTINEL_COST}`,
  LIMITS_SENTINEL_LANE,
  LIMITS_SENTINEL_USED,
];

/**
 * Every string that must not appear in a serialized `chat:continue` request.
 * The cost is listed stringified because `JSON.stringify` drops the trailing
 * zero (`0.610610` serializes as `0.61061`), and the stringified form is
 * what a leak would surface. The 610 values are also every value the R6.7
 * turn summary shows, because the summary is built from the same turn.
 */
const SENTINELS: readonly string[] = [
  SENTINEL_PATH,
  `${SENTINEL_COST}`,
  `${SENTINEL_TOKENS}`,
  SENTINEL_LABEL,
  ...SENTINELS_623,
];

/**
 * The boundary assertion: throws (as a jest failure) on the first sentinel
 * found in the serialized request params — which is what the negative-control
 * test proves it can do.
 */
function expectNoSentinels(params: unknown): void {
  expect(params).toBeDefined();
  const serialized = JSON.stringify(params);
  for (const sentinel of SENTINELS) {
    expect(serialized).not.toContain(sentinel);
  }
}

/** What {@link setupSeededSender} hands back to a test. */
interface SeededSender {
  readonly changeSet: TurnChangeSet;
  readonly changeSetStore: ChangeSetStore;
  readonly assistant: ExecutionChatMessage;
  readonly messages: ExecutionChatMessage[];
  /** The stored transcript of the tab, as the tab manager holds it now. */
  readonly storedMessages: () => readonly ExecutionChatMessage[];
  /** The `$agents` input built from the injected `AgentMonitorStore`. */
  readonly agentsInput: () => PtahUiAgentsInput;
  /** The `$limits` input read through the injected `ClaudeRpcService`. */
  readonly limitsInput: () => Promise<PtahUiLimitsInput>;
  /** Sends the follow-up turn; resolves the outcome and captured params. */
  readonly send: () => Promise<{
    outcome: SendOutcome;
    params: Record<string, unknown> | undefined;
  }>;
}

/**
 * The `$agents` input of turn 0, built from the store's allow-listed fields as
 * the `$agents` adapter projects them (chat-ui `ptah-ui-agents.source.ts`).
 */
function agentsInputFrom(
  monitor: Pick<AgentMonitorStore, 'subagents' | 'agentsOwnedBySession'>,
): PtahUiAgentsInput {
  return {
    turnIndex: 0,
    turns: [{ startedAt: 0, nodes: [], spawnToolCallIds: [AGENT_TOOL_USE_ID] }],
    records: Array.from(monitor.subagents().values(), (record) => ({
      parentToolUseId: record.parentToolUseId,
      teammateName: record.teammateName,
      agentType: record.agentType,
      status: record.status,
      totalTokens: record.totalTokens,
      cost: record.usage?.estimatedCostUsd,
      durationMs: record.durationMs,
    })),
    lanes: monitor.agentsOwnedBySession(SESSION_ID).map((lane) => ({
      agentId: lane.agentId,
      cli: lane.cli,
      displayName: lane.displayName,
      status: lane.status,
      startedAt: lane.startedAt,
      cost: lane.usageTotals?.costUsd ?? null,
    })),
    capacities: [],
  };
}

/**
 * The sender's real dependency set with the sentinel recap data in the
 * services the app uses. Every collaborator the sender actually injects is
 * stubbed at its transport boundary — `ClaudeRpcService.call` captures the
 * serialized request — except `ChangeSetStore`, which is the REAL store and
 * is seeded through its public push path before the send.
 */
function setupSeededSender(): SeededSender {
  const changeSet: TurnChangeSet = {
    sessionId: SESSION_ID,
    workspaceRoot: WORKSPACE_ROOT,
    turnStartedAt: 1,
    turnEndedAt: 2,
    files: [{ path: SENTINEL_PATH, status: 'M', additions: 1, deletions: 0 }],
    truncatedCount: 0,
    totals: { files: 1, additions: 1, deletions: 0 },
    countsUnavailable: false,
  };
  const assistant = createExecutionChatMessage({
    id: 'assistant-host-data',
    role: 'assistant',
    rawContent: ASSISTANT_TEXT,
    cost: SENTINEL_COST,
    duration: SENTINEL_TOKENS,
    tokens: { input: SENTINEL_TOKENS, output: 1 },
    streamingState: createExecutionNode({
      id: 'root-host-data',
      type: 'message',
      status: 'complete',
      content: ASSISTANT_TEXT,
      children: [
        createExecutionNode({
          id: 'bash-host-data',
          type: 'tool',
          status: 'complete',
          content: null,
          toolName: 'Bash',
          toolInput: { command: `npx jest --label ${SENTINEL_LABEL}` },
          toolOutput: { output: 'passed', exitCode: 0 },
        }),
      ],
    }),
  });
  const messages: ExecutionChatMessage[] = [
    createExecutionChatMessage({
      id: 'user-host-data',
      role: 'user',
      rawContent: 'start',
    }),
    assistant,
  ];
  const tabs = signal<TabState[]>([
    {
      id: TAB_ID,
      title: 'Host data',
      name: 'Host data',
      status: 'loaded',
      messages,
      streamingState: null,
      currentMessageId: null,
      claudeSessionId: SESSION_ID,
      titleOrigin: 'default',
    } as TabState,
  ]);
  /** Params of every `chat:continue` call the stubbed RPC received. */
  const continueParams: unknown[] = [];
  const rpcCall = jest.fn(
    (method: string, params?: unknown): Promise<unknown> => {
      if (method === 'chat:continue') continueParams.push(params);
      if (method === 'agent:getLanePlanLimits') {
        return Promise.resolve({ success: true, data: LIMITS_RESULT });
      }
      return Promise.resolve(
        method === 'session:validate'
          ? { success: true, data: { exists: true } }
          : { success: true },
      );
    },
  );
  // The `$agents` adapter reads `subagents()` and `agentsOwnedBySession()`;
  // both hold the sentinel name and cost (R5.8).
  const subagentRecord = {
    parentToolUseId: AGENT_TOOL_USE_ID,
    agentId: 'agent-host-data',
    teammateName: AGENT_SENTINEL_NAME,
    agentType: 'code-reviewer',
    status: 'completed',
    totalTokens: 900,
    durationMs: 4_000,
    parentSessionId: SESSION_ID,
    usage: {
      input: 300,
      output: 200,
      model: 'claude-sonnet-4-5',
      estimatedCostUsd: AGENT_SENTINEL_COST,
    },
  } as SubagentRecord;
  const laneAgent = {
    agentId: 'lane-host-data',
    cli: 'codex',
    displayName: `${AGENT_SENTINEL_NAME}_cli`,
    status: 'completed',
    startedAt: 1_000,
    completedAt: 6_000,
    parentSessionId: SESSION_ID,
    usageTotals: { inputTokens: 40, outputTokens: 60, costUsd: AGENT_SENTINEL_COST },
  } as unknown as MonitoredAgent;
  const agentMonitor: Pick<
    AgentMonitorStore,
    'subagents' | 'agentsOwnedBySession'
  > = {
    subagents: signal<ReadonlyMap<string, SubagentRecord>>(
      new Map([[AGENT_TOOL_USE_ID, subagentRecord]]),
    ).asReadonly(),
    agentsOwnedBySession: (id: string) =>
      [laneAgent].filter((agent) => agent.parentSessionId === id),
  };
  const patchTab = (id: string, patch: Partial<TabState>) =>
    tabs.update((values) =>
      values.map((tab) =>
        tab.id === id ? ({ ...tab, ...patch } as TabState) : tab,
      ),
    );
  const tabManager = {
    tabs: computed(() => tabs()),
    activeTabId: computed(() => TAB_ID),
    activeTab: computed(() => tabs()[0]),
    // The ChangeSetStore push path drops a set for a session nobody opened,
    // so the stub must name the seeded session as active.
    activeTabSessionId: computed(() => SESSION_ID),
    activeWorkspacePath: null,
    createAbortController: jest.fn(() => new AbortController().signal),
    getAbortSignal: jest.fn(),
    findTabByIdAcrossWorkspaces: jest.fn(() => ({
      tab: tabs()[0],
      workspacePath: WORKSPACE_ROOT,
    })),
    markResuming: jest.fn((id: string) => patchTab(id, { status: 'resuming' })),
    markStreaming: jest.fn(),
    markTabStreaming: jest.fn(),
    setMessages: jest.fn((id: string, next: ExecutionChatMessage[]) =>
      patchTab(id, { messages: next }),
    ),
    markLoaded: jest.fn(),
    markTabIdle: jest.fn(),
    detachSessionAndMarkLoaded: jest.fn(),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      MessageSenderService,
      ChangeSetStore,
      DisplayDockState,
      { provide: AgentMonitorStore, useValue: agentMonitor },
      { provide: TabManagerService, useValue: tabManager },
      { provide: SessionManager, useValue: { setStatus: jest.fn() } },
      {
        provide: StreamingHandlerService,
        useValue: {
          recordUserPromptBoundary: jest.fn(),
          removeUserPromptBoundary: jest.fn(),
        },
      },
      {
        provide: MessageValidationService,
        useValue: {
          validate: jest.fn(() => ({ valid: true })),
          sanitize: jest.fn((text: string) => text),
        },
      },
      { provide: ClaudeRpcService, useValue: { call: rpcCall } },
      {
        provide: VSCodeService,
        useValue: {
          config: jest.fn(() => ({ workspaceRoot: WORKSPACE_ROOT })),
        },
      },
      {
        provide: ModelStateService,
        useValue: {
          currentModel: jest.fn(() => 'claude-sonnet-4'),
          availableModels: jest.fn(() => []),
        },
      },
      {
        provide: EffortStateService,
        useValue: { currentEffort: jest.fn(() => 'medium') },
      },
      {
        provide: PtahCliStateService,
        useValue: { selectedAgentId: jest.fn(() => null) },
      },
      { provide: AuthStateService, useValue: { flagAuthRequired: jest.fn() } },
    ],
  });
  // Seed the REAL ChangeSetStore through its public push path — the same
  // `git:turnChangeSet` message the host router delivers in the app.
  const changeSetStore = TestBed.inject(ChangeSetStore);
  changeSetStore.handleMessage({
    type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
    payload: { changeSet },
  });
  // Seed the REAL DisplayDockState with the host-built summary of the turn,
  // exactly as the transcript publishes it to the dock (R6.7).
  const model = buildTurnSummaryModel(
    buildTurnSourceSnapshot({
      turnMessages: messages,
      blockMessage: assistant,
      changeSet,
      finalized: true,
    }),
  );
  if (model === null) throw new Error('the seeded turn has no summary');
  TestBed.inject(DisplayDockState).setSummaries(
    TAB_ID,
    new Map([[SUMMARY_TURN_KEY, { model, changeSet }]]),
  );
  return {
    changeSet,
    changeSetStore,
    assistant,
    messages,
    storedMessages: () => tabs()[0].messages,
    agentsInput: () => agentsInputFrom(TestBed.inject(AgentMonitorStore)),
    limitsInput: async () => {
      const result = (await TestBed.inject(ClaudeRpcService).call(
        'agent:getLanePlanLimits',
        {},
      )) as unknown as { data: typeof LIMITS_RESULT };
      return { kind: 'available', ...result.data };
    },
    send: async () => {
      const outcome =
        await TestBed.inject(MessageSenderService).send('follow up');
      return {
        outcome,
        params: continueParams[0] as Record<string, unknown> | undefined,
      };
    },
  };
}

describe('MessageSenderService host data boundary', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('keeps host-built recap data out of the serialized chat:continue request', async () => {
    const { changeSet, changeSetStore, assistant, messages, send } =
      setupSeededSender();

    // Positive control — the sentinel change set really is readable from the
    // injected ChangeSetStore (seeded through its public push path), so the
    // data the boundary must hold back is present, not hypothetical.
    expect(changeSetStore.changeSetsFor(SESSION_ID)).toEqual([changeSet]);

    // Positive control — the transcript the sender reads carries the
    // sentinel usage and the sentinel test run.
    expect(assistant.cost).toBe(SENTINEL_COST);
    expect(assistant.tokens?.input).toBe(SENTINEL_TOKENS);
    expect(
      anchorTurnTests(messages, messages.length).get(assistant.id)?.runs[0]
        ?.command,
    ).toContain(SENTINEL_LABEL);

    const storedContent = assistant.streamingState?.content;
    const { outcome, params } = await send();
    expect(outcome.success).toBe(true);
    expectNoSentinels(params);

    // The send must not have mutated the transcript it read either.
    expect(assistant.streamingState?.content).toBe(storedContent);
  });

  it('fails the boundary assertion when a sentinel does leak (negative control)', async () => {
    const { send } = setupSeededSender();
    const { params } = await send();
    expect(params).toBeDefined();

    // Push a sentinel into the captured params the way a real leak would
    // surface it (a recap file in the follow-up file list), then prove the
    // helper throws — otherwise the boundary test above would pass vacuously.
    const files = params?.['files'];
    if (!Array.isArray(files)) {
      throw new Error('chat:continue params carry no files array to poison');
    }
    files.push(SENTINEL_PATH);
    expect(() => expectNoSentinels(params)).toThrow();
  });

  it('renders fence bindings from host sources without writing resolved values back to the model', async () => {
    const { changeSet, assistant, messages, send } = setupSeededSender();
    const snapshot = buildTurnSourceSnapshot({
      turnMessages: messages,
      blockMessage: assistant,
      changeSet,
      finalized: true,
    });
    const rendered = renderPtahUiBlock(PTAH_UI_FENCE_BODY, {
      surfaceId: 'host-data-boundary',
      snapshot,
      countBytes: (value) =>
        new TextEncoder().encode(JSON.stringify(value)).length,
    });
    if (!rendered.ok) throw new Error(rendered.reason);

    // Positive control: the real render pipeline resolves every seeded host
    // source for display, so a later absence from params is meaningful.
    const resolvedContent = JSON.stringify(rendered.content);
    expect(resolvedContent).toContain(SENTINEL_PATH);
    expect(resolvedContent).toContain('$0.61');
    expect(resolvedContent).toContain(SENTINEL_LABEL);

    const { outcome, params } = await send();
    expect(outcome.success).toBe(true);
    expectNoSentinels(params);
    expect(assistant.streamingState?.content).toBe(ASSISTANT_TEXT);
    expect(assistant.streamingState?.content).toContain('$diff.files');
  });

  it('keeps $agents names and costs and $limits lanes and used values out of params and stored text (R5.8, R10.5)', async () => {
    const { agentsInput, limitsInput, storedMessages, send } =
      setupSeededSender();
    const rendered = renderPtahUiBlock(DISPLAY_FENCE_BODY, {
      surfaceId: 'agent-usage',
      snapshot: null,
      agents: agentsInput(),
      limits: await limitsInput(),
      countBytes: (value) =>
        new TextEncoder().encode(JSON.stringify(value)).length,
    });
    if (!rendered.ok) throw new Error(rendered.reason);

    // Positive control: the real render pipeline resolves the sentinel agent
    // name and cost from the injected store, and the sentinel lane and used
    // value from the injected RPC, so their absence below is meaningful.
    const resolvedContent = JSON.stringify(rendered.content);
    expect(resolvedContent).toContain(AGENT_SENTINEL_NAME);
    expect(resolvedContent).toContain('$0.62');
    expect(resolvedContent).toContain(LIMITS_SENTINEL_LANE);
    expect(resolvedContent).toContain(LIMITS_SENTINEL_USED);

    const { outcome, params } = await send();
    expect(outcome.success).toBe(true);
    expectNoSentinels(params);

    // Stored message text keeps the references the model wrote, never values.
    const stored = JSON.stringify(storedMessages());
    expect(stored).toContain('$agents.cost');
    expect(stored).toContain('table $limits');
    for (const sentinel of SENTINELS_623) {
      expect(stored).not.toContain(sentinel);
    }
  });

  it('keeps the host-built turn summary out of the serialized chat:continue request (R6.7)', async () => {
    const { send } = setupSeededSender();

    // Positive control: the REAL dock store holds the summary of the seeded
    // turn, carrying the sentinel file and test run.
    const summary = TestBed.inject(DisplayDockState).summaryFor(TAB_ID);
    expect(summary).not.toBeNull();
    const summaryText = JSON.stringify(summary?.model);
    expect(summaryText).toContain(SENTINEL_PATH);
    expect(summaryText).toContain(SENTINEL_LABEL);

    const { outcome, params } = await send();
    expect(outcome.success).toBe(true);
    expectNoSentinels(params);
  });
});
