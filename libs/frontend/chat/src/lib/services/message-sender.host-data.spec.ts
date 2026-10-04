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
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import {
  MESSAGE_TYPES,
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type TurnChangeSet,
} from '@ptah-extension/shared';
import type { TabState } from '@ptah-extension/chat-types';
import { anchorTurnTests } from '../components/organisms/transcript/transcript-turns';
import { ChangeSetStore } from './change-set/change-set.store';
import { MessageValidationService } from './message-validation.service';
import {
  MessageSenderService,
  type SendOutcome,
} from './message-sender.service';

const SESSION_ID = 'sess-host-data';
const TAB_ID = 'tab-host-data';
const WORKSPACE_ROOT = 'D:/repo';

const SENTINEL_PATH = 'zz_sentinel_610.ts';
const SENTINEL_COST = 0.610610;
const SENTINEL_TOKENS = 610610;
const SENTINEL_LABEL = 'A5_SENTINEL_TEST_LABEL';

/**
 * Every string that must not appear in a serialized `chat:continue` request.
 * The cost is listed stringified because `JSON.stringify` drops the trailing
 * zero (`0.610610` serializes as `0.61061`), and the stringified form is
 * what a leak would surface.
 */
const SENTINELS: readonly string[] = [
  SENTINEL_PATH,
  `${SENTINEL_COST}`,
  `${SENTINEL_TOKENS}`,
  SENTINEL_LABEL,
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
  /** Sends the follow-up turn; resolves the outcome and captured params. */
  readonly send: () => Promise<{
    outcome: SendOutcome;
    params: Record<string, unknown> | undefined;
  }>;
}

/**
 * The sender's real dependency set with the sentinel recap data in the
 * services the app uses. Every collaborator the sender actually injects is
 * stubbed at its transport boundary — `ClaudeRpcService.call` captures the
 * serialized request — except `ChangeSetStore`, which is the REAL store and
 * is seeded through its public push path before the send.
 */
function setupSeededSender(): SeededSender {
  const assistantText = [
    'All tests passed and 3 files changed.',
    '```ptah-ui',
    '{"$diff":"$diff","$tests":"$tests","$usage":"$usage"}',
    '```',
  ].join('\n');
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
    rawContent: assistantText,
    cost: SENTINEL_COST,
    duration: SENTINEL_TOKENS,
    tokens: { input: SENTINEL_TOKENS, output: 1 },
    streamingState: createExecutionNode({
      id: 'root-host-data',
      type: 'message',
      status: 'complete',
      content: assistantText,
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
      return Promise.resolve(
        method === 'session:validate'
          ? { success: true, data: { exists: true } }
          : { success: true },
      );
    },
  );
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
    markResuming: jest.fn((id: string) =>
      patchTab(id, { status: 'resuming' }),
    ),
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
  return {
    changeSet,
    changeSetStore,
    assistant,
    messages,
    send: async () => {
      const outcome = await TestBed.inject(MessageSenderService).send(
        'follow up',
      );
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
    const files = params?.files;
    if (!Array.isArray(files)) {
      throw new Error('chat:continue params carry no files array to poison');
    }
    files.push(SENTINEL_PATH);
    expect(() => expectNoSentinels(params)).toThrow();
  });
});
