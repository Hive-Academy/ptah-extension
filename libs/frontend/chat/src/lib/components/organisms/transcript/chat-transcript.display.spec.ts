import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  input,
  signal,
  type Provider,
  type WritableSignal,
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

// The R10.9 case renders the real bubble chain; only the RPC transport is
// stood down, as in `chat-transcript.ptah-ui.spec.ts`.
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return { ...actual, rpcCall: (...args: unknown[]) => mockRpcCall(...args) };
});

import {
  DeferBlockBehavior,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  PTAH_UI_DISPLAY_DOCK_SYNC,
  PTAH_UI_HOST_SOURCES,
  displayFenceKey,
} from '@ptah-extension/chat-ui';
import {
  DisplaySurfaceSyncComponent,
  type DisplayCandidate,
  type DisplayTurnSnapshots,
} from '@ptah-extension/chat-ui/display-panel';
import { buildTurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
  type TurnChangeSet,
} from '@ptah-extension/shared';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';
import { ChatStore } from '../../../services/chat.store';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { StreamPresentationStore } from '../../../services/stream-presentation-store.service';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import { ChatTranscriptComponent } from './chat-transcript.component';
import {
  configureTranscriptTestBed,
  makeTranscriptMessage,
  TranscriptEmptyStateStub,
} from './testing/transcript-spec-harness';
import {
  cachedTurnRecapLoader,
  TRANSCRIPT_TURN_RECAP_LOADER,
  type TranscriptTurnRecap,
  type TranscriptTurnRecapLoader,
} from './transcript-turn-recap-loader';

const TAB = 'tab-1';
const RECAP: TranscriptTurnRecap = { buildTurnSummaryModel };

// --- Fixtures ---------------------------------------------------------------

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

function bashNode(id: string, command: string): ExecutionNode {
  return {
    id,
    type: 'tool',
    toolName: 'Bash',
    toolInput: { command },
    status: 'complete',
    isError: false,
    content: '',
    isCollapsed: false,
    children: [],
  } as unknown as ExecutionNode;
}

/** A Task tool with its foreground agent node, the shape the tree builder emits. */
function taskWithAgent(toolCallId: string): ExecutionNode {
  return createExecutionNode({
    id: `tool-${toolCallId}`,
    type: 'tool',
    status: 'complete',
    toolName: 'Task',
    toolCallId,
    children: [
      createExecutionNode({
        id: `agent-${toolCallId}`,
        type: 'agent',
        status: 'complete',
        toolCallId,
      }),
    ],
  });
}

function assistant(
  id: string,
  startTime: number,
  children: readonly ExecutionNode[] = [],
): ExecutionChatMessage {
  return makeTranscriptMessage(
    id,
    'assistant',
    startTime,
    messageTree(`${id}-tree`, startTime, children),
  );
}

function changeSet(turnStartedAt: number, turnEndedAt: number): TurnChangeSet {
  return {
    sessionId: 'session-1',
    workspaceRoot: '/repo',
    turnStartedAt,
    turnEndedAt,
    files: [
      { path: 'src/a.ts', status: 'M', additions: 3, deletions: 1 },
      { path: 'src/b.ts', status: 'A', additions: 10, deletions: 0 },
    ],
    truncatedCount: 0,
    totals: { files: 2, additions: 13, deletions: 1 },
    countsUnavailable: false,
  };
}

/** Turn 1 changed two files and ran a test command; turn 2 did neither. */
const TURN_1_CHANGE_SET = changeSet(105, 150);
const SUMMARY_MESSAGES: readonly ExecutionChatMessage[] = [
  makeTranscriptMessage('u1', 'user', 100),
  assistant('a1', 110, [bashNode('a1-jest', 'npx jest libs/frontend/chat')]),
  makeTranscriptMessage('u2', 'user', 200),
  makeTranscriptMessage('a2', 'assistant', 210),
];

function tab(
  id: string,
  messages: readonly ExecutionChatMessage[],
  status = 'loaded',
  streamingState: unknown = null,
): Record<string, unknown> {
  return {
    id,
    claudeSessionId: `session-${id}`,
    status,
    messages,
    streamingState,
    liveModelStats: null,
  };
}

