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
import { SessionManager, StreamingHandlerService } from '@ptah-extension/chat-streaming';
import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type TurnChangeSet,
} from '@ptah-extension/shared';
import type { TabState } from '@ptah-extension/chat-types';
import { anchorTurnTests } from '../components/organisms/transcript/transcript-turns';
import { MessageValidationService } from './message-validation.service';
import { MessageSenderService } from './message-sender.service';

const SENTINELS = [
  'zz_sentinel_610.ts',
  '0.610610',
  '610610',
  'A5_SENTINEL_TEST_LABEL',
] as const;

describe('MessageSenderService host data boundary', () => {
  it('keeps host-built recap data out of the serialized chat:continue request', async () => {
    const assistantText = [
      'All tests passed and 3 files changed.',
      '```ptah-ui',
      '{"$diff":"$diff","$tests":"$tests","$usage":"$usage"}',
      '```',
    ].join('\n');
    const changeSet: TurnChangeSet = {
      sessionId: 'sess-host-data', workspaceRoot: 'D:/repo', turnStartedAt: 1,
      turnEndedAt: 2, files: [{ path: SENTINELS[0], status: 'M', additions: 1, deletions: 0 }],
      truncatedCount: 0, totals: { files: 1, additions: 1, deletions: 0 }, countsUnavailable: false,
    };
    // This mirrors ChangeSetStore's session-keyed host-only state; it is deliberately
    // not an input to the sender or transcript text.
    const changeSetStore = new Map<string, readonly TurnChangeSet[]>([[changeSet.sessionId, [changeSet]]]);
    const assistant = createExecutionChatMessage({
      id: 'assistant-host-data', role: 'assistant', rawContent: assistantText,
      cost: Number(SENTINELS[1]), duration: Number(SENTINELS[2]),
      tokens: { inputTokens: Number(SENTINELS[2]), outputTokens: 1 },
      streamingState: createExecutionNode({ id: 'root-host-data', type: 'message', status: 'complete', content: assistantText,
        children: [createExecutionNode({ id: 'bash-host-data', type: 'tool', status: 'complete', content: null, toolName: 'Bash',
          toolInput: { command: `npx jest --label ${SENTINELS[3]}` }, toolOutput: { output: 'passed', exitCode: 0 } })] }),
    });
    const messages: ExecutionChatMessage[] = [
      createExecutionChatMessage({ id: 'user-host-data', role: 'user', rawContent: 'start' }), assistant,
    ];
    const storedContent = assistant.streamingState?.content;
    expect(changeSetStore.get(changeSet.sessionId)).toEqual([changeSet]);
    expect(anchorTurnTests(messages, messages.length).get(assistant.id)?.runs[0]?.command).toContain(SENTINELS[3]);
    expect(assistant.streamingState?.content).toBe(storedContent);
    expect(storedContent).toBe(assistantText);

    const tabs = signal<TabState[]>([{ id: 'tab-host-data', title: 'Host data', name: 'Host data', status: 'loaded',
      messages, streamingState: null, currentMessageId: null, claudeSessionId: changeSet.sessionId, titleOrigin: 'default' } as TabState]);
    const rpcCall = jest.fn((method: string) => Promise.resolve(
      method === 'session:validate' ? { success: true, data: { exists: true } } : { success: true },
    ));
    const patchTab = (id: string, patch: Partial<TabState>) => tabs.update(values => values.map(tab => tab.id === id ? ({ ...tab, ...patch } as TabState) : tab));
    const tabManager = {
      tabs: computed(() => tabs()), activeTabId: computed(() => 'tab-host-data'), activeTab: computed(() => tabs()[0]),
      createAbortController: jest.fn(() => new AbortController().signal), getAbortSignal: jest.fn(),
      findTabByIdAcrossWorkspaces: jest.fn(() => ({ tab: tabs()[0], workspacePath: 'D:/repo' })),
      markResuming: jest.fn((id: string) => patchTab(id, { status: 'resuming' })), markStreaming: jest.fn(), markTabStreaming: jest.fn(),
      setMessages: jest.fn((id: string, next: ExecutionChatMessage[]) => patchTab(id, { messages: next })),
      markLoaded: jest.fn(), markTabIdle: jest.fn(), detachSessionAndMarkLoaded: jest.fn(),
    };
    TestBed.configureTestingModule({ providers: [
      MessageSenderService, { provide: TabManagerService, useValue: tabManager },
      { provide: SessionManager, useValue: { setStatus: jest.fn() } },
      { provide: StreamingHandlerService, useValue: { recordUserPromptBoundary: jest.fn(), removeUserPromptBoundary: jest.fn() } },
      { provide: MessageValidationService, useValue: { validate: jest.fn(() => ({ valid: true })), sanitize: jest.fn((text: string) => text) } },
      { provide: ClaudeRpcService, useValue: { call: rpcCall } }, { provide: VSCodeService, useValue: { config: jest.fn(() => ({ workspaceRoot: 'D:/repo' })) } },
      { provide: ModelStateService, useValue: { currentModel: jest.fn(() => 'claude-sonnet-4'), availableModels: jest.fn(() => []) } },
      { provide: EffortStateService, useValue: { currentEffort: jest.fn(() => 'medium') } },
      { provide: PtahCliStateService, useValue: { selectedAgentId: jest.fn(() => null) } },
      { provide: AuthStateService, useValue: { flagAuthRequired: jest.fn() } },
    ] });
    await TestBed.inject(MessageSenderService).send('follow up');
    const params = rpcCall.mock.calls.find(([method]) => method === 'chat:continue')?.[1];
    const serialized = JSON.stringify(params);
    expect(params).toBeDefined();
    for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel);
    TestBed.resetTestingModule();
  });
});
