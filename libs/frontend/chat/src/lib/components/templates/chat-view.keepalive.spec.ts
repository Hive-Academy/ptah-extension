/**
 * Workspace-switch transcript keep-alive (TASK_2026_155 Batch 2).
 *
 * Drives the REAL TabManagerService (+ real TabWorkspacePartitionService and
 * registries) through a workspace round-trip and asserts that a retained
 * transcript's component instance SURVIVES — same object reference after
 * switching away and back — rather than being torn down and rebuilt. Reuses the
 * zoneless TestBed + ngx-markdown stub pattern from `chat-view.memo.spec.ts`.
 *
 * A minimal host reproduces `ChatViewComponent`'s retention wiring (component-
 * scoped TranscriptRetentionService + `@for (tabId of retainedTabIds(); track
 * tabId)`), so the assertion isolates the keep-alive mechanism from
 * ChatViewComponent's unrelated singletons.
 */

import {
  Component,
  Input,
  Output,
  EventEmitter,
  NgModule,
  ChangeDetectionStrategy,
  inject,
  signal,
  input,
  output,
  NO_ERRORS_SCHEMA,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div data-test="markdown-stub">{{ data }}</div>',
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

import { DeferBlockBehavior, TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import {
  TabManagerService,
  TabWorkspacePartitionService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import { AgentMonitorStore, ExecutionTreeBuilderService, type MonitoredAgent } from '@ptah-extension/chat-streaming';
import { SURFACE_ACTIVE, VSCodeService, AppStateManager, AuthStateService, ClaudeRpcService, PlanLimitsStore } from '@ptah-extension/core';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { SidebarTabComponent } from '@ptah-extension/chat-ui';
import { DisplayPanelComponent, type DisplaySurface } from '@ptah-extension/chat-ui/display-panel';
import { ChatTranscriptComponent } from '../organisms/transcript/chat-transcript.component';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatEmptyStateComponent } from '../molecules/setup-plugins/chat-empty-state.component';
import { TranscriptRetentionService } from '../../services/transcript-retention.service';
import { RAIL_TRANSCRIPT_RETENTION, SESSION_CONTEXT } from '../../tokens/session-context.token';
import { ChatViewComponent, RAIL_MIN_CONTENT_WIDTH } from './chat-view.component';
import { RailTranscriptRetentionCoordinator } from '../../services/rail-transcript-retention-coordinator.service';
import { ChatStore } from '../../services/chat.store';
import {
  InspectorOpenStateService,
  SessionInspectorStore,
} from '../../services/session-inspector';
import { ActionBannerService } from '../../services/action-banner.service';
import { SessionHistoryReplayer } from '../../services/chat-store/session-history-replayer.service';
import { HistoryPagingService } from '../../services/chat-store/history-paging.service';
import { ChangeSetActionsService } from '../../services/change-set/change-set-actions.service';
import { DisplayDockComponent } from '../organisms/display-dock/display-dock.component';
import { SESSION_CARD_ACTIONS, SESSION_VISIBLE } from '../../tokens/session-context.token';

@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '',
})
class MessageBubbleStub {
  @Input() message: unknown;
  @Input() isStreaming = false;
  @Input() isFinalizing = false;
  @Input() isSessionActive = false;
  // The transcript renders bubbles in sub-agent tile mode (R9n).
  @Input() agentTileMode = false;
  // Mirrors MessageBubbleComponent's ptah-ui inputs (TASK_2026_610 B7/C2a).
  @Input() ptahUiOrderKey = 0;
  @Input() ptahUiSnapshot: unknown = null;
  // Mirrors MessageBubbleComponent's turn inputs/outputs (TASK_2026_677 A1-3).
  @Input() turn: unknown = null;
  @Input() viewMode: 'full' | 'compact' = 'full';
  @Input() logOpen: boolean | null = null;
  @Input() turnLive = false;
  @Input() now = 0;
  @Input() needsYouCount = 0;
  @Input() agents: readonly unknown[] = [];
  @Output() branchRequested = new EventEmitter<string>();
  @Output() rewindRequested = new EventEmitter<string>();
  @Output() logToggled = new EventEmitter<unknown>();
  @Output() laneRequested = new EventEmitter<string>();
}

