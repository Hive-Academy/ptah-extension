import {
  Component,
  Input,
  NgModule,
  NO_ERRORS_SCHEMA,
  createComponent,
  inject,
  input,
  output,
  signal,
  type Type,
} from '@angular/core';
import { By } from '@angular/platform-browser';
jest.mock('ngx-markdown', () => {
  // eslint-disable-next-line @angular-eslint/component-selector
  @Component({ selector: 'markdown', standalone: true, template: '{{ data }}' })
  class MarkdownStub {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStub,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import {
  ActionBannerService,
  ChangeSetActionsService,
  ChatStore,
  ChatViewComponent,
  HIDE_AGENT_SIDEBAR,
  RAIL_MIN_CONTENT_WIDTH,
  RAIL_TRANSCRIPT_RETENTION,
  RailTranscriptRetentionCoordinator,
  SESSION_CARD_ACTIONS,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  SESSION_START_GUARD,
  SESSION_VISIBLE,
  SessionEmbedComponent,
  TabManagerService,
} from '@ptah-extension/chat';
import {
  AppStateManager,
  AuthStateService,
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  PlanLimitsStore,
  SURFACE_ACTIVE,
  VSCodeService,
} from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import {
  PTAH_UI_DISPLAY_DOCK_SYNC,
  SidebarTabComponent,
  type PtahUiDisplayDockSync,
} from '@ptah-extension/chat-ui';
import {
  DisplayPanelComponent,
  type DisplaySurface,
} from '@ptah-extension/chat-ui/display-panel';
import type { SurfaceContent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';
import { CanvasDetailService } from './canvas-detail.service';

@Component({
  selector: 'ptah-test-rail-tile',
  standalone: true,
  template:
    '<button type="button" (click)="actions.openLane(\'sub:tool\')">Open agent</button>',
})
class RailTileStub {
  readonly actions = inject(SESSION_CARD_ACTIONS);
}

@Component({ selector: 'ptah-display-panel', standalone: true, template: '' })
class RailDisplayPanelStub {
  readonly surfaces = input<readonly DisplaySurface[]>([]);
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
  template: '',
})
class RailAgentPanelStub {
  readonly docked = input(false);
  readonly embeddedAgents = input<unknown[] | undefined>(undefined);
  readonly embeddedOpen = input<boolean | undefined>(undefined);
  readonly sessionId = input<string | null>(null);
  readonly isOverlay = input(false);
  readonly closed = output<void>();
}

function componentImport(
  owner: Type<unknown>,
  selector: string,
): Type<unknown> {
  type Dependency = Type<unknown> & { ɵcmp?: { selectors: string[][] } };
  const definition = owner as Type<unknown> & {
    ɵcmp: { dependencies: Dependency[] | (() => Dependency[]) };
  };
  const imports = definition.ɵcmp.dependencies;
  const component = (typeof imports === 'function' ? imports() : imports).find(
    (dependency) =>
      dependency.ɵcmp?.selectors.some((selectors) =>
        selectors.includes(selector),
      ),
  );
  if (!component)
    throw new Error(`Missing ${selector} in ${owner.name} imports`);
  return component;
}

describe('CanvasDetailTranscriptComponent visibility', () => {
  it('fenced display opens and updates in place in the Rail sheet', async () => {
    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    })) as unknown as typeof ResizeObserver;
    const tabs = signal([{ id: 'parent', claudeSessionId: 'owner' }]);
    const open = jest.fn(() => false);
    const visibleTabIds = signal<ReadonlySet<string>>(new Set());
    const tabManager = {
      activeTabId: signal<string | null>('parent'),
      activeTab: jest.fn(() => null),
      activeTabSessionId: signal<string | null>('owner'),
      activeTabStatus: signal(null),
      activeTabViewMode: signal('full'),
      activeTabHasLiveSession: signal(true),
      pendingSessionLoad: signal(null),
      visibleTabIds,
      tabs,
      streamingTabIds: signal(new Set()),
      closedTab: signal(null),
      onTabClosed: jest.fn(() => () => undefined),
      removedWorkspace$: signal(null),
      findTabByIdAcrossWorkspaces: jest.fn((id: string) =>
        id === 'parent' ? { tab: tabs()[0], workspacePath: '/w' } : null,
      ),
      findTabBySessionId: jest.fn(() => null),
      findTabsBySessionId: jest.fn(() => []),
      clearRemovedWorkspace: jest.fn(),
      clearPendingSessionLoad: jest.fn(),
      registerVisibleTab: jest.fn((id: string) =>
        visibleTabIds.set(new Set([...visibleTabIds(), id])),
      ),
      unregisterVisibleTab: jest.fn((id: string) => {
        const next = new Set(visibleTabIds());
        next.delete(id);
        visibleTabIds.set(next);
      }),
    };
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
      providers: [
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        { provide: CanvasDetailService, useValue: { open } },
        { provide: TabManagerService, useValue: tabManager },
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        {
          provide: EffortStateService,
          useValue: { isLoaded: signal(false), currentEffort: signal(null) },
        },
        {
          provide: ModelStateService,
          useValue: { isLoaded: signal(false), currentModel: signal(null) },
        },
        {
          provide: ChatStore,
          useValue: {
            isCompactingForTab: jest.fn(() => false),
            currentSessionId: signal('owner'),
            sessionIsActive: signal(true),
            activeTab: signal(null),
            messages: signal([]),
            isStreaming: signal(false),
            currentModel: signal('model'),
            sessionStatus: signal(null),
            queueRestoreContent: signal(null),
            queuedContent: signal(null),
            unmatchedPermissions: signal([]),
            questionRequests: signal([]),
            resumableSubagents: signal([]),
          },
        },
        {
          provide: VSCodeService,
          useValue: {
            isElectron: true,
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
            banner: signal(null),
            showError: jest.fn(),
            showInfo: jest.fn(),
            showWarning: jest.fn(),
          },
        },
        {
          provide: AgentMonitorStore,
          useValue: {
            agents: signal([]),
            agentsForSession: () => [],
            agentsOwnedBySession: () => [],
            panelOpenRequest: signal({ seq: 0, tabId: null }),
            cliOutputDemand: signal([]),
            tick: signal(0),
          },
        },
        {
          provide: AppStateManager,
          useValue: {
            currentView: signal('chat'),
            composerPrefillRequest: signal({ seq: 0, text: '', tabId: null }),
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
            compactingConversationIds: signal(new Set()),
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
          provide: PlanLimitsStore,
          useValue: {
            registerScope: jest.fn(() => ({
              id: 1,
              update: jest.fn(async () => undefined),
              release: jest.fn(),
            })),
            snapshot: signal(null),
            now: signal(0),
            loading: signal(false),
            loadError: signal(false),
            sessionOwner: () => null,
          },
        },
        {
          provide: ChangeSetActionsService,
          useValue: { openFile: jest.fn(), review: jest.fn() },
        },
      ],
    });
    const displaySheet = componentImport(ChatViewComponent, 'ptah-display-sheet');
    TestBed.overrideComponent(ChatViewComponent, {
      set: {
        imports: [SidebarTabComponent, displaySheet, RailAgentPanelStub],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    TestBed.overrideComponent(displaySheet, {
      remove: { imports: [DisplayPanelComponent] },
      add: { imports: [RailDisplayPanelStub] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'parent');
    const settle = async () => {
      for (let round = 0; round < 3; round++) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
      fixture.detectChanges();
    };
    try {
      await settle();
      const injector = fixture.componentInstance.childInjector;
      expect(injector.get(HIDE_AGENT_SIDEBAR, null)).toBeNull();
      expect(injector.get(RAIL_TRANSCRIPT_RETENTION)).toBe(true);
      expect(injector.get(SESSION_CARD_ACTIONS)).toBeTruthy();
      const chat = fixture.debugElement.query(By.directive(ChatViewComponent));
      expect(chat).toBeTruthy();
      const store = chat.injector.get(
        PTAH_UI_DISPLAY_DOCK_SYNC,
      ) as PtahUiDisplayDockSync & {
        setLiveTurn(tabId: string, turnKey: string | null): void;
      };
      const first: DisplaySurface = {
        key: 'id:chart',
        displayId: 'chart',
        content: {} as SurfaceContent,
        title: 'Chart',
        description: null,
        turnKey: 'turn-1',
        fenceKey: 'm1:n1:id:chart:1',
        createdSeq: 1,
        updatedSeq: 1,
        componentSignatures: new Map(),
        retainedViewStateIds: new Set(),
      };
      store.setLiveTurn('parent', 'turn-1');
      store.setSurfaces('parent', { surfaces: [first], statuses: new Map() });
      store.requestAutoOpen('parent', 'turn-1', first.key);
      await settle();
      const panel = fixture.debugElement.query(
        By.directive(RailDisplayPanelStub),
      );
      expect(panel).toBeTruthy();
      expect(panel.componentInstance.surfaces()).toEqual([first]);
      const updated = { ...first, updatedSeq: 2 };
      store.setSurfaces('parent', { surfaces: [updated], statuses: new Map() });
      await settle();
      expect(
        fixture.nativeElement.querySelectorAll('ptah-display-sheet'),
      ).toHaveLength(1);
      expect(
        fixture.debugElement.query(By.directive(RailDisplayPanelStub))
          .componentInstance,
      ).toBe(panel.componentInstance);
      expect(panel.componentInstance.surfaces()).toEqual([updated]);
      fixture.componentRef.setInput('visible', false);
      await settle();
      expect(
        fixture.componentInstance.childInjector.get(SESSION_VISIBLE)(),
      ).toBe(false);
      expect(
        fixture.debugElement.query(By.directive(ChatViewComponent))
          .componentInstance,
      ).toBe(chat.componentInstance);
      fixture.componentRef.setInput('visible', true);
      await settle();
      expect(
        fixture.debugElement.query(By.directive(ChatViewComponent))
          .componentInstance,
      ).toBe(chat.componentInstance);
      expect(panel.componentInstance.surfaces()).toEqual([updated]);
      jest.useFakeTimers();
      const actions = injector.get(SESSION_CARD_ACTIONS);
      const status = fixture.nativeElement.querySelector(
        '[role="status"]',
      ) as HTMLElement;
      expect(status).toBeTruthy();
      expect(status.classList.contains('sr-only')).toBe(false);
      actions.openLane('sub:missing');
      fixture.detectChanges();
      const firstNotice = status.querySelector('span');
      expect(firstNotice?.textContent).toContain(
        'This agent is not available yet.',
      );
      expect(firstNotice?.classList.contains('text-base-content')).toBe(true);
      actions.openLane('sub:missing');
      fixture.detectChanges();
      const secondNotice = status.querySelector('span');
      expect(secondNotice).toBeTruthy();
      expect(secondNotice).not.toBe(firstNotice);
      expect(firstNotice?.isConnected).toBe(false);
      expect(secondNotice?.textContent).toContain(
        'This agent is not available yet.',
      );
      open.mockReturnValueOnce(true);
      actions.openLane('sub:available');
      fixture.detectChanges();
      expect(status.querySelector('span')).toBeNull();
      jest.advanceTimersByTime(20);
      const timersBeforeRejection = jest.getTimerCount();
      actions.openLane('sub:missing');
      actions.openLane('sub:missing');
      fixture.detectChanges();
      jest.advanceTimersByTime(20);
      expect(jest.getTimerCount()).toBe(timersBeforeRejection + 1);
      expect(status.querySelector('span')).toBeTruthy();
      jest.advanceTimersByTime(4000);
      fixture.detectChanges();
      expect(status.querySelector('span')).toBeNull();
      expect(fixture.nativeElement.querySelector('[role="status"]')).toBe(
        status,
      );
      const scheduled = jest.spyOn(global, 'setTimeout');
      const cleared = jest.spyOn(global, 'clearTimeout');
      actions.openLane('sub:missing');
      const noticeTimer = scheduled.mock.results.at(-1)?.value;
      expect(noticeTimer).toBeDefined();
      fixture.destroy();
      expect(cleared).toHaveBeenCalledWith(noticeTimer);
    } finally {
      fixture.destroy();
      jest.restoreAllMocks();
      jest.useRealTimers();
      if (originalResizeObserver)
        global.ResizeObserver = originalResizeObserver;
      else delete (global as Record<string, unknown>)['ResizeObserver'];
    }
  });
  it('Rail tile click focuses the owning session and sub lane without opening a display dock or single view', () => {
    const open = jest.fn();
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        { provide: CanvasDetailService, useValue: { open } },
        {
          provide: TabManagerService,
          useValue: {
            visibleTabIds: signal<ReadonlySet<string>>(new Set()),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
          },
        },
      ],
    });
    TestBed.overrideComponent(CanvasDetailTranscriptComponent, {
      set: {
        template:
          '<ptah-session-embed [tabId]="tabId()" [cardActions]="cardActions" [retainRailTranscript]="true" /><div class="tile-host"></div>',
        imports: [SessionEmbedComponent],
      },
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'parent');
    fixture.detectChanges();
    const injector = fixture.componentInstance.childInjector;
    expect(injector.get(RAIL_TRANSCRIPT_RETENTION)).toBe(true);
    expect(injector.get(HIDE_AGENT_SIDEBAR, null)).toBeNull();
    const host = fixture.nativeElement.querySelector(
      '.tile-host',
    ) as HTMLElement;
    const tile = createComponent(RailTileStub, {
      environmentInjector: injector,
      hostElement: host,
    });
    tile.changeDetectorRef.detectChanges();
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith('parent', 'sub:tool');
    expect(
      fixture.nativeElement.querySelector('ptah-single-chat-subagent-view'),
    ).toBeNull();
    tile.destroy();
    fixture.destroy();
  });
  it('registers an absent tab once and releases it on destroy', () => {
    const visibleTabIds = signal<ReadonlySet<string>>(new Set());
    const registerVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(new Set([...visibleTabIds(), id])),
    );
    const unregisterVisibleTab = jest.fn((id: string) => {
      const next = new Set(visibleTabIds());
      next.delete(id);
      visibleTabIds.set(next);
    });
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        {
          provide: CanvasStore,
          useValue: {
            startBlockReason: jest
              .fn()
              .mockReturnValue(
                '9 sessions are running. Wait for one to finish to start another.',
              ),
          },
        },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds().has('tile-1')).toBe(true);
    expect(registerVisibleTab).toHaveBeenCalledTimes(1);
    expect(unregisterVisibleTab).not.toHaveBeenCalled();
    const guard =
      fixture.componentInstance.childInjector.get(SESSION_START_GUARD);
    expect(guard()).toBe(
      '9 sessions are running. Wait for one to finish to start another.',
    );

    fixture.destroy();
    expect(visibleTabIds().has('tile-1')).toBe(false);
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(1);
    expect(unregisterVisibleTab).toHaveBeenCalledWith('tile-1');
  });

  it('leaves a tile-owned visible tab registered after detail closes', () => {
    const visibleTabIds = signal<ReadonlySet<string>>(new Set(['tile-1']));
    let owners = 1;
    const registerVisibleTab = jest.fn(() => {
      owners += 1;
    });
    const unregisterVisibleTab = jest.fn((id: string) => {
      owners -= 1;
      if (owners === 0)
        visibleTabIds.set(
          new Set([...visibleTabIds()].filter((tabId) => tabId !== id)),
        );
    });
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        {
          provide: CanvasStore,
          useValue: {
            startBlockReason: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    fixture.destroy();
    expect(visibleTabIds().has('tile-1')).toBe(true);
    expect(registerVisibleTab).toHaveBeenCalledTimes(1);
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('registers only while its parent surface is active', () => {
    const active = signal(false);
    const visibleTabIds = signal<ReadonlySet<string>>(new Set());
    const registerVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(new Set([...visibleTabIds(), id])),
    );
    const unregisterVisibleTab = jest.fn((id: string) => {
      const next = new Set(visibleTabIds());
      next.delete(id);
      visibleTabIds.set(next);
    });
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: active },
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(registerVisibleTab).not.toHaveBeenCalled();

    active.set(true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(registerVisibleTab).toHaveBeenCalledTimes(1);
    expect(visibleTabIds().has('tile-1')).toBe(true);

    active.set(false);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(1);
    expect(visibleTabIds().has('tile-1')).toBe(false);

    active.set(true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(registerVisibleTab).toHaveBeenCalledTimes(2);
    fixture.destroy();
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(2);
  });

  it('keeps the parent tab registered while a sub lane covers the transcript and unregisters when parent deactivates', () => {
    const parentActive = signal(true);
    const visibleTabIds = signal<ReadonlySet<string>>(new Set());
    const registerVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(new Set([...visibleTabIds(), id])),
    );
    const unregisterVisibleTab = jest.fn((id: string) => {
      const next = new Set(visibleTabIds());
      next.delete(id);
      visibleTabIds.set(next);
    });
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: parentActive },
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'parent');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds().has('parent')).toBe(true);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds().has('parent')).toBe(true);
    for (const token of [SESSION_VISIBLE, SESSION_FOCUSED, SURFACE_ACTIVE]) {
      expect(fixture.componentInstance.childInjector.get(token)()).toBe(false);
    }
    parentActive.set(false);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds().has('parent')).toBe(false);
    fixture.destroy();
  });

  it('registers both displayed transcripts when a lane covers one of them', () => {
    const visibleTabIds = signal<ReadonlySet<string>>(new Set());
    const registerVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(new Set([...visibleTabIds(), id])),
    );
    const unregisterVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(
        new Set([...visibleTabIds()].filter((tabId) => tabId !== id)),
      ),
    );
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: signal(true) },
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const left = TestBed.createComponent(CanvasDetailTranscriptComponent);
    left.componentRef.setInput('tabId', 'left');
    left.componentRef.setInput('visible', false);
    const right = TestBed.createComponent(CanvasDetailTranscriptComponent);
    right.componentRef.setInput('tabId', 'right');
    left.detectChanges();
    right.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds()).toEqual(new Set(['left', 'right']));
    left.destroy();
    right.destroy();
  });

  it('freezes effort and model once after their defaults load', () => {
    const effortLoaded = signal(false);
    const modelLoaded = signal(false);
    const currentEffort = signal('high');
    const currentModel = signal('claude-sonnet');
    const tabs = signal([
      {
        id: 'tile-1',
        overrideEffort: undefined as string | null | undefined,
        overrideModel: undefined as string | undefined,
      },
    ]);
    const setOverrideEffort = jest.fn((id: string, value: string | null) =>
      tabs.update((items) =>
        items.map((tab) =>
          tab.id === id ? { ...tab, overrideEffort: value } : tab,
        ),
      ),
    );
    const setOverrideModel = jest.fn((id: string, value: string) =>
      tabs.update((items) =>
        items.map((tab) =>
          tab.id === id ? { ...tab, overrideModel: value } : tab,
        ),
      ),
    );
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: EffortStateService,
          useValue: { isLoaded: effortLoaded, currentEffort },
        },
        {
          provide: ModelStateService,
          useValue: { isLoaded: modelLoaded, currentModel },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            visibleTabIds: signal<ReadonlySet<string>>(new Set()),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
            setOverrideEffort,
            setOverrideModel,
          },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(setOverrideEffort).not.toHaveBeenCalled();
    expect(setOverrideModel).not.toHaveBeenCalled();

    effortLoaded.set(true);
    modelLoaded.set(true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(setOverrideEffort).toHaveBeenCalledWith('tile-1', 'high');
    expect(setOverrideModel).toHaveBeenCalledWith('tile-1', 'claude-sonnet');
    currentEffort.set('low');
    currentModel.set('claude-opus');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(setOverrideEffort).toHaveBeenCalledTimes(1);
    expect(setOverrideModel).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('destroys its child injector exactly once', () => {
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: {
            visibleTabIds: signal<ReadonlySet<string>>(new Set()),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
          },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    const destroy = jest.spyOn(
      fixture.componentInstance.childInjector,
      'destroy',
    );
    fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('every pane transcript provides SESSION_CONTEXT; token is 360 when splitDisplayed, null in single focus; canvas detail transcript does not provide HIDE_AGENT_SIDEBAR', () => {
    @Component({
      standalone: true,
      imports: [CanvasDetailTranscriptComponent],
      providers: [RailTranscriptRetentionCoordinator],
      template:
        '<ptah-canvas-detail-transcript tabId="a" [splitDisplayed]="splitDisplayed()" [paneFocused]="paneFocused()" />',
    })
    class BoardHostStub {
      readonly splitDisplayed = signal(false);
      readonly paneFocused = signal(true);
    }
    TestBed.configureTestingModule({
      imports: [BoardHostStub],
      providers: [
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: {
            visibleTabIds: signal<ReadonlySet<string>>(new Set()),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
          },
        },
      ],
    });
    TestBed.overrideComponent(SessionEmbedComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(BoardHostStub);
    fixture.detectChanges();
    const transcript = fixture.debugElement.children[0]
      .componentInstance as CanvasDetailTranscriptComponent;
    const injector = transcript.childInjector;
    expect(injector.get(SESSION_CONTEXT)()).toBe('a');
    expect(injector.get(RailTranscriptRetentionCoordinator)).toBe(
      fixture.debugElement.injector.get(RailTranscriptRetentionCoordinator),
    );
    expect(injector.get(RAIL_MIN_CONTENT_WIDTH)()).toBeNull();
    expect(injector.get(HIDE_AGENT_SIDEBAR, null)).toBeNull();
    fixture.componentInstance.splitDisplayed.set(true);
    fixture.componentInstance.paneFocused.set(false);
    fixture.detectChanges();
    expect(injector.get(RAIL_MIN_CONTENT_WIDTH)()).toBe(360);
    expect(injector.get(SESSION_VISIBLE)()).toBe(true);
    expect(injector.get(SESSION_FOCUSED)()).toBe(false);
  });
});