/**
 * Stands in for the lazy sync where a case asserts only the candidates the
 * transcript hands it; the `$agents` case mounts the real one.
 */
@Component({
  selector: 'ptah-display-surface-sync',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class DisplaySurfaceSyncStub {
  readonly tabId = input.required<string>();
  readonly candidates = input.required<readonly DisplayCandidate[]>();
  readonly snapshots = input<DisplayTurnSnapshots>(new Map());
}

// --- Harness ----------------------------------------------------------------

interface RenderOptions {
  readonly tabs: WritableSignal<readonly Record<string, unknown>[]>;
  readonly isElectron?: boolean;
  /** Provide `DisplayDockState` (as ChatView does); default true. */
  readonly withDock?: boolean;
  readonly changeSets?: WritableSignal<readonly TurnChangeSet[]>;
  readonly settledThrough?: WritableSignal<number>;
  readonly buildTree?: (...args: never[]) => unknown;
  /** Replaces the root loader of the `turn-recap` entry. */
  readonly loader?: TranscriptTurnRecapLoader;
  /** Mount the real display sync instead of the stub. */
  readonly realSync?: boolean;
  readonly providers?: readonly Provider[];
}

function configure(options: RenderOptions): void {
  configureTranscriptTestBed({
    tabs: options.tabs,
    buildTree: options.buildTree ?? jest.fn(() => []),
    changeSets: options.changeSets,
    settledThrough: options.settledThrough,
  });
  const providers: Provider[] = [...(options.providers ?? [])];
  if (options.withDock !== false) {
    providers.push(DisplayDockState, {
      provide: PTAH_UI_DISPLAY_DOCK_SYNC,
      useExisting: DisplayDockState,
    });
  }
  if (options.loader) {
    providers.push({
      provide: TRANSCRIPT_TURN_RECAP_LOADER,
      useValue: options.loader,
    });
  }
  TestBed.configureTestingModule({
    providers,
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
  });
  if (options.isElectron === false) {
    TestBed.overrideProvider(VSCodeService, {
      useValue: {
        getPtahIconUri: () => 'ptah.svg',
        isElectron: false,
      } as unknown as VSCodeService,
    });
  }
  if (!options.realSync) {
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: { imports: [DisplaySurfaceSyncComponent] },
      add: { imports: [DisplaySurfaceSyncStub] },
    });
  }
}

function mount(tabId: string): ComponentFixture<ChatTranscriptComponent> {
  const fixture = TestBed.createComponent(ChatTranscriptComponent);
  fixture.componentRef.setInput('tabId', tabId);
  fixture.componentRef.setInput('active', true);
  return fixture;
}

/** Change detection, deferred chunks and loader promises, a few rounds. */
async function settle(
  ...fixtures: ComponentFixture<ChatTranscriptComponent>[]
): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    for (const fixture of fixtures) fixture.detectChanges();
    for (const fixture of fixtures) await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (const fixture of fixtures) fixture.detectChanges();
}

