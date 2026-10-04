import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  signal,
  type ComponentFixture,
  type DebugElement,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }

  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}

  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

// The C2a snapshot cases run the real `ChangeSetStore` end to end; only the
// RPC transport is stood down, exactly as `change-set.store.spec.ts` does (the
// persisted load answers "none", so the late `git:turnChangeSet` push is the
// only way a change set can appear).
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return { ...actual, rpcCall: (...args: unknown[]) => mockRpcCall(...args) };
});

import { TestBed, DeferBlockBehavior } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PtahUiLiveWindow } from '@ptah-extension/chat-ui';
import { PtahUiBlockComponent } from '@ptah-extension/chat-ui/ptah-ui';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import {
  createExecutionChatMessage,
  MESSAGE_TYPES,
} from '@ptah-extension/shared';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  TurnChangeSet,
  TurnSourceSnapshot,
} from '@ptah-extension/shared';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';
import { ChangeSetStore } from '../../../services/change-set/change-set.store';
import { ChatStore } from '../../../services/chat.store';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import { ChatTranscriptComponent } from './chat-transcript.component';
import {
  configureTranscriptTestBed,
  makeTranscriptMessage,
  TranscriptEmptyStateStub,
  TranscriptMessageBubbleStub,
} from './testing/transcript-spec-harness';

/**
 * Finalized assistant message tree (the stored shape the replayer rebuilds):
 * `children` present, mirroring the change-set spec's `assistantTree` — the
 * tests-row grouping walks `node.children`.
 */
function assistantTree(id: string, startTime: number): ExecutionNode {
  return {
    id,
    type: 'message',
    status: 'complete',
    content: 'assistant reply',
    children: [],
    startTime,
  } as unknown as ExecutionNode;
}

// Ascending by transcript order key: a1's 105 comes from its streaming
// tree's startTime, not the message's own timestamp (5_000) — the stable
// streaming clock `transcriptOrderKey` ranks by.
const MESSAGES: readonly ExecutionChatMessage[] = [
  makeTranscriptMessage('u1', 'user', 100),
  makeTranscriptMessage('a1', 'assistant', 5_000, assistantTree('a1-tree', 105)),
  makeTranscriptMessage('u2', 'user', 200),
  makeTranscriptMessage('a2', 'assistant', 210),
];

const TAB_2_MESSAGES: readonly ExecutionChatMessage[] = [
  makeTranscriptMessage('t2-u1', 'user', 300),
  makeTranscriptMessage('t2-a1', 'assistant', 310),
];

/**
 * TASK_2026_610 B7 — the transcript owns one `PtahUiLiveWindow` per tab
 * (component `providers`, decision 10) and ranks each bubble's `ptah-ui`
 * blocks by transcript order (`ptahUiOrderKey`, component 4 PR B).
 */
