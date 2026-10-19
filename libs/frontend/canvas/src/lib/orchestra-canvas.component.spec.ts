/**
 * OrchestraCanvasComponent — workspace-aware effect coverage.
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div>{{ data }}</div>`,
  })
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

import {
  DeferBlockState,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';
import {
  ApplicationRef,
  signal,
  input,
  output,
  type WritableSignal,
} from '@angular/core';
import { By } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { SessionId, TabId } from '@ptah-extension/shared';
import type { TabState } from '@ptah-extension/chat-types';
import { OrchestraCanvasComponent } from './orchestra-canvas.component';
import { CanvasStore } from './canvas.store';
import { CanvasDetailService } from './canvas-detail/canvas-detail.service';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';
import { NativePopoverComponent } from '@ptah-extension/ui';

@Component({
  selector: 'ptah-canvas-needs-you-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class NeedsYouQueueStub {}

/** The needs-you queue loads in a lazy `@defer (on idle)` chunk; render it now. */
async function completeDeferBlocks(
  fixture: ComponentFixture<unknown>,
): Promise<void> {
  for (const block of await fixture.getDeferBlocks()) {
    await block.render(DeferBlockState.Complete);
  }
}
@Component({
  selector: 'ptah-canvas-rail-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class RailBoardStub {
  @Input() workspacePath = '';
  @Input() visible = false;
  readonly notice = input(null);
  readonly noticeDismissed = output<string>();
  readonly newSessionRequested = output<HTMLElement>();
}
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  AppStateManager,
  BackOfficeActivityService,
  type ActivityItem,
  type CanvasSessionRequest,
  type CanvasFocusRequest,
  type CanvasTabRequest,
} from '@ptah-extension/core';

/** Idle activity stub for the describes that do not exercise the ticker. */
function idleActivityStub() {
  return {
    provide: BackOfficeActivityService,
    useValue: {
      recent: signal<readonly ActivityItem[]>([]),
      isIdle: signal(true),
    },
  };
}

function createMockTabState(
  name: string,
  id: TabId = TabId.create(),
): TabState {
  return {
    id,
    claudeSessionId: null,
    name,
    title: name,
    order: 0,
    status: 'loaded',
    isDirty: false,
    lastActivityAt: 0,
    messages: [],
    streamingState: null,
  };
}