function query(
  fixture: ComponentFixture<ChatTranscriptComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function contentChildren(
  fixture: ComponentFixture<ChatTranscriptComponent>,
): string[] {
  const content: HTMLElement = fixture.nativeElement.querySelector(
    '.chat-scroll-content',
  );
  return Array.from(content.children).map(
    (child) =>
      child.getAttribute('data-ptah-transcript-message-id') ??
      child.getAttribute('data-testid') ??
      child.tagName,
  );
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

// --- Specs ------------------------------------------------------------------

describe('ChatTranscriptComponent display wiring (TASK_2026_623 Task 24.1)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    mockRpcCall.mockReset();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('turn summary chip (R6.5, R6.9, R6.10)', () => {
    it('Electron: replaces the change-set card and tests row with the chip at the turn end', async () => {
      // The ROOT loader: the real dynamic import of the turn-recap entry.
      configure({
        tabs: signal([tab(TAB, SUMMARY_MESSAGES)]),
        changeSets: signal([TURN_1_CHANGE_SET]),
      });
      const fixture = mount(TAB);
      await settle(fixture);

      expect(contentChildren(fixture)).toEqual([
        'u1',
        'a1',
        'chat-turn-summary',
        'u2',
        'a2',
      ]);
      expect(query(fixture, 'chat-change-set')).toBeNull();
      expect(query(fixture, 'chat-turn-tests')).toBeNull();
      const chip = query(fixture, 'turn-summary-chip');
      const text = chip?.textContent ?? '';
      expect(text).toContain('Turn summary');
      expect(text).toContain('2 files');
      // R6.10: the tests outcome rides on the chip.
      expect(text).toMatch(/1 test (passed|failed|unknown)/);
    });

    it('VS Code: keeps the card, with no chip, no tests row and no sync (R1.14)', async () => {
      const loader = jest.fn(() => Promise.resolve(RECAP));
      const display =
        '```ptah-ui display stats\ntitle Stats\nstats\n  Files | 2\n```\n';
      configure({
        tabs: signal([
          tab(TAB, [
            ...SUMMARY_MESSAGES,
            makeTranscriptMessage('u3', 'user', 300),
            assistant('a3', 310, [textNode('a3-text', display)]),
          ]),
        ]),
        changeSets: signal([TURN_1_CHANGE_SET]),
        isElectron: false,
        loader,
      });
      const dock = TestBed.inject(DisplayDockState);
      const setSummaries = jest.spyOn(dock, 'setSummaries');
      const setLiveTurn = jest.spyOn(dock, 'setLiveTurn');
      const fixture = mount(TAB);
      await settle(fixture);

      expect(query(fixture, 'chat-change-set')).not.toBeNull();
      expect(query(fixture, 'chat-turn-summary')).toBeNull();
      expect(query(fixture, 'chat-turn-tests')).toBeNull();
      expect(
        fixture.nativeElement.querySelector('ptah-display-surface-sync'),
      ).toBeNull();
      expect(loader).not.toHaveBeenCalled();
      expect(setSummaries).not.toHaveBeenCalled();
      expect(setLiveTurn).not.toHaveBeenCalled();
    });

    it('mounts no chip for a turn without files or tests and never loads the entry (R6.4)', async () => {
      const loader = jest.fn(() => Promise.resolve(RECAP));
      configure({
        tabs: signal([
          tab(TAB, [
            makeTranscriptMessage('u1', 'user', 100),
            assistant('a1', 110, [bashNode('a1-ls', 'ls -la')]),
          ]),
        ]),
        // Settled past the turn: no change set means none.
        settledThrough: signal(Number.POSITIVE_INFINITY),
        loader,
      });
      const fixture = mount(TAB);
      await settle(fixture);

      expect(query(fixture, 'chat-turn-summary')).toBeNull();
      expect(query(fixture, 'chat-change-set')).toBeNull();
      expect(loader).not.toHaveBeenCalled();
    });

    it('binds "Open in panel" to the dock and publishes the summaries in turn order', async () => {
      configure({
        tabs: signal([tab(TAB, SUMMARY_MESSAGES)]),
        changeSets: signal([TURN_1_CHANGE_SET]),
        loader: () => Promise.resolve(RECAP),
      });
      const dock = TestBed.inject(DisplayDockState);
      const fixture = mount(TAB);
      await settle(fixture);

      const summaries = dock.tab(TAB).summaries;
      expect([...summaries.keys()]).toEqual(['u1']);
      expect(summaries.get('u1')?.changeSet).toBe(TURN_1_CHANGE_SET);
      expect(summaries.get('u1')?.model.files?.value).toBe(2);

      const open = query(fixture, 'turn-summary-chip-open') as HTMLButtonElement;
      expect(open.disabled).toBe(false);
      expect(fixture.nativeElement.textContent).not.toContain(
        'Display panel unavailable',
      );
      open.click();
      await settle(fixture);

      const state = dock.tab(TAB);
      expect(state.open).toBe(true);
      expect(state.activeTab).toBe('displays');
      expect(state.summaryTurnKey).toBe('u1');
      expect(state.selection).toEqual({ kind: 'summary' });
      expect(dock.summaryFor(TAB)?.changeSet).toBe(TURN_1_CHANGE_SET);
    });

    it('shows "Display panel unavailable" without a dock (decision #67)', async () => {
      configure({
        tabs: signal([tab(TAB, SUMMARY_MESSAGES)]),
        changeSets: signal([TURN_1_CHANGE_SET]),
        loader: () => Promise.resolve(RECAP),
        withDock: false,
      });
      const fixture = mount(TAB);
      await settle(fixture);

      const open = query(fixture, 'turn-summary-chip-open') as HTMLButtonElement;
      expect(open).not.toBeNull();
      expect(open.disabled).toBe(true);
      expect(query(fixture, 'turn-summary-chip')?.textContent).toContain(
        'Display panel unavailable',
      );
      // Clicking a disabled control emits nothing and throws nothing.
      open.click();
      await settle(fixture);
    });
  });

  describe('lazy turn-recap load (decisions #101, #104)', () => {
    it('a rejected load leaves no chip and no summaries, and the next eligible update retries', async () => {
      const loader = jest
        .fn<Promise<TranscriptTurnRecap>, []>()
        .mockRejectedValueOnce(new Error('chunk load failed'))
        .mockResolvedValue(RECAP);
      const changeSets = signal<readonly TurnChangeSet[]>([TURN_1_CHANGE_SET]);
      configure({
        tabs: signal([
          tab(TAB, [
            ...SUMMARY_MESSAGES.slice(0, 3),
            assistant('a2', 210, [bashNode('a2-jest', 'npx jest libs/x')]),
          ]),
        ]),
        changeSets,
        loader,
      });
      const dock = TestBed.inject(DisplayDockState);
      const fixture = mount(TAB);
      await settle(fixture);

      expect(loader).toHaveBeenCalledTimes(1);
      expect(query(fixture, 'chat-turn-summary')).toBeNull();
      expect(dock.tab(TAB).summaries.size).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      // No retry loop: settling again makes no further attempt.
      await settle(fixture);
      expect(loader).toHaveBeenCalledTimes(1);

      // The next eligible update: turn 2's change set lands.
      changeSets.set([TURN_1_CHANGE_SET, changeSet(205, 250)]);
      await settle(fixture);

      expect(loader).toHaveBeenCalledTimes(2);
      expect([...dock.tab(TAB).summaries.keys()]).toEqual(['u1', 'u2']);
      expect(
        fixture.nativeElement.querySelectorAll(
          '[data-testid="chat-turn-summary"]',
        ),
      ).toHaveLength(2);
    });

    it('a destroyed transcript never publishes; a remount and another tab publish only their own turns', async () => {
      const load = deferred<TranscriptTurnRecap>();
      const loader = jest.fn(() => load.promise);
      const tabs = signal<readonly Record<string, unknown>[]>([
        tab(TAB, SUMMARY_MESSAGES),
        tab('tab-2', [
          makeTranscriptMessage('t2-u1', 'user', 100),
          assistant('t2-a1', 120, [bashNode('t2-jest', 'npx jest libs/y')]),
        ]),
      ]);
      configure({
        tabs,
        changeSets: signal([TURN_1_CHANGE_SET]),
        loader,
      });
      const dock = TestBed.inject(DisplayDockState);
      const setSummaries = jest.spyOn(dock, 'setSummaries');

      const first = mount(TAB);
      await settle(first);
      expect(loader).toHaveBeenCalledTimes(1);
      first.destroy();

      // The tab now holds a different turn; a fresh transcript mounts for it.
      tabs.update((current) => [
        tab(TAB, [
          makeTranscriptMessage('u9', 'user', 100),
          assistant('a9', 130, [bashNode('a9-jest', 'npx jest libs/z')]),
        ]),
        current[1],
      ]);
      const remounted = mount(TAB);
      const other = mount('tab-2');
      await settle(remounted, other);
      expect(setSummaries).not.toHaveBeenCalled();

      load.resolve(RECAP);
      await settle(remounted, other);

      const published = setSummaries.mock.calls.map(
        ([tabId, summaries]) => `${tabId}:${[...summaries.keys()].join(',')}`,
      );
      expect(published).toEqual(
        expect.arrayContaining(['tab-1:u9', 'tab-2:t2-u1']),
      );
      expect(published.every((entry) => !entry.includes(':u1'))).toBe(true);
      expect([...dock.tab(TAB).summaries.keys()]).toEqual(['u9']);
      expect([...dock.tab('tab-2').summaries.keys()]).toEqual(['t2-u1']);
    });

    it('the shared loader joins the attempt in flight and drops a rejected one', async () => {
      const load = jest
        .fn<Promise<TranscriptTurnRecap>, []>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(RECAP);
      const shared = cachedTurnRecapLoader(load);

      const first = shared();
      expect(shared()).toBe(first);
      await expect(first).rejects.toThrow('offline');
      expect(load).toHaveBeenCalledTimes(1);

      const second = shared();
      await expect(second).resolves.toBe(RECAP);
      expect(shared()).toBe(second);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe('live turn (decision #99)', () => {
    it('reports the last user message while the tab streams and clears it at the end', async () => {
      const messages = [
        makeTranscriptMessage('u1', 'user', 100),
        assistant('a1', 110),
        makeTranscriptMessage('u2', 'user', 200),
      ];
      const tabs = signal([tab(TAB, messages, 'streaming')]);
      configure({ tabs, loader: () => Promise.resolve(RECAP) });
      const dock = TestBed.inject(DisplayDockState);
      const setLiveTurn = jest.spyOn(dock, 'setLiveTurn');
      const fixture = mount(TAB);
      await settle(fixture);

      expect(setLiveTurn).toHaveBeenCalledWith(TAB, 'u2');
      expect(dock.tab(TAB).liveTurnKey).toBe('u2');

      tabs.set([tab(TAB, messages, 'loaded')]);
      await settle(fixture);

      expect(setLiveTurn).toHaveBeenLastCalledWith(TAB, null);
      expect(dock.tab(TAB).liveTurnKey).toBeNull();
    });
  });

  describe('display candidates (decision #94)', () => {
    it('a content-only streaming write that opens a display fence adds a live candidate', async () => {
      let tree = messageTree('s1', 200, [textNode('s1-text', 'Working on it')]);
      const tabs = signal([tab(TAB, [makeTranscriptMessage('u1', 'user', 100)], 'streaming', { revision: 0 })]);
      configure({
        tabs,
        buildTree: jest.fn(() => [tree]),
        loader: () => Promise.resolve(RECAP),
      });
      const fixture = mount(TAB);
      await settle(fixture);

      const store = TestBed.inject(StreamPresentationStore);
      const structure = store.structureFor(TAB)();
      expect(structure.slots.map((slot) => slot.id)).toEqual(['u1', 's1']);
      expect(
        fixture.nativeElement.querySelector('ptah-display-surface-sync'),
      ).toBeNull();

      // Same ids, boundary and streaming flag: only the text grows.
      tree = messageTree('s1', 200, [
        textNode(
          's1-text',
          'Working on it\n```ptah-ui display stats\nstats\n  Files | 2\n',
        ),
      ]);
      tabs.set([tab(TAB, [makeTranscriptMessage('u1', 'user', 100)], 'streaming', { revision: 1 })]);
      await settle(fixture);

      expect(store.structureFor(TAB)()).toBe(structure);
      const sync = fixture.debugElement.query(By.directive(DisplaySurfaceSyncStub));
      expect(sync).not.toBeNull();
      const candidates = (sync.componentInstance as DisplaySurfaceSyncStub).candidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        blockKey: 's1:s1-text',
        messageId: 's1',
        nodeId: 's1-text',
        turnKey: 'u1',
        live: true,
      });
      expect(candidates[0].text).toContain('ptah-ui display stats');
    });
  });

  describe('host sources (decisions #72, #81, #102)', () => {
    const AGENTS_FENCE =
      '```ptah-ui display agents\nstats\n  Agents | $agents.total\n```\n';

    it('the sync resolves a $agents display fence through its transcript’s host sources', async () => {
      configure({
        tabs: signal([
          tab(TAB, [
            makeTranscriptMessage('u1', 'user', 100),
            assistant('a1', 110, [
              textNode('a1-text', AGENTS_FENCE),
              taskWithAgent('t1'),
              taskWithAgent('t2'),
            ]),
          ]),
        ]),
        realSync: true,
        loader: () => Promise.resolve(RECAP),
        providers: [
          {
            provide: AgentMonitorStore,
            useValue: {
              subagents: signal(new Map()),
              agentsOwnedBySession: () => [],
            },
          },
        ],
      });
      const dock = TestBed.inject(DisplayDockState);
      const fixture = mount(TAB);
      await settle(fixture);

      const syncElement = fixture.debugElement.query(
        By.directive(DisplaySurfaceSyncComponent),
      );
      expect(syncElement).not.toBeNull();
      expect(syncElement.injector.get(PTAH_UI_HOST_SOURCES)).toBe(
        fixture.componentInstance.display.hostSources,
      );

      const status = dock.fenceStatus(TAB, displayFenceKey('a1', 'a1-text', 0));
      expect(status?.kind).toBe('applied');
      const [surface] = dock.tab(TAB).surfaces;
      expect(surface.displayId).toBe('agents');
      const content = surface.content as unknown as {
        surface: { components: readonly { value?: unknown }[] };
      };
      // Two foreground agents in the turn, read from this transcript's facts.
      expect(content.surface.components.map((c) => c.value)).toEqual([2]);
    });

    it('two transcripts provide two different host-source instances', async () => {
      configure({
        tabs: signal([
          tab(TAB, [makeTranscriptMessage('u1', 'user', 100)]),
          tab('tab-2', [makeTranscriptMessage('t2-u1', 'user', 100)]),
        ]),
        loader: () => Promise.resolve(RECAP),
      });
      const one = mount(TAB);
      const two = mount('tab-2');
      await settle(one, two);

      const first = one.debugElement.injector.get(PTAH_UI_HOST_SOURCES);
      const second = two.debugElement.injector.get(PTAH_UI_HOST_SOURCES);
      expect(first).not.toBe(second);
      expect(first).toBe(one.componentInstance.display.hostSources);
      expect(second).toBe(two.componentInstance.display.hostSources);
      expect(first.tabId()).toBe(TAB);
      expect(second.tabId()).toBe('tab-2');
      expect(first.turnIndexOf('u1')).toBe(0);
      expect(first.turnIndexOf('t2-u1')).toBeNull();
    });
  });

  describe('R10.9 webview half (decision #56)', () => {
    const LIMITS_FENCE =
      '```ptah-ui display lanes\nstats\n  Lanes | $limits.lanes\n```\n';

    it('VS Code renders a $limits fence as an ordinary code block and never reads lane limits', async () => {
      mockRpcCall.mockResolvedValue({ success: true, data: { changeSets: [] } });
      const rpc = { call: jest.fn() };
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
              isElectron: false,
            } as unknown as VSCodeService,
          },
          { provide: ClaudeRpcService, useValue: rpc },
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
                  id: TAB,
                  claudeSessionId: 'session-1',
                  status: 'loaded',
                  messages: [
                    makeTranscriptMessage('u1', 'user', 100),
                    createExecutionChatMessage({
                      id: 'a1',
                      role: 'assistant',
                      rawContent: LIMITS_FENCE,
                      streamingState: messageTree('a1-tree', 110, [
                        textNode('a1-text', LIMITS_FENCE),
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
      const fixture = mount(TAB);
      await settle(fixture);

      expect(
        fixture.nativeElement.querySelector('ptah-ui-message-text'),
      ).toBeNull();
      expect(fixture.nativeElement.querySelector('ptah-ui-block')).toBeNull();
      expect(
        fixture.nativeElement.querySelector('ptah-display-surface-sync'),
      ).toBeNull();
      const markdown = fixture.debugElement
        .queryAll(By.css('markdown'))
        .map((element) => String(element.componentInstance.data ?? ''));
      expect(markdown.some((data) => data.includes(LIMITS_FENCE.trim()))).toBe(
        true,
      );
      const methods = [
        ...rpc.call.mock.calls.map(([method]) => method),
        ...mockRpcCall.mock.calls.map(([method]) => method),
      ];
      expect(methods).not.toContain('agent:getLanePlanLimits');
    });
  });
});