describe('ChatTranscriptComponent ptah-ui live window', () => {
  afterEach(() => TestBed.resetTestingModule());

  interface RenderOptions {
    /** Host gate; the harness default is Electron (`true`). */
    readonly isElectron?: boolean;
  }

  /** Creates one more transcript from the already-configured TestBed. */
  async function renderTab(
    tabId: string,
  ): Promise<ComponentFixture<ChatTranscriptComponent>> {
    const fixture = TestBed.createComponent(ChatTranscriptComponent);
    fixture.componentRef.setInput('tabId', tabId);
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function render(
    options: RenderOptions = {},
  ): Promise<ComponentFixture<ChatTranscriptComponent>> {
    configureTranscriptTestBed({
      tabs: signal([
        {
          id: 'tab-1',
          claudeSessionId: 'session-1',
          status: 'loaded',
          messages: MESSAGES,
          streamingState: null,
        },
        {
          id: 'tab-2',
          claudeSessionId: 'session-2',
          status: 'loaded',
          messages: TAB_2_MESSAGES,
          streamingState: null,
        },
      ]),
      buildTree: jest.fn(() => []),
    });
    if (options.isElectron === false) {
      TestBed.overrideProvider(VSCodeService, {
        useValue: {
          getPtahIconUri: () => 'ptah.svg',
          isElectron: false,
        } as unknown as VSCodeService,
      });
    }
    return renderTab('tab-1');
  }

  function bubbleNodes(
    fixture: ComponentFixture<ChatTranscriptComponent>,
  ): DebugElement[] {
    return fixture.debugElement.queryAll(
      (node) => node.componentInstance instanceof TranscriptMessageBubbleStub,
    );
  }

  it('provides exactly one PtahUiLiveWindow per transcript, shared by every bubble', async () => {
    const fixture = await render();
    const nodes = bubbleNodes(fixture);
    expect(nodes.length).toBe(MESSAGES.length);

    // Not a root/global provider: only the transcript's own injector has it.
    expect(() => TestBed.inject(PtahUiLiveWindow)).toThrow();

    // One instance per transcript: the transcript injector and every bubble
    // injector under it resolve the same window.
    const window = fixture.debugElement.injector.get(PtahUiLiveWindow);
    for (const node of nodes) {
      expect(node.injector.get(PtahUiLiveWindow)).toBe(window);
    }
  });

  it('gives two transcripts (two tabs) two different PtahUiLiveWindow instances', async () => {
    const fixture1 = await render();
    const fixture2 = await renderTab('tab-2');

    const window1 = fixture1.debugElement.injector.get(PtahUiLiveWindow);
    const window2 = fixture2.debugElement.injector.get(PtahUiLiveWindow);
    expect(window1).not.toBe(window2);

    // Each transcript's bubbles resolve their OWN transcript's window, so a
    // tab's live cap never counts another tab's blocks.
    const nodes1 = bubbleNodes(fixture1);
    const nodes2 = bubbleNodes(fixture2);
    expect(nodes1.length).toBe(MESSAGES.length);
    expect(nodes2.length).toBe(TAB_2_MESSAGES.length);
    for (const node of nodes1) {
      expect(node.injector.get(PtahUiLiveWindow)).toBe(window1);
    }
    for (const node of nodes2) {
      expect(node.injector.get(PtahUiLiveWindow)).toBe(window2);
    }
  });

  it('feeds each bubble its transcript order key, growing with transcript order', async () => {
    const fixture = await render();
    // Keys follow transcript order (u1 < a1 < u2 < a2) and a1 ranks by its
    // streaming tree's startTime (105), not its own timestamp (5_000), so a
    // streaming bubble keeps one stable key.
    const keys = bubbleNodes(fixture).map(
      (node) => (node.componentInstance as TranscriptMessageBubbleStub)
        .ptahUiOrderKey,
    );
    expect(keys).toEqual([100, 105, 200, 210]);
  });

  it('keeps the bubble default order key on VS Code (nothing is computed there)', async () => {
    const fixture = await render({ isElectron: false });
    // Electron-only scope: no map is computed and every bubble keeps the `0`
    // default, which the VS Code (always null) ptah-ui context never reads.
    const keys = bubbleNodes(fixture).map(
      (node) => (node.componentInstance as TranscriptMessageBubbleStub)
        .ptahUiOrderKey,
    );
    expect(keys).toEqual([0, 0, 0, 0]);
  });
});

/**
 * TASK_2026_610 C2a — the transcript computes each turn's
 * `TurnSourceSnapshot` (Req 3.1-3.8) and feeds every assistant message of the
 * turn the same value, so a block's `$diff`/`$tests`/`$usage` bindings resolve
 * to real host data on Electron and to nothing on VS Code.
 */
describe('ChatTranscriptComponent ptah-ui source snapshots', () => {
  afterEach(() => TestBed.resetTestingModule());

  const CHANGE_SET: TurnChangeSet = {
    sessionId: 'session-1',
    workspaceRoot: '/repo',
    turnStartedAt: 105,
    turnEndedAt: 150,
    files: [
      { path: 'src/a.ts', status: 'M', additions: 3, deletions: 1 },
      { path: 'src/b.ts', status: 'A', additions: 10, deletions: 0 },
    ],
    truncatedCount: 0,
    totals: { files: 2, additions: 13, deletions: 1 },
    countsUnavailable: false,
  };

  /**
   * Stored/finalized tree shape the replayer rebuilds (A-1/A-4, as A4's
   * change-set spec): root `message` node whose `startTime` is the stable
   * clock `transcriptOrderKey` ranks by.
   */
  function messageTree(
    id: string,
    startTime: number,
    children: readonly ExecutionNode[] = [],
  ): ExecutionNode {
    return {
      id,
      type: 'message',
      status: 'complete',
      content: null,
      isCollapsed: false,
      children,
      startTime,
    } as unknown as ExecutionNode;
  }

  function textNode(id: string, content: string): ExecutionNode {
    return {
      id,
      type: 'text',
      status: 'complete',
      content,
      isCollapsed: false,
      children: [],
    } as unknown as ExecutionNode;
  }

  function bashNode(
    id: string,
    command: string,
    outcome: 'passed' | 'failed',
  ): ExecutionNode {
    return {
      id,
      type: 'tool',
      toolName: 'Bash',
      toolInput: { command },
      status: outcome === 'passed' ? 'complete' : 'error',
      isError: outcome === 'passed' ? false : true,
      content: '',
      isCollapsed: false,
      children: [],
    } as unknown as ExecutionNode;
  }

  function assistantMessage(
    id: string,
    tree: ExecutionNode,
    extra: Record<string, unknown> = {},
  ): ExecutionChatMessage {
    return {
      id,
      role: 'assistant',
      rawContent: 'assistant reply',
      timestamp: 0,
      streamingState: tree,
      ...extra,
    } as unknown as ExecutionChatMessage;
  }

  interface SnapshotRenderOptions {
    readonly messages: readonly ExecutionChatMessage[];
    /** Store stand-in's change sets (the persisted load for the session). */
    readonly changeSets?: readonly TurnChangeSet[];
    /** Host gate; the harness default is Electron (`true`). */
    readonly isElectron?: boolean;
  }

  async function render(
    options: SnapshotRenderOptions,
  ): Promise<ComponentFixture<ChatTranscriptComponent>> {
    configureTranscriptTestBed({
      tabs: signal([
        {
          id: 'tab-1',
          claudeSessionId: 'session-1',
          status: 'loaded',
          messages: options.messages,
          streamingState: null,
        },
      ]),
      buildTree: jest.fn(() => []),
      changeSets: signal(options.changeSets ?? []),
    });
    if (options.isElectron === false) {
      TestBed.overrideProvider(VSCodeService, {
        useValue: {
          getPtahIconUri: () => 'ptah.svg',
          isElectron: false,
        } as unknown as VSCodeService,
      });
    }
    const fixture = TestBed.createComponent(ChatTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** The snapshot the transcript passed each bubble, by message id. */
  function snapshotsByMessageId(
    fixture: ComponentFixture<ChatTranscriptComponent>,
  ): Map<string, TurnSourceSnapshot | null | undefined> {
    const result = new Map<string, TurnSourceSnapshot | null | undefined>();
    for (const node of fixture.debugElement.queryAll(
      (candidate) => candidate.componentInstance instanceof TranscriptMessageBubbleStub,
    )) {
      const bubble = node.componentInstance as TranscriptMessageBubbleStub & {
        ptahUiSnapshot?: TurnSourceSnapshot | null;
      };
      result.set(bubble.message.id, bubble.ptahUiSnapshot);
    }
    return result;
  }

  it("reflects the turn's Bash runs in the tests source of the turn's snapshot", async () => {
    const fixture = await render({
      messages: [
        makeTranscriptMessage('u1', 'user', 100),
        assistantMessage(
          'a1',
          messageTree('a1-tree', 110, [
            bashNode('a1-jest', 'npx jest libs/frontend/chat', 'passed'),
            bashNode('a1-npm', 'npm test', 'failed'),
          ]),
        ),
      ],
    });

    const snapshots = snapshotsByMessageId(fixture);
    expect(snapshots.get('u1')).toBe(null);
    expect(snapshots.get('a1')?.tests).toEqual({
      kind: 'available',
      runs: [
        { command: 'npx jest libs/frontend/chat', outcome: 'passed' },
        { command: 'npm test', outcome: 'failed' },
      ],
      summary: { total: 2, passed: 1, failed: 1, unknown: 0 },
    });
  });

  it("binds $usage to the turn-ending message's tokens and cost, one snapshot per turn", async () => {
    const fixture = await render({
      messages: [
        makeTranscriptMessage('u1', 'user', 100),
        // Mid-turn assistant message with no tokens of its own.
        assistantMessage('a1', messageTree('a1-tree', 110)),
        assistantMessage('a2', messageTree('a2-tree', 120), {
          tokens: { input: 11, output: 7 },
          cost: 0.031,
          duration: 4100,
        }),
      ],
    });

    const snapshots = snapshotsByMessageId(fixture);
    const midTurn = snapshots.get('a1');
    const endTurn = snapshots.get('a2');
    // Every assistant message of the turn gets the turn's ONE snapshot, and
    // its usage is the turn-ENDING message's, not the block's own message's.
    expect(midTurn).toBe(endTurn);
    expect(endTurn?.usage).toEqual({
      kind: 'available',
      input: 11,
      output: 7,
      cost: 0.031,
      durationMs: 4100,
    });
    expect(midTurn?.usage).toEqual({
      kind: 'available',
      input: 11,
      output: 7,
      cost: 0.031,
      durationMs: 4100,
    });
  });

  it('resolves the persisted change set of a reloaded session', async () => {
    // Session-loader fixture, as A4's change-set spec: after a reload the
    // replayer rebuilds the stored trees, whose Bash nodes keep
    // `toolInput.command` and a terminal status, and the harness's changeSets
    // stand-in is the persisted load the store returns for the session.
    const fixture = await render({
      messages: [
        makeTranscriptMessage('u1', 'user', 100),
        assistantMessage(
          'a1',
          messageTree('a1-tree', 110, [
            bashNode('a1-jest', 'npx jest libs/frontend/chat', 'passed'),
          ]),
        ),
      ],
      changeSets: [CHANGE_SET],
    });

    const snapshot = snapshotsByMessageId(fixture).get('a1');
    expect(snapshot?.diff).toEqual({
      kind: 'available',
      changeSet: CHANGE_SET,
    });
  });

  it('passes no snapshot when the host is not Electron', async () => {
    const fixture = await render({
      messages: [
        makeTranscriptMessage('u1', 'user', 100),
        assistantMessage('a1', messageTree('a1-tree', 110)),
      ],
      // Data present: the gate is the host, not the data — the map is
      // Electron-only, so no bubble is passed a snapshot.
      changeSets: [CHANGE_SET],
      isElectron: false,
    });

    const snapshots = snapshotsByMessageId(fixture);
    expect([...snapshots.keys()]).toEqual(['u1', 'a1']);
    for (const snapshot of snapshots.values()) {
      expect(snapshot).toBe(null);
    }
  });

  // --- End to end through the real store, bubble and block (A-6 late push) ---

  const FENCE = '```ptah-ui\ntitle Diff\nstats\n  Files | $diff.files\n```\n';

  /**
   * Real bubble (and so real execution node, `ptah-ui` host and block) plus
   * the REAL root-provided `ChangeSetStore`; only the RPC transport and the
   * empty state are stood down. The tab's session is the active one, so the
   * store accepts its late push.
   */
  function configureRealChain(): void {
    TestBed.configureTestingModule({
      imports: [ChatTranscriptComponent],
      providers: [
        provideMarkdownRendering({ extensions: 'full' }),
        provideSurfaceActiveTesting(),
        {
          provide: VSCodeService,
          useValue: {
            getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
            getPtahUserIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
            isElectron: true,
          } as unknown as VSCodeService,
        },
        {
          provide: ChatStore,
          useValue: {
            getPermissionForTool: () => null,
            handlePermissionResponse: jest.fn(),
          } as unknown as ChatStore,
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([
              {
                id: 'tab-1',
                claudeSessionId: 'session-1',
                status: 'loaded',
                messages: [
                  makeTranscriptMessage('u1', 'user', 100),
                  createExecutionChatMessage({
                    id: 'a1',
                    role: 'assistant',
                    rawContent: FENCE,
                    streamingState: messageTree('a1-tree', 110, [
                      textNode('a1-text', FENCE),
                    ]),
                  }),
                ],
                streamingState: null,
              },
            ]),
            activeTabSessionId: () => 'session-1',
          } as unknown as TabManagerService,
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: {
            buildTree: () => [],
          } as unknown as ExecutionTreeBuilderService,
        },
        { provide: SESSION_CONTEXT, useValue: null },
        {
          provide: ChangeSetActionsService,
          useValue: {
            review: jest.fn(() => Promise.resolve()),
            openFile: jest.fn(() => Promise.resolve()),
            openScm: jest.fn(() => Promise.resolve()),
          } as unknown as ChangeSetActionsService,
        },
      ],
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
    });
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: { imports: [ChatEmptyStateComponent] },
      add: { imports: [TranscriptEmptyStateStub] },
    });
  }

  /** Two settle rounds: the deferred host mounts, then its parts render. */
  async function settleRealChain(
    fixture: ComponentFixture<ChatTranscriptComponent>,
  ): Promise<void> {
    for (let round = 0; round < 2; round += 1) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  }

  it('updates the block in place when the late git:turnChangeSet push lands', async () => {
    mockRpcCall.mockResolvedValue({ success: true, data: { changeSets: [] } });
    configureRealChain();
    const fixture = TestBed.createComponent(ChatTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('active', true);
    await settleRealChain(fixture);

    const blockElement = fixture.debugElement.query(
      By.directive(PtahUiBlockComponent),
    );
    expect(blockElement).not.toBeNull();
    const block = blockElement?.componentInstance as PtahUiBlockComponent;
    // The newest finalized turn, no covering change set yet: $diff pending.
    expect(fixture.nativeElement.textContent).toContain('pending');

    TestBed.inject(ChangeSetStore).handleMessage({
      type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
      payload: { changeSet: CHANGE_SET },
    });
    await settleRealChain(fixture);

    // Same block instance (Req 3.2, in place), now showing the real count.
    const after = fixture.debugElement.query(By.directive(PtahUiBlockComponent));
    expect(after?.componentInstance).toBe(block);
    const text = fixture.nativeElement.textContent ?? '';
    expect(text).not.toContain('pending');
    expect(text).toContain('2');
  });
});
