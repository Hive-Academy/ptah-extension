import { ChangeDetectionStrategy, Component, NgModule, NgZone, input, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('ngx-markdown', () => {
  // eslint-disable-next-line @angular-eslint/component-selector
  @Component({ selector: 'markdown', standalone: true, template: '' })
  class MarkdownStubComponent {}
  @NgModule({ imports: [MarkdownStubComponent], exports: [MarkdownStubComponent] })
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

import { AppStateManager, AuthStateService, ClaudeRpcService, PlanLimitsStore, VSCodeService } from '@ptah-extension/core';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ConfirmationDialogService, ConversationRegistry, TabManagerService, TabSessionBinding } from '@ptah-extension/chat-state';
import { AgentMonitorStore, ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { ChatViewComponent } from './chat-view.component';
import { ChatStore } from '../../services/chat.store';
import { ActionBannerService } from '../../services/action-banner.service';
import { SessionHistoryReplayer } from '../../services/chat-store/session-history-replayer.service';
import { HistoryPagingService } from '../../services/chat-store/history-paging.service';
import { SessionInspectorStore } from '../../services/session-inspector';
import { SESSION_EMBED_CHROME } from '../../tokens/session-embed-chrome.token';
import { SESSION_CONTEXT } from '../../tokens/session-context.token';

@Component({
  selector: 'ptah-chat-transcript',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class TranscriptStubComponent {
  readonly tabId = input.required<string>();
  readonly entering = input(false);
}

function mount(): {
  fixture: ComponentFixture<ChatViewComponent>;
  activeTabId: ReturnType<typeof signal<string | null>>;
  sessionId: ReturnType<typeof signal<string | null>>;
  viewMode: ReturnType<typeof signal<string>>;
} {
  const activeTabId = signal<string | null>('A');
  const sessionId = signal<string | null>(null);
  const viewMode = signal('full');
  const tabs = signal([{ id: 'A' }, { id: 'B' }]);
  const tabManager = {
    activeTabId: activeTabId.asReadonly(),
    activeTab: () => null,
    activeTabSessionId: sessionId.asReadonly(),
    activeTabStatus: signal(null).asReadonly(),
    activeTabViewMode: viewMode.asReadonly(),
    activeTabHasLiveSession: signal(false).asReadonly(),
    pendingSessionLoad: signal(null).asReadonly(),
    visibleTabIds: signal<ReadonlySet<string>>(new Set()).asReadonly(),
    tabs: tabs.asReadonly(),
    streamingTabIds: signal<Set<string>>(new Set()).asReadonly(),
    closedTab: signal(null).asReadonly(),
    onTabClosed: () => jest.fn(),
    removedWorkspace$: signal(null).asReadonly(),
    findTabByIdAcrossWorkspaces: (id: string) => ({ tab: { id }, workspacePath: '/w' }),
    findTabBySessionId: () => null,
    findTabsBySessionId: () => [],
    clearRemovedWorkspace: jest.fn(),
    clearPendingSessionLoad: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [ChatViewComponent],
    providers: [
      provideSurfaceActiveTesting(),
      { provide: SESSION_EMBED_CHROME, useValue: 'bare' },
      { provide: SESSION_CONTEXT, useValue: null },
      { provide: TabManagerService, useValue: tabManager },
      { provide: ChatStore, useValue: {
        isCompactingForTab: () => false,
        currentSessionId: sessionId.asReadonly(),
        sessionIsActive: signal(false).asReadonly(),
        activeTab: signal(null), messages: signal([]),
        isStreaming: signal(false), currentModel: signal('model'),
        sessionStatus: signal(null), queueRestoreContent: signal(null),
        queuedContent: signal(null), unmatchedPermissions: signal([]),
        questionRequests: signal([]), resumableSubagents: signal([]).asReadonly(),
      } },
      { provide: VSCodeService, useValue: { isElectron: false, config: () => ({ workspaceRoot: '/w' }) } },
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: ConfirmationDialogService, useValue: { confirm: jest.fn() } },
      { provide: ActionBannerService, useValue: { banner: signal(null).asReadonly(), showError: jest.fn(), showInfo: jest.fn(), showWarning: jest.fn() } },
      { provide: SessionHistoryReplayer, useValue: { isReplaying: () => false, retirePersistedFilter: jest.fn() } },
      { provide: HistoryPagingService, useValue: { loadOlder: jest.fn(), loadingTabIds: signal<ReadonlySet<string>>(new Set()).asReadonly() } },
      { provide: AgentMonitorStore, useValue: { agents: signal([]).asReadonly(), agentsForSession: () => [], agentsOwnedBySession: () => [], panelOpenRequest: signal({ seq: 0, tabId: null }).asReadonly(), cliOutputDemand: signal([]).asReadonly(), tick: signal(0) } },
      { provide: AppStateManager, useValue: { currentView: signal('chat'), layoutMode: signal('single').asReadonly(), composerPrefillRequest: signal({ seq: 0, text: '', tabId: null }).asReadonly() } },
      { provide: ExecutionTreeBuilderService, useValue: { clearForTab: jest.fn() } },
      { provide: ConversationRegistry, useValue: { getIsCompacting: () => false, compactingConversationIds: signal(new Set<string>()) } },
      { provide: TabSessionBinding, useValue: { getConversationId: () => null } },
      { provide: AuthStateService, useValue: { authRequiredBanner: signal(null), clearAuthRequiredBanner: jest.fn() } },
      { provide: SessionInspectorStore, useValue: { modelFor: () => signal({ needsYouCount: 0 }), reportAnswerMiss: jest.fn(), clearAnswerMiss: jest.fn() } },
      { provide: PlanLimitsStore, useValue: { registerScope: () => ({ id: 1, update: jest.fn(), release: jest.fn() }), snapshot: signal(null).asReadonly(), now: signal(0).asReadonly(), loading: signal(false).asReadonly(), loadError: signal(false).asReadonly(), sessionOwner: () => null } },
    ],
  });
  TestBed.overrideComponent(ChatViewComponent, {
    set: {
      imports: [TranscriptStubComponent],
      template: `@for (tabId of ['A', 'B']; track tabId) {
        <ptah-chat-transcript [tabId]="tabId" [entering]="tabId === enteringTabId()" />
      }`,
    },
  });
  const fixture = TestBed.createComponent(ChatViewComponent);
  fixture.detectChanges();
  return { fixture, activeTabId, sessionId, viewMode };
}

describe('ChatView session entrance', () => {
  let fixture: ComponentFixture<ChatViewComponent> | undefined;
  const previousResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    jest.useFakeTimers();
    global.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    TestBed.resetTestingModule();
    jest.useRealTimers();
    global.ResizeObserver = previousResizeObserver;
  });

  function transcripts(): TranscriptStubComponent[] {
    return fixture!.debugElement.queryAll(By.directive(TranscriptStubComponent))
      .map((element) => element.componentInstance as TranscriptStubComponent);
  }

  it('binds entrance to B only after A to B', () => {
    const h = mount(); fixture = h.fixture;
    h.activeTabId.set('B'); fixture.detectChanges();
    expect(transcripts().map((item) => [item.tabId(), item.entering()])).toEqual([['A', false], ['B', true]]);
    expect(fixture.nativeElement.classList.contains('is-entering')).toBe(true);
  });

  it('does not replay for a view-mode change or first session id on the same tab', () => {
    const h = mount(); fixture = h.fixture;
    jest.advanceTimersByTime(400); fixture.detectChanges();
    h.viewMode.set('compact'); h.sessionId.set('session-A'); fixture.detectChanges();
    expect(transcripts().every((item) => !item.entering())).toBe(true);
    expect(fixture.nativeElement.classList.contains('is-entering')).toBe(false);
  });

  it('clears at 400 ms', () => {
    const h = mount(); fixture = h.fixture;
    jest.advanceTimersByTime(399); fixture.detectChanges();
    expect(transcripts()[0].entering()).toBe(true);
    jest.advanceTimersByTime(1); fixture.detectChanges();
    expect(transcripts()[0].entering()).toBe(false);
  });

  it('cancels the live entrance timer on destroy', () => {
    const setSpy = jest.spyOn(global, 'setTimeout');
    const h = mount(); fixture = h.fixture;
    h.activeTabId.set('B'); fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { enteringTabId(): string | null };
    expect(component.enteringTabId()).toBe('B');
    const call = setSpy.mock.calls.map((args, i) => ({ args, id: setSpy.mock.results[i].value }))
      .filter((c) => c.args[1] === 400).at(-1);
    expect(call).toBeDefined();
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    fixture.destroy(); fixture = undefined;
    expect(clearSpy).toHaveBeenCalledWith(call!.id);
    jest.advanceTimersByTime(400);
    expect(component.enteringTabId()).toBe('B');
    setSpy.mockRestore(); clearSpy.mockRestore();
  });

  it('creates each entrance timer outside the Angular zone', () => {
    const h = mount(); fixture = h.fixture;
    const zone = fixture.debugElement.injector.get(NgZone);
    const runOutside = zone.runOutsideAngular.bind(zone);
    const originalSetTimeout = global.setTimeout.bind(global);
    let outsideDepth = 0;
    let timerOutside = false;
    jest.spyOn(zone, 'runOutsideAngular').mockImplementation((fn) => runOutside(() => {
      outsideDepth++;
      try { return fn(); } finally { outsideDepth--; }
    }));
    const setSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((...args: Parameters<typeof setTimeout>) => {
      if (args[1] === 400) timerOutside = outsideDepth > 0;
      return originalSetTimeout(...args);
    }) as typeof setTimeout);
    h.activeTabId.set('B'); fixture.detectChanges();
    expect(timerOutside).toBe(true);
    setSpy.mockRestore();
  });

  it('restarts one timer for rapid A to B to A', () => {
    const h = mount(); fixture = h.fixture;
    h.activeTabId.set('B'); fixture.detectChanges();
    jest.advanceTimersByTime(200);
    h.activeTabId.set('A'); fixture.detectChanges();
    jest.advanceTimersByTime(200); fixture.detectChanges();
    expect(transcripts().map((item) => item.entering())).toEqual([true, false]);
    jest.advanceTimersByTime(200); fixture.detectChanges();
    expect(transcripts().every((item) => !item.entering())).toBe(true);
  });

  it('keeps the production transcript binding', () => {
    const template = readFileSync(join(__dirname, 'chat-view.component.html'), 'utf8');
    expect(template).toContain('[entering]="tabId === enteringTabId()"');
  });
});
