/**
 * ChatViewComponent - Display dock integration (TASK_2026_623, Task 25.2).
 *
 * Renders the production template with the dock real and its two heavy
 * children stubbed (the lazy display panel and the agent monitor), so the
 * ChatView wiring is tested with the session sheet and per-tab state.
 */

import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  NO_ERRORS_SCHEMA,
  input,
  output,
  signal,
} from '@angular/core';
import { By } from '@angular/platform-browser';

// Stub ngx-markdown (ESM-only bundle) BEFORE any component import.
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div>{{ data }}</div>`,
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

import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import {
  AppStateManager,
  AuthStateService,
  ClaudeRpcService,
  PlanLimitsStore,
  VSCodeService,
} from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import {
  PTAH_UI_DISPLAY_DOCK,
  PTAH_UI_DISPLAY_DOCK_SYNC,
  SidebarTabComponent,
} from '@ptah-extension/chat-ui';
import {
  DisplayPanelComponent,
  type DisplaySurface,
} from '@ptah-extension/chat-ui/display-panel';
import type { SurfaceContent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { ChatViewComponent } from './chat-view.component';
import { ChatStore } from '../../services/chat.store';
import { SessionInspectorStore } from '../../services/session-inspector';
import { ActionBannerService } from '../../services/action-banner.service';
import { SessionHistoryReplayer } from '../../services/chat-store/session-history-replayer.service';
import { HistoryPagingService } from '../../services/chat-store/history-paging.service';
import { DisplayDockState } from '../../services/display-dock/display-dock.state';
import { ArtifactStore } from '../../services/artifact.store';
import { ChangeSetActionsService } from '../../services/change-set/change-set-actions.service';
import { DisplaySheetComponent } from '../organisms/display-sheet/display-sheet.component';
import {
  HIDE_AGENT_SIDEBAR,
  RAIL_TRANSCRIPT_RETENTION,
  SESSION_CONTEXT,
  SESSION_CARD_ACTIONS,
  SESSION_VISIBLE,
} from '../../tokens/session-context.token';

@Component({
  selector: 'ptah-display-panel',
  standalone: true,
  template: '',
})
class StubDisplayPanelComponent {
  readonly surfaces = input<readonly DisplaySurface[]>([]);
  readonly artifacts = input<readonly unknown[]>([]);
  readonly open = input(true);
  readonly fullscreenArtifactId = input<string | null>(null);
  readonly fullscreenChange = output<boolean>();
  readonly summary = input<unknown>(null);
  readonly summaryTurnKey = input('');
  readonly selectedKey = input<string | null>(null);
  readonly scrollToSelectedOnMount = input(false);
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

function agent(status: MonitoredAgent['status']): MonitoredAgent {
  return {
    agentId: `agent-${status}`,
    cli: 'ptah-cli',
    task: 'work',
    status,
    startedAt: 0,
    stdout: '',
    stderr: '',
    expanded: false,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
  } as MonitoredAgent;
}

function surface(key: string): DisplaySurface {
  return {
    key,
    displayId: key.slice(3),
    content: {} as SurfaceContent,
    title: key,
    description: null,
    turnKey: 'turn-1',
    fenceKey: `m1:n1:${key}:1`,
    createdSeq: 1,
    updatedSeq: 1,
    componentSignatures: new Map(),
    retainedViewStateIds: new Set(),
  };
}

interface Harness {
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

function mount(
  options: {
    electron?: boolean;
    hideAgentSidebar?: boolean;
    deferBehavior?: DeferBlockBehavior;
    contextual?: boolean;
    cardActions?: boolean;
    railRetention?: boolean;
  } = {},
): Harness {
  const {
    electron = true,
    hideAgentSidebar = false,
    deferBehavior = DeferBlockBehavior.Playthrough,
    contextual = false,
    cardActions = false,
    railRetention = false,
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
        provide: ArtifactStore,
        useValue: {
          records: signal({}),
          lastError: signal(null),
          recordById: () => null,
          forSession: () => signal([]),
          reload: jest.fn(),
        },
      },
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
      {
        provide: ClaudeRpcService,
        useValue: {
          call: jest.fn((method: string) =>
            method === 'session:cli-sessions'
              ? Promise.resolve({ success: true, data: { cliSessions: [] } })
              : undefined,
          ),
        },
      },
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
        useValue: {
          isReplaying: jest.fn(() => false),
          retirePersistedFilter: jest.fn(),
        },
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
          pendingHistoryCandidates: signal<
            ReturnType<AgentMonitorStore['pendingHistoryCandidates']>
          >([]).asReadonly(),
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
      {
        provide: SessionInspectorStore,
        useValue: {
          // The compact card reads the needs-you count.
          modelFor: jest.fn(() => signal({ needsYouCount: 0 })),
        },
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
      { provide: HIDE_AGENT_SIDEBAR, useValue: hideAgentSidebar },
    ],
  });
  TestBed.overrideComponent(ChatViewComponent, {
    set: {
      imports: [
        SidebarTabComponent,
        DisplaySheetComponent,
        StubAgentMonitorPanelComponent,
      ],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  TestBed.overrideComponent(DisplaySheetComponent, {
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

describe('ChatViewComponent - Display dock (Task 25.2)', () => {
  let h: Harness;
  const originalResizeObserver = global.ResizeObserver;

  afterEach(() => {
    h?.fixture.destroy();
    TestBed.resetTestingModule();
    if (originalResizeObserver) {
      global.ResizeObserver = originalResizeObserver;
    } else {
      delete (global as Record<string, unknown>)['ResizeObserver'];
    }
  });

  const native = (): HTMLElement => h.fixture.nativeElement as HTMLElement;
  const store = (): DisplayDockState =>
    h.fixture.debugElement.injector.get(DisplayDockState);
  const toggle = (): HTMLButtonElement | null =>
    native().querySelector('[data-testid="display-sheet-bar"]');
  const dockEl = (): HTMLElement | null =>
    native().querySelector('ptah-display-sheet');
  /** Change detection plus the deferred dock block, a few rounds. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      h.fixture.detectChanges();
      await h.fixture.whenStable();
    }
    h.fixture.detectChanges();
  }

  async function clickToggle(): Promise<void> {
    toggle()?.click();
    await settle();
  }

  describe('providers (decisions #59, #60, #108)', () => {
    it('resolves both chat-ui ports to the one DisplayDockState in Electron', () => {
      h = mount();
      const injector = h.fixture.debugElement.injector;
      const state = injector.get(DisplayDockState);
      expect(state).toBeInstanceOf(DisplayDockState);
      expect(injector.get(PTAH_UI_DISPLAY_DOCK)).toBe(state);
      expect(injector.get(PTAH_UI_DISPLAY_DOCK_SYNC)).toBe(state);
    });

    it('releases the dock state of a closed tab, whichever path closed it (TASK_2026_630 #5)', async () => {
      h = mount();
      h.openTabs.set([{ id: 'tab-1' }, { id: 'tab-2' }]);
      await settle();
      store().openSurface('tab-1', 'surface-a');
      store().openSurface('tab-2', 'surface-b');
      h.openTabs.set([{ id: 'tab-1' }]);
      await settle();
      expect(store().tab('tab-2').open).toBe(false);
      expect(store().tab('tab-2').selection).toBeNull();
      expect(store().tab('tab-1').open).toBe(true);
    });

    it('keeps the dock state of a tab that only left the active workspace', async () => {
      h = mount();
      const tabManager = h.fixture.debugElement.injector.get(TabManagerService);
      h.openTabs.set([{ id: 'tab-1' }, { id: 'tab-2' }]);
      await settle();
      store().openSurface('tab-2', 'surface-b');
      (tabManager.findTabByIdAcrossWorkspaces as jest.Mock).mockReturnValue({ id: 'tab-2' });
      h.openTabs.set([]);
      await settle();
      expect(store().tab('tab-2').open).toBe(true);
    });

    it('VS Code: no store, no Display toggle and no dock (R1.14)', async () => {
      h = mount({ electron: false });
      const injector = h.fixture.debugElement.injector;
      expect(injector.get(DisplayDockState, null, { optional: true })).toBeNull();
      expect(injector.get(PTAH_UI_DISPLAY_DOCK, null, { optional: true })).toBeNull();
      expect(native().querySelector('ptah-sidebar-tab button')?.getAttribute('aria-label')).toBe('Toggle Agents panel');
      expect(toggle()).toBeNull();
      native().querySelector<HTMLButtonElement>('ptah-sidebar-tab button')?.click();
      await settle();
      expect(dockEl()).toBeNull();
      expect(native().querySelector('ptah-agent-monitor-panel')).not.toBeNull();
    });

    it('opens the embedded Agents panel for a main-chat transcript request', async () => {
      h = mount({ electron: false });
      const panel = h.fixture.debugElement.query(By.directive(StubAgentMonitorPanelComponent))
        .componentInstance as StubAgentMonitorPanelComponent;
      h.panelOpenRequest.set({ seq: 1, tabId: null });
      await settle();
      expect(panel.embeddedOpen()).toBe(true);
    });

    it('HIDE_AGENT_SIDEBAR still hides the VS Code sidebar', async () => {
      h = mount({ electron: false, hideAgentSidebar: true });
      await settle();
      expect(toggle()).toBeNull();
      expect(native().querySelector('ptah-agent-monitor-panel')).toBeNull();
    });

    it('shows display surfaces in every Electron host without an Agents tab', async () => {
      h = mount({ hideAgentSidebar: true });
      h.emitHostWidth(1280);
      h.agents.set([agent('running')]);
      await settle();
      expect(store().tab('tab-1').open).toBe(false);
      const first = surface('id:chart');
      store().setLiveTurn('tab-1', 'turn-1');
      store().setSurfaces('tab-1', { surfaces: [first], statuses: new Map() });
      store().requestAutoOpen('tab-1', 'turn-1', first.key);
      await settle();
      expect(store().tab('tab-1').open).toBe(true);
      const panel = h.fixture.debugElement.query(By.directive(StubDisplayPanelComponent));
      expect(panel.componentInstance.surfaces()).toEqual([first]);
      const updated = { ...first, updatedSeq: 2 };
      store().setSurfaces('tab-1', { surfaces: [updated], statuses: new Map() });
      await settle();
      expect(panel.componentInstance.surfaces()).toEqual([updated]);
      expect(native().querySelector('ptah-display-sheet [role="tablist"]')).toBeNull();
      expect(native().querySelector('ptah-display-sheet ptah-agent-monitor-panel')).toBeNull();
    });

    it('running agents and monitor chip requests never open the Electron display dock', async () => {
      h = mount();
      h.agents.set([agent('running')]);
      await settle();
      expect(store().tab('tab-1').open).toBe(false);
      h.panelOpenRequest.set({ seq: 1, tabId: null });
      await settle();
      expect(store().tab('tab-1').open).toBe(false);
    });
  });

  describe('peek bar', () => {
    it('opens and collapses the sheet with aria-expanded', async () => {
      h = mount();
      store().setSurfaces('tab-1', { surfaces: [surface('id:chart')], statuses: new Map() });
      await settle();
      const bar = toggle() as HTMLButtonElement;
      expect(bar.tagName).toBe('BUTTON');
      expect(bar.tabIndex).toBe(0);
      expect(bar.getAttribute('aria-expanded')).toBe('false');
      await clickToggle();
      expect(bar.getAttribute('aria-expanded')).toBe('true');
      expect(native().querySelector('[data-testid="display-sheet-region"]')).not.toBeNull();
      await clickToggle();
      expect(bar.getAttribute('aria-expanded')).toBe('false');
      expect(native().querySelector('[data-testid="display-sheet-region"]')).toBeNull();
    });
  });

  it('sheet region opens above the composer and Escape restores bar focus', async () => {
    h = mount();
    store().setSurfaces('tab-1', { surfaces: [surface('id:chart')], statuses: new Map() });
    await settle();
    const bar = toggle() as HTMLButtonElement;
    await clickToggle();
    expect(native().querySelectorAll('ptah-display-sheet')).toHaveLength(1);
    expect(native().querySelector('[data-testid="display-sheet-region"]')).not.toBeNull();
    expect(native().querySelector('ptah-display-sheet ptah-agent-monitor-panel')).toBeNull();
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(store().tab('tab-1').open).toBe(false);
    expect(document.activeElement).toBe(bar);
  });

  it('auto-open does not move focus (R1.7)', async () => {
    h = mount();
    h.emitHostWidth(1280);
    const outside = document.createElement('button');
    native().prepend(outside);
    outside.focus();
    store().requestAutoOpen('tab-1', 'turn-1', 'id:a');
    await settle();
    expect(native().querySelector('[data-testid="display-sheet-region"]')).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('a tab switch shows that tab and never auto-opens (R1.1, R1.9)', async () => {
    h = mount();
    h.emitHostWidth(1280);
    store().setSurfaces('tab-1', { surfaces: [surface('id:chart')], statuses: new Map() });
    await settle();
    await clickToggle();
    expect(store().tab('tab-1').open).toBe(true);

    h.activeTabId.set('tab-2');
    await settle();
    expect(dockEl()?.style.display).toBe('none');
    expect(native().querySelector('[data-testid="display-sheet-region"]')).toBeNull();
    expect(store().tab('tab-2').open).toBe(false);

    h.activeTabId.set('tab-1');
    await settle();
    expect(dockEl()?.style.display).not.toBe('none');
    expect(native().querySelector('[data-testid="display-sheet-region"]')).not.toBeNull();
  });

  it('sheet chunk failure shows an alert without an agent monitor', async () => {
    h = mount({ deferBehavior: DeferBlockBehavior.Manual });
    h.emitHostWidth(1280);
    store().setSurfaces('tab-1', { surfaces: [surface('id:chart')], statuses: new Map() });
    await settle();
    await clickToggle();
    const [dockBlock] = await h.fixture.getDeferBlocks();
    await dockBlock.render(DeferBlockState.Error);
    await settle();
    expect(native().querySelector('[role="alert"]')?.textContent).toContain('Display failed to load');
    expect(native().querySelector('ptah-agent-monitor-panel')).toBeNull();
  });

  it('Rail host agent activity never opens the display sheet', async () => {
    h = mount({ contextual: true, railRetention: true });
    h.agents.set([{ ...agent('running'), parentSessionId: 'session-1' }]);
    await settle();
    expect(store().tab('tab-1').open).toBe(false);
  });

  it('Rail ChatView retains two transcript DOM nodes and restores its own dock state on context round trip', async () => {
    h = mount({ contextual: true, railRetention: true });
    h.openTabs.set([
      { id: 'tab-1', claudeSessionId: 'session-1' },
      { id: 'tab-2', claudeSessionId: 'session-2' },
    ]);
    h.emitHostWidth(1280);
    await settle();
    const transcripts = () => native().querySelectorAll('ptah-chat-transcript');
    const first = transcripts()[0] as HTMLElement & { active: boolean };
    expect(first.active).toBe(true);
    store().open('tab-1');
    store().setPinned('tab-1', true);
    h.contextTabId.set('tab-2');
    await settle();
    expect(transcripts()).toHaveLength(2);
    expect(first.active).toBe(false);
    expect((transcripts()[1] as HTMLElement & { active: boolean }).active).toBe(true);
    expect(store().tab('tab-2').open).toBe(false);
    h.contextTabId.set('tab-1');
    await settle();
    expect(transcripts()).toHaveLength(2);
    expect(transcripts()[0]).toBe(first);
    expect(first.active).toBe(true);
    expect((transcripts()[1] as HTMLElement & { active: boolean }).active).toBe(false);
    expect(store().tab('tab-1').open).toBe(true);
    expect(store().tab('tab-1').pinned).toBe(true);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('contextual ChatView without Rail token renders exactly one transcript', async () => {
    h = mount({ contextual: true });
    h.openTabs.set([
      { id: 'tab-1', claudeSessionId: 'session-1' },
      { id: 'tab-2', claudeSessionId: 'session-2' },
    ]);
    await settle();
    const first = native().querySelector('ptah-chat-transcript');
    h.contextTabId.set('tab-2');
    await settle();
    expect(native().querySelectorAll('ptah-chat-transcript')).toHaveLength(1);
    expect(native().querySelector('ptah-chat-transcript')).not.toBe(first);
  });

  it('Rail ChatView removes the closed context tab transcript before context changes', async () => {
    h = mount({ contextual: true, railRetention: true });
    await settle();
    expect(native().querySelectorAll('ptah-chat-transcript')).toHaveLength(1);
    h.closeTab('tab-1');
    await settle();
    expect(native().querySelectorAll('ptah-chat-transcript')).toHaveLength(0);
  });

  it('single chat agent activity never opens the display dock', async () => {
    h = mount({ cardActions: true });
    h.agents.set([agent('running')]);
    await settle();
    expect(store().tab('tab-1').open).toBe(false);
  });

  it('a fenced ptah-ui display [id] opens in the single chat view sheet and updates in place', async () => {
    h = mount();
    const first = surface('id:chart');
    store().setLiveTurn('tab-1', 'turn-1');
    store().setSurfaces('tab-1', { surfaces: [first], statuses: new Map() });
    store().requestAutoOpen('tab-1', 'turn-1', first.key);
    await settle();
    expect(store().tab('tab-1').open).toBe(true);
    expect(store().tab('tab-1').surfaces).toHaveLength(1);
    const panel = h.fixture.debugElement.query(By.directive(StubDisplayPanelComponent));
    expect(panel).toBeTruthy();
    expect(panel.componentInstance.surfaces()).toEqual([first]);
    const updated = { ...first, updatedSeq: 2 };
    store().setSurfaces('tab-1', { surfaces: [updated], statuses: new Map() });
    await settle();
    expect(store().tab('tab-1').surfaces).toEqual([updated]);
    expect(store().tab('tab-1').surfaces).toHaveLength(1);
    expect(h.fixture.debugElement.query(By.directive(StubDisplayPanelComponent)).componentInstance).toBe(panel.componentInstance);
    expect(panel.componentInstance.surfaces()).toEqual([updated]);
    expect(native().querySelectorAll('ptah-display-sheet')).toHaveLength(1);
  });

});