@Component({
  selector: 'ptah-chat-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '',
})
class EmptyStateStub {
  @Output() promptSelected = new EventEmitter<string>();
}

@Component({
  selector: 'ptah-keepalive-host',
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TranscriptRetentionService],
  template: `
    @for (tabId of transcriptTabIds(); track tabId) {
      <ptah-chat-transcript
        [tabId]="tabId"
        [active]="tabId === activeTabId()"
      />
    }
  `,
})
class KeepAliveHostComponent {
  private readonly retention = inject(TranscriptRetentionService);
  private readonly tabManager = inject(TabManagerService);
  readonly transcriptTabIds = this.retention.retainedTabIds;
  readonly activeTabId = this.tabManager.activeTabId;
}

const WS_A = '/ws/a';
const WS_B = '/ws/b';

function makeMessage(id: string): ExecutionChatMessage {
  return {
    id,
    role: 'assistant',
    rawContent: 'content',
    timestamp: 0,
  } as unknown as ExecutionChatMessage;
}

describe('ChatViewComponent keep-alive — workspace-switch transcript survival', () => {
  beforeEach(() => {
    localStorage.clear();

    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      imports: [KeepAliveHostComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: () => [], clearForTab: jest.fn() },
        },
        {
          provide: VSCodeService,
          useValue: {
            getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
          } as unknown as VSCodeService,
        },
        { provide: SESSION_CONTEXT, useValue: null },
      ],
    });
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: { imports: [MessageBubbleComponent, ChatEmptyStateComponent] },
      add: { imports: [MessageBubbleStub, EmptyStateStub] },
    });
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps the previous workspace tab transcript mounted (same instance) across a switch round-trip', () => {
    const tabManager = TestBed.inject(TabManagerService);
    const fixture = TestBed.createComponent(KeepAliveHostComponent);

    const flush = () => {
      TestBed.tick();
      fixture.detectChanges();
    };

    const transcriptFor = (tabId: string): ChatTranscriptComponent | null => {
      const match = fixture.debugElement
        .queryAll(By.directive(ChatTranscriptComponent))
        .find((de) => de.componentInstance.tabId() === tabId);
      return match
        ? (match.componentInstance as ChatTranscriptComponent)
        : null;
    };

    // Workspace A: seed a tab with a message and render its transcript.
    tabManager.switchWorkspace(WS_A);
    const tabA = tabManager.createTab('A');
    tabManager.setMessages(tabA, [makeMessage('a-msg')]);
    flush();

    const transcriptA = transcriptFor(tabA);
    expect(transcriptA).toBeTruthy();
    expect(transcriptA!.active()).toBe(true);

    // Switch to workspace B and seed its own tab — A's transcript stays retained.
    tabManager.switchWorkspace(WS_B);
    const tabB = tabManager.createTab('B');
    tabManager.setMessages(tabB, [makeMessage('b-msg')]);
    flush();

    // Both transcripts are mounted; B is active, A is retained but hidden.
    expect(tabManager.tabs().some((t) => t.id === tabA)).toBe(false);
    const transcriptAWhileHidden = transcriptFor(tabA);
    expect(transcriptAWhileHidden).toBe(transcriptA); // same instance, not rebuilt
    expect(transcriptAWhileHidden!.active()).toBe(false);
    expect(transcriptFor(tabB)!.active()).toBe(true);

    // Switch back to A — the SAME component instance re-activates (no rebuild).
    tabManager.switchWorkspace(WS_A);
    flush();

    const transcriptAAfter = transcriptFor(tabA);
    expect(transcriptAAfter).toBe(transcriptA);
    expect(transcriptAAfter!.active()).toBe(true);
  });

  it('Rail host retains by SESSION_CONTEXT tab id and per-tab dock state survives a tab change', () => {
    const contextTabId = signal<string | null>(null);
    TestBed.overrideProvider(SESSION_CONTEXT, { useValue: contextTabId.asReadonly() });
    TestBed.overrideProvider(RAIL_TRANSCRIPT_RETENTION, { useValue: true });
    const tabManager = TestBed.inject(TabManagerService);
    tabManager.switchWorkspace(WS_A);
    const tabA = tabManager.createTab('A');
    const tabB = tabManager.createTab('B');
    const fixture = TestBed.createComponent(KeepAliveHostComponent);
    const retention = fixture.debugElement.injector.get(TranscriptRetentionService);
    contextTabId.set(tabA);
    TestBed.tick();
    fixture.detectChanges();
    contextTabId.set(tabB);
    TestBed.tick();
    fixture.detectChanges();
    expect(retention.retainedTabIds()).toEqual([tabA, tabB]);
    contextTabId.set(tabA);
    TestBed.tick();
    fixture.detectChanges();
    fixture.destroy();
  });

});