describe('OrchestraCanvasComponent workspace effects', () => {
  let activeWorkspacePath$: ReturnType<typeof signal<string | null>>;
  let removedWorkspace$: ReturnType<
    typeof signal<{ path: string; seq: number } | null>
  >;
  let tabsSignal: ReturnType<
    typeof signal<
      Array<{ id: string; claudeSessionId: string | null; name: string }>
    >
  >;
  let closedTab$: ReturnType<
    typeof signal<{
      tabId: string;
      sessionId: string | null;
      kind: string;
    } | null>
  >;
  let switchWorkspaceTilesMock: jest.Mock;
  let removeWorkspaceTileStateMock: jest.Mock;
  let removeTileOnlyMock: jest.Mock;
  let removeTileFromAnyWorkspaceMock: jest.Mock;
  let forceCloseTabMock: jest.Mock;
  let hydrateWorkspaceMock: jest.Mock;
  let persistenceFlushMock: jest.Mock;
  let canvasSessionRequests$: WritableSignal<readonly CanvasSessionRequest[]>;
  let takeCanvasSessionRequestsMock: jest.Mock;
  let canvasFocusRequests$: WritableSignal<readonly CanvasFocusRequest[]>;
  let canvasTabRequests$: WritableSignal<readonly CanvasTabRequest[]>;
  let takeCanvasTabRequestsMock: jest.Mock;
  let onTabClosedMock: jest.Mock;
  let switchSessionMock: jest.Mock;
  let canvasStoreMock: CanvasStore;
  let canStartRunningSession: ReturnType<typeof signal<boolean>>;
  let canAddTile: ReturnType<typeof signal<boolean>>;
  let writeFailed: ReturnType<typeof signal<boolean>>;
  let writeFailureCount: ReturnType<typeof signal<number>>;
  let newCanvasSessionRequest: WritableSignal<string | null>;

  function mount() {
    const fixture = TestBed.createComponent(OrchestraCanvasComponent);
    fixture.detectChanges();
    return fixture;
  }

  function flush(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  beforeEach(() => {
    activeWorkspacePath$ = signal<string | null>(null);
    removedWorkspace$ = signal<{ path: string; seq: number } | null>(null);
    closedTab$ = signal<{
      tabId: string;
      sessionId: string | null;
      kind: string;
    } | null>(null);
    tabsSignal = signal<
      Array<{ id: string; claudeSessionId: string | null; name: string }>
    >([]);
    switchWorkspaceTilesMock = jest.fn();
    removeWorkspaceTileStateMock = jest.fn();
    removeTileOnlyMock = jest.fn();
    removeTileFromAnyWorkspaceMock = jest.fn();
    forceCloseTabMock = jest.fn();
    hydrateWorkspaceMock = jest.fn();
    persistenceFlushMock = jest.fn();
    canvasSessionRequests$ = signal<readonly CanvasSessionRequest[]>([]);
    canvasFocusRequests$ = signal<readonly CanvasFocusRequest[]>([]);
    takeCanvasSessionRequestsMock = jest.fn(() => {
      const requests = canvasSessionRequests$();
      if (requests.length > 0) {
        canvasSessionRequests$.set([]);
      }
      return requests;
    });
    canvasTabRequests$ = signal<readonly CanvasTabRequest[]>([]);
    takeCanvasTabRequestsMock = jest.fn(() => {
      const requests = canvasTabRequests$();
      if (requests.length > 0) {
        canvasTabRequests$.set([]);
      }
      return requests;
    });
    onTabClosedMock = jest.fn(() => jest.fn());
    canStartRunningSession = signal(true);
    canAddTile = signal(true);
    writeFailed = signal(false);
    writeFailureCount = signal(0);
    newCanvasSessionRequest = signal<string | null>(null);

    const tabManagerMock = {
      tabs: tabsSignal,
      activeTabId: signal<string | null>(null),
      activeWorkspacePath$,
      removedWorkspace$,
      closedTab: closedTab$,
      onTabClosed: onTabClosedMock,
      forceCloseTab: forceCloseTabMock,
      findTabByIdAcrossWorkspaces: jest.fn((tabId: string) => {
        const tab = tabsSignal().find((candidate) => candidate.id === tabId);
        return tab ? { tab, workspacePath: '/ws' } : null;
      }),
      findTabBySessionIdAcrossWorkspaces: jest.fn((sessionId: string) => {
        const tab = tabsSignal().find(
          (candidate) => candidate.claudeSessionId === sessionId,
        );
        return tab ? { tab, workspacePath: '/ws' } : null;
      }),
    } as unknown as TabManagerService;

    canvasStoreMock = {
      tiles: signal<
        Array<{
          tabId: string;
          order: number;
          width: { kind: 'auto'; weight: number };
          rowBreakBefore: boolean;
        }>
      >([]),
      focusedTabId: signal<string | null>(null),
      tileCount: signal(0),
      canAddTile,
      canStartRunningSession,
      workspacePaths: signal<string[]>([]),
      activeWorkspacePath: signal<string | null>(null),
      switchWorkspaceTiles: switchWorkspaceTilesMock,
      removeWorkspaceTileState: removeWorkspaceTileStateMock,
      removeTileOnly: removeTileOnlyMock,
      removeTileFromAnyWorkspace: removeTileFromAnyWorkspaceMock,
      hydrateWorkspace: hydrateWorkspaceMock,
      addTileFromSession: jest.fn(),
      addTile: jest.fn(),
      adoptTab: jest.fn(),
      focusTile: jest.fn(),
      removeTile: jest.fn(),
      reorderTiles: jest.fn(),
    } as unknown as CanvasStore;

    const layoutServiceMock = {
      observe: jest.fn(),
      containerWidth: signal(0),
    } as unknown as CanvasLayoutService;

    switchSessionMock = jest.fn().mockResolvedValue(undefined);
    const chatStoreMock = {
      switchSession: switchSessionMock,
    } as unknown as ChatStore;

    const appStateMock = {
      canvasSessionRequests: canvasSessionRequests$,
      takeCanvasSessionRequests: takeCanvasSessionRequestsMock,
      canvasFocusRequests: canvasFocusRequests$,
      takeCanvasFocusRequests: jest.fn((workspacePath: string) => {
        const matching = canvasFocusRequests$().filter(
          (request) => request.target.workspacePath === workspacePath,
        );
        canvasFocusRequests$.set(
          canvasFocusRequests$().filter(
            (request) => request.target.workspacePath !== workspacePath,
          ),
        );
        return matching;
      }),
      newCanvasSessionRequest,
      canvasTabRequests: canvasTabRequests$,
      takeCanvasTabRequests: takeCanvasTabRequestsMock,
      clearNewCanvasSessionRequest: jest.fn(),
    } as unknown as AppStateManager;

    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: ChatStore, useValue: chatStoreMock },
        { provide: AppStateManager, useValue: appStateMock },
        {
          provide: AgentMonitorStore,
          useValue: { agents: signal([]), subagents: signal(new Map()) },
        },
        idleActivityStub(),
      ],
    });
    TestBed.overrideComponent(OrchestraCanvasComponent, {
      set: {
        template: '',
        imports: [],
        providers: [
          { provide: CanvasStore, useValue: canvasStoreMock },
          CanvasDetailService,
          { provide: CanvasLayoutService, useValue: layoutServiceMock },
          {
            provide: CanvasLayoutPersistenceService,
            useValue: {
              flush: persistenceFlushMock,
              writeFailed,
              writeFailureCount,
              readOnlyPaths: signal(new Set<string>()),
            },
          },
        ],
      },
    });
  });

  it('refuses new-session requests at nine running and clears the message when a slot frees', () => {
    const fixture = mount();
    canStartRunningSession.set(false);
    newCanvasSessionRequest.set('new');
    flush();
    fixture.detectChanges();
    expect(canvasStoreMock.addTile).not.toHaveBeenCalled();
    expect(
      TestBed.inject(AppStateManager).clearNewCanvasSessionRequest,
    ).toHaveBeenCalled();
    expect(
      (
        fixture.componentInstance as unknown as {
          headerMessage: () => string | null;
        }
      ).headerMessage(),
    ).toBe('9 sessions are running. Wait for one to finish to start another.');
    canStartRunningSession.set(true);
    flush();
    fixture.detectChanges();
    expect(
      (
        fixture.componentInstance as unknown as {
          headerMessage: () => string | null;
        }
      ).headerMessage(),
    ).toBeNull();
  });

  it('refuses popover creation at the running cap', () => {
    const fixture = mount();
    canStartRunningSession.set(false);
    (
      fixture.componentInstance as unknown as {
        handleCreateSession: () => void;
      }
    ).handleCreateSession();
    expect(canvasStoreMock.addTile).not.toHaveBeenCalled();
    expect(
      (
        fixture.componentInstance as unknown as {
          headerMessage: () => string | null;
        }
      ).headerMessage(),
    ).toBe('9 sessions are running. Wait for one to finish to start another.');
  });

  it('does not move focus when the tile bound is reached with the popover closed', () => {
    const fixture = mount();
    const anchor = document.createElement('button');
    const composer = document.createElement('input');
    document.body.append(anchor, composer);
    try {
      Reflect.apply(Reflect.get(fixture.componentInstance, 'openNewSessionPopover'), fixture.componentInstance, [anchor]);
      Reflect.apply(Reflect.get(fixture.componentInstance, 'handleCancelSession'), fixture.componentInstance, []);
      composer.focus();
      canAddTile.set(false);
      fixture.detectChanges();
      expect(document.activeElement).toBe(composer);
    } finally {
      anchor.remove();
      composer.remove();
    }
  });

  it('refreshes the blocked-create notice even when the reason repeats', () => {
    const fixture = mount();
    canStartRunningSession.set(false);
    const anchor = document.createElement('button');
    const instance = fixture.componentInstance;
    const open = () => Reflect.apply(Reflect.get(instance, 'openNewSessionPopover'), instance, [anchor]);
    const notice = () => Reflect.get(instance, 'boardNotice')();
    open();
    const firstKey = notice()?.key;
    expect(firstKey).toBeTruthy();
    Reflect.apply(Reflect.get(instance, 'dismissNotice'), instance, [firstKey]);
    expect(notice()).toBeNull();
    open();
    expect(notice()?.key).not.toBe(firstKey);
  });

  it('shows a dismissed write-failure notice after another failed write', () => {
    const fixture = mount();
    const instance = fixture.componentInstance;
    const notice = () => Reflect.get(instance, 'boardNotice')() as { key: string } | null;
    writeFailed.set(true);
    flush();
    const firstKey = notice()?.key;
    expect(firstKey).toBeTruthy();
    Reflect.apply(Reflect.get(instance, 'dismissNotice'), instance, [firstKey]);
    expect(notice()).toBeNull();
    writeFailureCount.update((count) => count + 1);
    flush();
    expect(writeFailed()).toBe(true);
    expect(notice()?.key).not.toBe(firstKey);
  });

  it('workspace-swap effect calls switchWorkspaceTiles with new path and current tabs', () => {
    const tabs = [
      { id: 'tab-1', claudeSessionId: 'sess-1', name: 't1' },
      { id: 'tab-2', claudeSessionId: 'sess-2', name: 't2' },
    ];
    tabsSignal.set(tabs);

    const fixture = mount();

    activeWorkspacePath$.set('/ws/a');
    flush();
    fixture.detectChanges();

    expect(switchWorkspaceTilesMock).toHaveBeenCalledWith('/ws/a', tabs);
  });

  it('tears down its tab-close subscription on destroy', () => {
    const fixture = mount();
    const unsubscribe = onTabClosedMock.mock.results[0].value as jest.Mock;

    fixture.destroy();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('removed-workspace effect calls removeWorkspaceTileState once per append-only emission', () => {
    const fixture = mount();

    removedWorkspace$.set({ path: '/ws/gone', seq: 1 });
    flush();
    fixture.detectChanges();

    expect(removeWorkspaceTileStateMock).toHaveBeenCalledWith('/ws/gone');
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledTimes(1);

    // Re-flushing the same (never-cleared) emission must not re-process it.
    flush();
    fixture.detectChanges();
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledTimes(1);

    // A new removal (higher seq) is processed exactly once more.
    removedWorkspace$.set({ path: '/ws/other', seq: 2 });
    flush();
    fixture.detectChanges();
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledWith('/ws/other');
    expect(removeWorkspaceTileStateMock).toHaveBeenCalledTimes(2);
  });

  it('workspace-swap effect runs before tab-removal effect on the same tick', () => {
    const order: string[] = [];
    switchWorkspaceTilesMock.mockImplementation(() => order.push('swap'));
    removeTileOnlyMock.mockImplementation(() => order.push('remove'));

    const fixture = mount();

    activeWorkspacePath$.set('/ws/a');
    tabsSignal.set([]);
    flush();
    fixture.detectChanges();

    expect(order).toContain('swap');
    if (order.includes('remove')) {
      expect(order.indexOf('swap')).toBeLessThan(order.indexOf('remove'));
    }
  });

  it('closed-tab effect removes the tile from any workspace on a real close', () => {
    const fixture = mount();
    const listener = onTabClosedMock.mock.calls[0][0] as (event: {
      tabId: string;
      sessionId: string | null;
      kind: string;
    }) => void;

    listener({ tabId: 'tab-9', sessionId: 'sess-9', kind: 'close' });
    fixture.detectChanges();

    expect(removeTileFromAnyWorkspaceMock).toHaveBeenCalledWith('tab-9');
  });

  it('closed-tab effect ignores reset events (tab survives in place)', () => {
    const fixture = mount();
    const listener = onTabClosedMock.mock.calls[0][0] as (event: {
      tabId: string;
      sessionId: string | null;
      kind: string;
    }) => void;

    listener({ tabId: 'tab-9', sessionId: 'sess-9', kind: 'reset' });
    fixture.detectChanges();

    expect(removeTileFromAnyWorkspaceMock).not.toHaveBeenCalled();
  });

  it('canvasTabRequests effect adopts the tab as a tile, focuses it, and drains the queue (F-D3)', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue('tab-77');
    const fixture = mount();

    canvasTabRequests$.set([
      { tabId: 'tab-77', workspacePath: null, name: 'TASK_2026_300' },
    ]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-77');
    expect(canvasStoreMock.focusTile).toHaveBeenCalledWith('tab-77');
    expect(canvasTabRequests$()).toEqual([]);
  });

  it('canvasTabRequests effect does NOT focus when adoptTab returns null (tile cap hit)', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue(null);
    const fixture = mount();

    canvasTabRequests$.set([{ tabId: 'tab-88', workspacePath: null }]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-88');
    expect(canvasStoreMock.focusTile).not.toHaveBeenCalled();
    // Still drained so a stale request never re-fires.
    expect(canvasTabRequests$()).toEqual([]);
  });

  // TASK_2026_612: agent-child adoption while the canvas layout is active.
  // A burst — late adoption of several children in one chat:agent-sessions
  // result — must tile every child in one drain, and `focus: false` must
  // append without stealing the active tab.
  it('drains a burst of tab-adoption requests in FIFO order without focusing (agent children)', () => {
    (canvasStoreMock.adoptTab as jest.Mock)
      .mockReturnValueOnce('child-1')
      .mockReturnValueOnce('child-2');
    const fixture = mount();

    canvasTabRequests$.set([
      { tabId: 'child-1', workspacePath: null, name: 'Child 1', focus: false },
      { tabId: 'child-2', workspacePath: null, name: 'Child 2', focus: false },
    ]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledTimes(2);
    expect(canvasStoreMock.adoptTab).toHaveBeenNthCalledWith(1, 'child-1');
    expect(canvasStoreMock.adoptTab).toHaveBeenNthCalledWith(2, 'child-2');
    expect(canvasStoreMock.focusTile).not.toHaveBeenCalled();
    expect(canvasTabRequests$()).toEqual([]);
  });

  // A request queued while the canvas wasn't mounted (another view) carries
  // the workspace that was active at REQUEST time; if the user switched
  // workspace before the canvas drains it, the request is DROPPED, never
  // tiled into the now-active board.
  it('drops a tab-adoption request for a workspace the canvas is not showing', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue('tab-a');
    (canvasStoreMock.activeWorkspacePath as WritableSignal<string | null>).set(
      '/ws/b',
    );
    const fixture = mount();

    canvasTabRequests$.set([{ tabId: 'tab-a', workspacePath: '/ws/a' }]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).not.toHaveBeenCalled();
    expect(canvasStoreMock.focusTile).not.toHaveBeenCalled();
    // Dropped, not kept: the queue is still fully drained.
    expect(canvasTabRequests$()).toEqual([]);
  });

  it('adopts exactly one tile for a same-workspace request', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue('tab-a');
    (canvasStoreMock.activeWorkspacePath as WritableSignal<string | null>).set(
      '/ws/a',
    );
    const fixture = mount();

    canvasTabRequests$.set([
      { tabId: 'tab-a', workspacePath: '/ws/a', focus: false },
    ]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledTimes(1);
    expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-a');
    expect(canvasStoreMock.focusTile).not.toHaveBeenCalled();
    expect(canvasTabRequests$()).toEqual([]);
  });

  it('drains two queued canvas session requests in FIFO order in one tick', async () => {
    const firstSessionId = '00000000-0000-4000-8000-000000000001';
    const secondSessionId = '00000000-0000-4000-8000-000000000002';
    const firstResolve = jest.fn();
    const secondResolve = jest.fn();
    (canvasStoreMock.addTileFromSession as jest.Mock)
      .mockReturnValueOnce('tab-1')
      .mockReturnValueOnce('tab-2');
    const fixture = mount();

    canvasSessionRequests$.set([
      { sessionId: firstSessionId, name: 'One', resolve: firstResolve },
      { sessionId: secondSessionId, name: 'Two', resolve: secondResolve },
    ]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();

    expect(takeCanvasSessionRequestsMock).toHaveBeenCalledTimes(1);
    expect(canvasStoreMock.addTileFromSession).toHaveBeenNthCalledWith(
      1,
      firstSessionId,
      'One',
    );
    expect(canvasStoreMock.addTileFromSession).toHaveBeenNthCalledWith(
      2,
      secondSessionId,
      'Two',
    );
    expect(switchSessionMock).toHaveBeenNthCalledWith(1, firstSessionId);
    expect(switchSessionMock).toHaveBeenNthCalledWith(2, secondSessionId);
    expect(firstResolve).toHaveBeenCalledWith(true);
    expect(secondResolve).toHaveBeenCalledWith(true);
  });

  it('resolves only the second queued request false when the second tile hits the cap', async () => {
    const firstSessionId = '00000000-0000-4000-8000-000000000001';
    const secondSessionId = '00000000-0000-4000-8000-000000000002';
    const firstResolve = jest.fn();
    const secondResolve = jest.fn();
    (canvasStoreMock.addTileFromSession as jest.Mock)
      .mockReturnValueOnce('tab-1')
      .mockReturnValueOnce(null);
    const fixture = mount();

    canvasSessionRequests$.set([
      { sessionId: firstSessionId, resolve: firstResolve },
      { sessionId: secondSessionId, resolve: secondResolve },
    ]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();

    expect(switchSessionMock).toHaveBeenCalledTimes(1);
    expect(switchSessionMock).toHaveBeenCalledWith(firstSessionId);
    expect(firstResolve).toHaveBeenCalledWith(true);
    expect(firstResolve).not.toHaveBeenCalledWith(false);
    expect(secondResolve).toHaveBeenCalledTimes(1);
    expect(secondResolve).toHaveBeenCalledWith(false);
  });

  it('reports a queued session switch failure and resolves that request false', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const resolve = jest.fn();
    const error = new Error('resume failed');
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    (canvasStoreMock.addTileFromSession as jest.Mock).mockReturnValue('tab-1');
    switchSessionMock.mockRejectedValue(error);
    const fixture = mount();

    canvasSessionRequests$.set([{ sessionId, resolve }]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith(false);
    // One request, one tile add, one load, one settle: the failed load does
    // not retry, re-queue or settle twice (Phase 4 visual M2).
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(canvasStoreMock.addTileFromSession).toHaveBeenCalledTimes(1);
    expect(switchSessionMock).toHaveBeenCalledTimes(1);
    expect(takeCanvasSessionRequestsMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[OrchestraCanvas] Failed to open queued session tile',
      error,
    );
    consoleError.mockRestore();
  });

  it('acknowledges cap-reached without loading when notification focus cannot adopt', async () => {
    const resolve = jest.fn();
    tabsSignal.set([
      { id: 'tab-cap', claudeSessionId: 'session-cap', name: 'capped' },
    ]);
    (
      canvasStoreMock.activeWorkspacePath as unknown as WritableSignal<
        string | null
      >
    ).set('/ws');
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue(null);
    const fixture = mount();

    canvasFocusRequests$.set([
      {
        id: 1,
        target: {
          workspacePath: '/ws',
          tabId: 'tab-cap',
          sessionId: 'session-cap',
        },
        resolve,
      },
    ]);
    flush();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith({
      success: false,
      outcome: 'cap-reached',
    });
    expect(switchSessionMock).not.toHaveBeenCalled();
  });

  it('hydrates exact existing tab ids without opening or loading sessions', () => {
    tabsSignal.set([
      { id: 'tab-1', claudeSessionId: 'session-1', name: 'one' },
      { id: 'tab-2', claudeSessionId: null, name: 'two' },
    ]);
    mount();
    expect(hydrateWorkspaceMock).toHaveBeenCalledWith(null, ['tab-1', 'tab-2']);
    expect(canvasStoreMock.addTileFromSession).not.toHaveBeenCalled();
  });

  it('ngOnDestroy flushes persistence and never closes tabs', () => {
    const fixture = mount();

    fixture.destroy();

    expect(persistenceFlushMock).toHaveBeenCalledTimes(1);
    expect(forceCloseTabMock).not.toHaveBeenCalled();
  });
});

describe('OrchestraCanvasComponent dock and viewport allocation', () => {
  let fixture: ReturnType<
    typeof TestBed.createComponent<OrchestraCanvasComponent>
  >;
  let observeSpy: jest.Mock;
  let tabManagerMock: Partial<TabManagerService>;
  let tabsSignal: WritableSignal<TabState[]>;

  beforeEach(() => {
    const initialTab = createMockTabState('tab 1');
    tabsSignal = signal<TabState[]>([initialTab]);
    observeSpy = jest.fn();

    tabManagerMock = {
      tabs: tabsSignal,
      activeTabId: signal<string | null>(initialTab.id),
      activeWorkspacePath$: signal<string | null>('/ws/a'),
      removedWorkspace$: signal<null>(null),
      closedTab: signal<null>(null),
      onTabClosed: jest.fn(() => () => undefined),
      forceCloseTab: jest.fn(),
      switchTab: jest.fn(),
      openSessionTab: jest.fn(),
      createTab: jest.fn(),
      closeTab: jest.fn().mockResolvedValue(undefined),
    };

    const layoutServiceMock = {
      observe: observeSpy,
      containerWidth: signal(1200),
    };

    const chatStoreMock = {
      switchSession: jest.fn().mockResolvedValue(undefined),
    };

    const appStateMock = {
      canvasSessionRequests: signal<readonly CanvasSessionRequest[]>([]),
      takeCanvasSessionRequests: jest.fn(() => []),
      canvasFocusRequests: signal<readonly CanvasFocusRequest[]>([]),
      takeCanvasFocusRequests: jest.fn(() => []),
      newCanvasSessionRequest: signal(null),
      canvasTabRequests: signal<readonly CanvasTabRequest[]>([]),
      takeCanvasTabRequests: jest.fn(() => []),
      clearNewCanvasSessionRequest: jest.fn(),
      thothFirstRunDismissed: () => true,
      dismissThothFirstRun: jest.fn(),
      setCurrentView: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [OrchestraCanvasComponent],
      providers: [
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: ChatStore, useValue: chatStoreMock },
        { provide: AppStateManager, useValue: appStateMock },
        {
          provide: AgentMonitorStore,
          useValue: { agents: signal([]), subagents: signal(new Map()) },
        },
        {
          provide: BackOfficeActivityService,
          useValue: { recent: signal([]), isIdle: signal(true) },
        },
      ],
    });

    TestBed.overrideComponent(OrchestraCanvasComponent, {
      set: {
        imports: [
          FormsModule,
          LucideAngularModule,
          RailBoardStub,
          NeedsYouQueueStub,
          NativePopoverComponent,
        ],
        providers: [
          CanvasStore,
          CanvasDetailService,
          { provide: CanvasLayoutService, useValue: layoutServiceMock },
          {
            provide: CanvasLayoutPersistenceService,
            useValue: {
              load: jest.fn(() => ({
                tiles: null,
                board: {
                  mode: 'rail',
                  railCollapsed: false,
                  railDensity: 'comfortable',
                  railScrollTop: 0,
                },
                writable: true,
                needsWrite: false,
                readOnlyReason: null,
              })),
              writeFailed: signal(false),
              writeFailureCount: signal(0),
              readOnlyPaths: signal(new Set<string>()),
              markHydrated: jest.fn(),
              schedule: jest.fn(),
              remove: jest.fn(),
              flush: jest.fn(),
            },
          },
        ],
      },
    });

    fixture = TestBed.createComponent(OrchestraCanvasComponent);
    fixture.detectChanges();
  });

  it('gives the viewport the full canvas height without the old dock or ticker', () => {
    const viewport = fixture.nativeElement.querySelector(
      '[data-testid="session-viewport"]',
    );
    expect(viewport).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="canvas-dock"], ptah-activity-ticker, [data-testid="canvas-new-session-anchor"]',
      ),
    ).toBeNull();
    expect(observeSpy).toHaveBeenCalledWith(viewport);
    const interactive = fixture.nativeElement.querySelector('[data-testid="canvas-interactive"]');
    expect(interactive).not.toBeNull();
    expect(interactive.querySelector('ptah-canvas-rail-board')).not.toBeNull();
  });

  it('keeps the deferred needs-you chip inside the viewport in flow', async () => {
    const viewport = fixture.debugElement.query(
      By.css('[data-testid="session-viewport"]'),
    );
    expect(
      viewport.nativeElement.querySelector(
        'span.btn.invisible[aria-hidden="true"]',
      ),
    ).not.toBeNull();
    await completeDeferBlocks(fixture);
    const chip = viewport.query(By.directive(NeedsYouQueueStub));
    expect(chip).not.toBeNull();
    expect(chip.nativeElement.parentElement.className).toContain('shrink-0');
    expect(
      viewport.nativeElement.querySelector('span.btn.invisible'),
    ).toBeNull();
  });

  it('keeps the shared popover outside viewport flow without cap-state host attributes', () => {
    const popover = fixture.nativeElement.querySelector(
      'ptah-native-popover',
    ) as HTMLElement;
    expect(popover).not.toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="session-viewport"]')
        .contains(popover),
    ).toBe(false);
    expect(popover.parentElement?.className).toContain('absolute');
    for (const name of [
      'tabindex',
      'role',
      'aria-label',
      'aria-describedby',
      'title',
    ]) {
      expect(popover.hasAttribute(name)).toBe(false);
    }
  });
});