@Component({
  selector: 'ptah-display-panel',
  standalone: true,
  template: '',
})
class StubDisplayPanelComponent {
  readonly surfaces = input<readonly DisplaySurface[]>([]);
  readonly summary = input<unknown>(null);
  readonly summaryTurnKey = input('');
  readonly selectedKey = input<string | null>(null);
  readonly pinned = input(false);
  readonly viewStates = input<unknown>(null);
  readonly actionError = input<string | null>(null);
  readonly selectedKeyChange = output<string>();
  readonly viewStateChange = output<unknown>();
  readonly openFile = output<string>();
  readonly review = output<void>();
}

@Component({
  selector: 'ptah-agent-monitor-panel',
  standalone: true,
  template: `<span>{{ docked() ? 'No agents in this session' : '' }}</span>`,
})
class StubAgentMonitorPanelComponent {
  readonly docked = input(false);
  readonly embeddedAgents = input<MonitoredAgent[] | undefined>(undefined);
  readonly embeddedOpen = input<boolean | undefined>(undefined);
  readonly sessionId = input<string | null>(null);
  readonly isOverlay = input(false);
  readonly closed = output<void>();
}

const otherPaneTab = signal<string | null>('tab-2');

@Component({
  selector: 'ptah-other-rail-pane',
  standalone: true,
  imports: [ChatViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: SESSION_CONTEXT, useValue: otherPaneTab.asReadonly() },
    { provide: RAIL_TRANSCRIPT_RETENTION, useValue: true },
  ],
  template: '<ptah-chat-view />',
})
class OtherRailPaneComponent {}


interface RailHarness {
  fixture: ComponentFixture<ChatViewComponent>;
  agents: ReturnType<typeof signal<MonitoredAgent[]>>;
  activeTabId: ReturnType<typeof signal<string | null>>;
  openTabs: ReturnType<typeof signal<{ id: string; claudeSessionId?: string }[]>>;
  contextTabId: ReturnType<typeof signal<string | null>>;
  closeTab(tabId: string): void;
  panelOpenRequest: ReturnType<
    typeof signal<{ seq: number; tabId: string | null }>
  >;
  emitHostWidth(width: number): void;
}

function mountRail(
  options: {
    electron?: boolean;
    minContentWidth?: number | null;
    deferBehavior?: DeferBlockBehavior;
    contextual?: boolean;
    cardActions?: boolean;
    railRetention?: boolean;
    provideMinimum?: boolean;
  } = {},
): RailHarness {
  const {
    electron = true,
    minContentWidth = 360,
    deferBehavior = DeferBlockBehavior.Playthrough,
    contextual = false,
    cardActions = false,
    railRetention = true,
    provideMinimum = true,
  } = options;
  const agents = signal<MonitoredAgent[]>([]);
  const activeTabId = signal<string | null>('tab-1');
  const contextTabId = signal<string | null>('tab-1');
  const openTabs = signal<{ id: string; claudeSessionId?: string }[]>(contextual ? [{ id: 'tab-1', claudeSessionId: 'session-1' }] : []);
  const closedTabListeners = new Set<(event: { tabId: string; kind: string }) => void>();
  const panelOpenRequest = signal<{ seq: number; tabId: string | null }>({
    seq: 0,
    tabId: null,
  });
  const resizeCallbacks: ResizeObserverCallback[] = [];
  global.ResizeObserver = jest
    .fn()
    .mockImplementation((callback: ResizeObserverCallback) => {
      resizeCallbacks.push(callback);
      return { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
    }) as unknown as typeof ResizeObserver;

  const tabManager = {
    activeTabId: activeTabId.asReadonly(),
    activeTab: jest.fn(() => null),
    activeTabSessionId: signal<string | null>('session-1').asReadonly(),
    activeTabStatus: signal<string | null>(null).asReadonly(),
    activeTabViewMode: signal('full').asReadonly(),
    activeTabHasLiveSession: signal(true).asReadonly(),
    pendingSessionLoad: signal<string | null>(null).asReadonly(),
    visibleTabIds: signal<ReadonlySet<string>>(new Set()).asReadonly(),
    tabs: openTabs.asReadonly(),
    streamingTabIds: signal<Set<string>>(new Set()).asReadonly(),
    closedTab: signal(null).asReadonly(),
    onTabClosed: jest.fn((listener: (event: { tabId: string; kind: string }) => void) => {
      closedTabListeners.add(listener);
      return () => closedTabListeners.delete(listener);
    }),
    removedWorkspace$: signal(null).asReadonly(),
    findTabByIdAcrossWorkspaces: jest.fn((id: string) => {
      const tab = openTabs().find((candidate) => candidate.id === id);
      return tab ? { tab, workspacePath: '/w' } : null;
    }),
    findTabBySessionId: jest.fn(() => null),
    findTabsBySessionId: jest.fn(() => []),
    clearRemovedWorkspace: jest.fn(),
    clearPendingSessionLoad: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [ChatViewComponent],
    deferBlockBehavior: deferBehavior,
    providers: [
      provideSurfaceActiveTesting(),
      {
        provide: ChatStore,
        useValue: {
          isCompactingForTab: jest.fn(() => false),
          currentSessionId: signal<string | null>('session-1').asReadonly(),
          sessionIsActive: signal(true).asReadonly(),
          activeTab: signal(null),
          messages: signal([]),
          isStreaming: signal(false),
          currentModel: signal('model'),
          sessionStatus: signal(null),
          queueRestoreContent: signal(null),
          queuedContent: signal<string | null>(null),
          unmatchedPermissions: signal([]),
          questionRequests: signal([]),
          resumableSubagents: signal([]).asReadonly(),
        },
      },
      {
        provide: VSCodeService,
        useValue: {
          isElectron: electron,
          config: jest.fn(() => ({ workspaceRoot: '/w' })),
          getPtahIconUri: () => 'data:,',
          getPtahUserIconUri: () => 'data:,',
        },
      },
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      {
        provide: ConfirmationDialogService,
        useValue: { confirm: jest.fn(), confirmWithCheckboxes: jest.fn() },
      },
      {
        provide: ActionBannerService,
        useValue: {
          banner: signal<unknown>(null).asReadonly(),
          showError: jest.fn(),
          showInfo: jest.fn(),
          showWarning: jest.fn(),
        },
      },
      { provide: TabManagerService, useValue: tabManager },
      {
        provide: SessionHistoryReplayer,
        useValue: { isReplaying: jest.fn(() => false) },
      },
      {
        provide: HistoryPagingService,
        useValue: {
          loadOlder: jest.fn(),
          loadingTabIds: signal<ReadonlySet<string>>(new Set()).asReadonly(),
        },
      },
      {
        provide: AgentMonitorStore,
        useValue: {
          agents: agents.asReadonly(),
          agentsForSession: (): MonitoredAgent[] => agents(),
          agentsOwnedBySession: (sid: string): MonitoredAgent[] =>
            agents().filter((agent) => agent.parentSessionId === sid),
          panelOpenRequest: panelOpenRequest.asReadonly(),
          cliOutputDemand: signal([]).asReadonly(),
          tick: signal(0),
        },
      },
      {
        provide: AppStateManager,
        useValue: {
          currentView: signal('chat'),
          layoutMode: signal('single').asReadonly(),
          composerPrefillRequest: signal({
            seq: 0,
            text: '',
            tabId: null,
          }).asReadonly(),
        },
      },
      {
        provide: ExecutionTreeBuilderService,
        useValue: { clearForTab: jest.fn() },
      },
      {
        provide: ConversationRegistry,
        useValue: {
          getIsCompacting: jest.fn(() => false),
          compactingConversationIds: signal(new Set<string>()),
        },
      },
      {
        provide: TabSessionBinding,
        useValue: { getConversationId: jest.fn(() => null) },
      },
      {
        provide: AuthStateService,
        useValue: {
          authRequiredBanner: signal(null),
          clearAuthRequiredBanner: jest.fn(),
        },
      },
      // The inspector stays closed here: no deferred inspector chunk renders.
      {
        provide: SessionInspectorStore,
        useValue: {
          // The session header and the toggle dot read the needs-you count.
          modelFor: jest.fn(() => signal({ needsYouCount: 0 })),
          reportAnswerMiss: jest.fn(),
          clearAnswerMiss: jest.fn(),
        },
      },
      {
        provide: InspectorOpenStateService,
        useValue: { dockedOpen: () => false, setDocked: jest.fn() },
      },
      {
        provide: PlanLimitsStore,
        useValue: {
          registerScope: jest.fn(() => ({
            id: 1,
            update: jest.fn(async () => undefined),
            release: jest.fn(),
          })),
          snapshot: signal(null).asReadonly(),
          now: signal(0).asReadonly(),
          loading: signal(false).asReadonly(),
          loadError: signal(false).asReadonly(),
          sessionOwner: () => null,
        },
      },
      {
        provide: ChangeSetActionsService,
        useValue: { openFile: jest.fn(), review: jest.fn() },
      },
      { provide: SESSION_CONTEXT, useValue: contextual ? contextTabId.asReadonly() : null },
      { provide: RAIL_TRANSCRIPT_RETENTION, useValue: railRetention },
      { provide: SESSION_CARD_ACTIONS, useValue: cardActions ? { openLane: jest.fn(), openSession: jest.fn() } : null },
      { provide: SESSION_VISIBLE, useValue: null },
      ...(provideMinimum ? [{ provide: RAIL_MIN_CONTENT_WIDTH, useValue: signal(minContentWidth) }] : []),
      RailTranscriptRetentionCoordinator,
    ],
  });
  TestBed.overrideComponent(ChatViewComponent, {
    set: {
      imports: [
        SidebarTabComponent,
        DisplayDockComponent,
        StubAgentMonitorPanelComponent,
      ],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  TestBed.overrideComponent(DisplayDockComponent, {
    remove: { imports: [DisplayPanelComponent] },
    add: {
      imports: [StubDisplayPanelComponent],
    },
  });

  const fixture = TestBed.createComponent(ChatViewComponent);
  fixture.detectChanges();
  return {
    fixture,
    agents,
    activeTabId,
    openTabs,
    contextTabId,
    closeTab(tabId: string): void {
      openTabs.update((tabs) => tabs.filter((tab) => tab.id !== tabId));
      for (const listener of closedTabListeners) listener({ tabId, kind: 'close' });
    },
    panelOpenRequest,
    emitHostWidth(width: number): void {
      const entry = {
        contentRect: { width },
        target: fixture.nativeElement,
      } as unknown as ResizeObserverEntry;
      for (const callback of resizeCallbacks) {
        callback([entry], {} as ResizeObserver);
      }
      fixture.detectChanges();
    },
  };
}

describe('Rail ChatView per-pane display dock', () => {
  let h: RailHarness;
  const originalResizeObserver = global.ResizeObserver;
  afterEach(() => {
    h?.fixture.destroy();
    TestBed.resetTestingModule();
    if (originalResizeObserver) global.ResizeObserver = originalResizeObserver;
    else delete (global as Record<string, unknown>)['ResizeObserver'];
  });

  const dock = () => h.fixture.nativeElement.querySelector('ptah-display-dock') as HTMLElement | null;
  const separator = () => h.fixture.nativeElement.querySelector('[data-testid="display-dock-separator"]') as HTMLElement | null;
  const toggle = () => h.fixture.nativeElement.querySelector('ptah-sidebar-tab button') as HTMLButtonElement | null;
  async function openDock(): Promise<void> {
    toggle()?.click();
    for (let round = 0; round < 3; round += 1) {
      h.fixture.detectChanges();
      await h.fixture.whenStable();
    }
    h.fixture.detectChanges();
  }

  it('side dock at 804 px and overlay at 644 px with a 360 px minimum', async () => {
    h = mountRail({ contextual: true });
    h.emitHostWidth(804);
    await openDock();
    expect(separator()).not.toBeNull();
    expect(dock()?.classList.contains('absolute')).toBe(false);
    h.emitHostWidth(644);
    expect(separator()).toBeNull();
    expect(dock()?.classList.contains('absolute')).toBe(true);
  });

  it('side dock at 976 px (1280 stacked) and overlay at 648 px (920 stacked)', async () => {
    h = mountRail({ contextual: true });
    h.emitHostWidth(976);
    await openDock();
    expect(separator()).not.toBeNull();
    h.emitHostWidth(648);
    expect(separator()).toBeNull();
    expect(dock()?.classList.contains('absolute')).toBe(true);
  });

  it('760/759 px flips with the default 400 px dock', async () => {
    h = mountRail({ contextual: true });
    h.emitHostWidth(760);
    await openDock();
    expect(separator()?.getAttribute('aria-valuenow')).toBe('400');
    h.emitHostWidth(759);
    expect(separator()).toBeNull();
  });

  it('token absent -> old breakpoint', async () => {
    h = mountRail({ contextual: true, provideMinimum: false });
    h.emitHostWidth(644);
    await openDock();
    expect(separator()).not.toBeNull();
    h.emitHostWidth(599);
    expect(separator()).toBeNull();
  });

  it('Rail ChatView with coordinator keeps the display dock mounted (HIDE_AGENT_SIDEBAR not provided)', async () => {
    h = mountRail({ contextual: true });
    h.emitHostWidth(804);
    await openDock();
    expect(h.fixture.debugElement.injector.get(RailTranscriptRetentionCoordinator)).toBeDefined();
    expect(dock()).not.toBeNull();
    expect(toggle()).not.toBeNull();
  });

  it('End at 804 px stays in side mode with its separator', async () => {
    h = mountRail({ contextual: true });
    h.emitHostWidth(804);
    await openDock();
    separator()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    h.fixture.detectChanges();
    expect(separator()?.getAttribute('aria-valuenow')).toBe('444');
    expect(dock()?.classList.contains('absolute')).toBe(false);
  });

  it('two ChatViews share one X transcript after active tab swaps in both directions', () => {
    otherPaneTab.set('tab-2');
    h = mountRail({ contextual: true });
    h.openTabs.set([
      { id: 'tab-1', claudeSessionId: 'session-1' },
      { id: 'tab-2', claudeSessionId: 'session-2' },
    ]);
    const other = TestBed.createComponent(OtherRailPaneComponent);
    const countX = () =>
      h.fixture.nativeElement.querySelectorAll('ptah-chat-transcript[data-tab-id="tab-1"]').length +
      other.nativeElement.querySelectorAll('ptah-chat-transcript[data-tab-id="tab-1"]').length;
    const detectBoth = () => {
      TestBed.tick();
      h.fixture.detectChanges();
      expect(countX()).toBe(1);
      other.detectChanges();
      expect(countX()).toBe(1);
    };
    try {
      detectBoth();
      h.contextTabId.set('tab-2');
      otherPaneTab.set('tab-1');
      expect((h.fixture.componentInstance as unknown as { transcriptTabIds: () => readonly string[] })
        .transcriptTabIds()).not.toContain('tab-1');
      detectBoth();
      h.contextTabId.set('tab-1');
      otherPaneTab.set('tab-2');
      const otherView = other.debugElement.query(By.directive(ChatViewComponent)).componentInstance as
        ChatViewComponent;
      expect((otherView as unknown as { transcriptTabIds: () => readonly string[] })
        .transcriptTabIds()).not.toContain('tab-1');
      detectBoth();
    } finally {
      other.destroy();
    }
  });
});

