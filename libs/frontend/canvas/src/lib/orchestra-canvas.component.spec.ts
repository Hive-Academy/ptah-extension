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

import { DeferBlockState, TestBed, type ComponentFixture } from '@angular/core/testing';
import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
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
async function completeDeferBlocks(fixture: ComponentFixture<unknown>): Promise<void> {
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
}
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { ActivityTickerComponent } from '@ptah-extension/chat-ui';
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
      canAddTile: signal(true),
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
            useValue: { flush: persistenceFlushMock },
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
    const resolve = jest.fn();

    canvasTabRequests$.set([
      { tabId: 'tab-77', workspacePath: null, name: 'TASK_2026_300', resolve },
    ]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-77');
    expect(canvasStoreMock.focusTile).toHaveBeenCalledWith('tab-77');
    expect(canvasTabRequests$()).toEqual([]);
    expect(resolve).toHaveBeenCalledWith(true);
  });

  it('canvasTabRequests effect does NOT focus when adoptTab returns null (tile cap hit)', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue(null);
    const fixture = mount();
    const resolve = jest.fn();

    canvasTabRequests$.set([{ tabId: 'tab-88', workspacePath: null, resolve }]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-88');
    expect(canvasStoreMock.focusTile).not.toHaveBeenCalled();
    // Still drained so a stale request never re-fires.
    expect(canvasTabRequests$()).toEqual([]);
    // The refusal is reported so the caller can skip its prefill.
    expect(resolve).toHaveBeenCalledWith(false);
  });

  it('settles true when adoptTab returns null at the cap but the tab is already a tile', () => {
    (canvasStoreMock.adoptTab as jest.Mock).mockReturnValue(null);
    (
      canvasStoreMock.tiles as WritableSignal<
        Array<{
          tabId: string;
          order: number;
          width: { kind: 'auto'; weight: number };
          rowBreakBefore: boolean;
        }>
      >
    ).set([
      {
        tabId: 'tab-89',
        order: 0,
        width: { kind: 'auto', weight: 1 },
        rowBreakBefore: false,
      },
    ]);
    const fixture = mount();
    const resolve = jest.fn();

    canvasTabRequests$.set([{ tabId: 'tab-89', workspacePath: null, resolve }]);
    flush();
    fixture.detectChanges();

    expect(resolve).toHaveBeenCalledWith(true);
  });

  it('settles a request whose adoptTab throws as false and still adopts the next request', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      (canvasStoreMock.adoptTab as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('adopt failed');
        })
        .mockReturnValueOnce('tab-91');
      const fixture = mount();
      const failedResolve = jest.fn();
      const nextResolve = jest.fn();

      canvasTabRequests$.set([
        { tabId: 'tab-90', workspacePath: null, resolve: failedResolve },
        { tabId: 'tab-91', workspacePath: null, resolve: nextResolve },
      ]);
      flush();
      fixture.detectChanges();

      expect(failedResolve).toHaveBeenCalledWith(false);
      expect(canvasStoreMock.adoptTab).toHaveBeenCalledWith('tab-91');
      expect(canvasStoreMock.focusTile).toHaveBeenCalledWith('tab-91');
      expect(nextResolve).toHaveBeenCalledWith(true);
      expect(consoleError).toHaveBeenCalledWith(
        '[OrchestraCanvas] Failed to adopt queued tab tile',
        'adopt failed',
      );
    } finally {
      consoleError.mockRestore();
    }
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
    const resolve = jest.fn();

    canvasTabRequests$.set([
      { tabId: 'tab-a', workspacePath: '/ws/a', resolve },
    ]);
    flush();
    fixture.detectChanges();

    expect(canvasStoreMock.adoptTab).not.toHaveBeenCalled();
    expect(canvasStoreMock.focusTile).not.toHaveBeenCalled();
    // Dropped, not kept: the queue is still fully drained.
    expect(canvasTabRequests$()).toEqual([]);
    expect(resolve).toHaveBeenCalledWith(false);
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
  let activityItems: WritableSignal<readonly ActivityItem[]>;
  let activityIdle: WritableSignal<boolean>;
  let setCurrentViewMock: jest.Mock;

  function activityItem(id: string, summary: string): ActivityItem {
    return {
      id,
      source: 'cron',
      kind: 'cron-run',
      summary,
      timestamp: 1,
      level: 'info',
    };
  }

  function dock() {
    return fixture.debugElement.query(By.css('[data-testid="canvas-dock"]'));
  }

  function ticker() {
    return fixture.debugElement.query(By.directive(ActivityTickerComponent));
  }

  beforeEach(() => {
    const initialTab = createMockTabState('tab 1');
    tabsSignal = signal<TabState[]>([initialTab]);
    observeSpy = jest.fn();
    activityItems = signal<readonly ActivityItem[]>([]);
    activityIdle = signal(true);
    setCurrentViewMock = jest.fn();

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
      setCurrentView: setCurrentViewMock,
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
          useValue: { recent: activityItems, isIdle: activityIdle },
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
          ActivityTickerComponent,
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
                board: { mode: 'rail', railCollapsed: false, railDensity: 'comfortable', railScrollTop: 0 },
                writable: true,
                needsWrite: false,
                readOnlyReason: null,
              })),
              writeFailed: signal(false),
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

  it('disables the New Session trigger and exposes its reason at nine running sessions', () => {
    const existingTabId = tabsSignal()[0].id;
    const runningTabs = Array.from({ length: 9 }, (_, index) => ({
      ...createMockTabState(
        `running-${index}`,
        index === 0 ? existingTabId : TabId.create(),
      ),
      claudeSessionId: SessionId.from(
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      ),
      status: 'streaming' as const,
    }));
    tabsSignal.set(runningTabs);
    for (const tab of runningTabs.slice(1)) {
      fixture.componentInstance.canvasStore.adoptTab(tab.id);
    }
    expect(fixture.componentInstance.canvasStore.runningSessionCount()).toBe(9);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      'button[aria-label="Add new session tile"]',
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.title).toBe(
      '9 sessions are running. Wait for one to finish to start another.',
    );
    expect(trigger.getAttribute('aria-describedby')).toBe(
      'canvas-running-cap-reason',
    );
    const reason = fixture.nativeElement.querySelector(
      '#canvas-running-cap-reason',
    ) as HTMLElement | null;
    expect(reason).not.toBeNull();
    expect(reason?.textContent?.trim()).toBe(trigger.title);
    expect(
      trigger.closest('ptah-native-popover')?.getAttribute('tabindex'),
    ).toBe('0');
  });

  it('renders reserved dock outside the session viewport when tiles are present', () => {
    const dock = fixture.debugElement.query(
      By.css('[data-testid="canvas-dock"]'),
    );
    const viewport = fixture.debugElement.query(
      By.css('[data-testid="session-viewport"]'),
    );

    expect(dock).toBeTruthy();
    expect(viewport).toBeTruthy();

    // Dock is not inside session-viewport; it is a sibling above it
    expect(viewport.nativeElement.contains(dock.nativeElement)).toBe(false);
    expect(dock.nativeElement.parentElement).toBe(
      viewport.nativeElement.parentElement,
    );
  });

  it('reserves the queue trigger footprint with a hidden placeholder until the queue loads', async () => {
    const dock = fixture.debugElement.query(By.css('[data-testid="canvas-dock"]'));
    const placeholder = dock.nativeElement.querySelector('span.btn.invisible[aria-hidden="true"]');
    expect(placeholder).not.toBeNull();
    expect(dock.query(By.directive(NeedsYouQueueStub))).toBeNull();
    await completeDeferBlocks(fixture);
    expect(dock.query(By.directive(NeedsYouQueueStub))).not.toBeNull();
    expect(dock.nativeElement.querySelector('span.btn.invisible')).toBeNull();
  });

  it('shares reserved dock between the queue and the New Session anchor, with no Grid controls', async () => {
    await completeDeferBlocks(fixture);
    const dock = fixture.debugElement.query(
      By.css('[data-testid="canvas-dock"]'),
    );
    const queue = dock.query(By.directive(NeedsYouQueueStub));
    const newSessionBtn = dock.query(
      By.css('button[title="Add new session tile"]'),
    );
    expect(queue).toBeTruthy();
    expect(newSessionBtn).toBeTruthy();
    expect(
      queue.nativeElement.compareDocumentPosition(newSessionBtn.nativeElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      dock.nativeElement.querySelector(
        'ptah-canvas-layout-controls, ptah-canvas-board-toggle',
      ),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-native-popover'),
    ).toHaveLength(1);
  });

  it('mounts only the Rail board in the session viewport', () => {
    const viewport = fixture.debugElement.query(
      By.css('[data-testid="session-viewport"]'),
    );
    expect(viewport.queryAll(By.directive(RailBoardStub))).toHaveLength(1);
    expect(
      viewport.nativeElement.querySelector(
        'ptah-canvas-workspace-grid, ptah-canvas-empty-state, ptah-canvas-detail-panel',
      ),
    ).toBeNull();
  });

  it('does not have permanent absolute overlay controls over the session viewport', () => {
    const overlays = fixture.debugElement.queryAll(
      By.css(
        '.session-viewport > .absolute.top-3, .session-viewport > .absolute.bottom-4, .session-viewport > .absolute.bottom-20',
      ),
    );
    expect(overlays).toHaveLength(0);
  });

  it('observes the sessionViewport element instead of outer container', () => {
    const viewport = fixture.debugElement.query(
      By.css('[data-testid="session-viewport"]'),
    );
    expect(observeSpy).toHaveBeenCalledWith(viewport.nativeElement);
  });

  /**
   * Activity ticker placement (TASK_2026_405 follow-up). The ticker used to be
   * a fixed toast in the top-right corner that published its own width, and
   * the dock padded its right edge from that width — so every arriving message
   * moved the Layout and New Session buttons. It now sits in this row, in
   * normal flow, on the free left edge.
   */
  it('renders the ticker inside the dock, before the queue', async () => {
    await completeDeferBlocks(fixture);
    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    const tickerEl = ticker();
    expect(tickerEl).toBeTruthy();
    expect(dock().nativeElement.contains(tickerEl.nativeElement)).toBe(true);

    // DOM order decides the visual order: ticker first, controls after it.
    const controls = dock().query(By.directive(NeedsYouQueueStub));
    expect(
      tickerEl.nativeElement.compareDocumentPosition(controls.nativeElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('never positions the ticker with fixed or absolute placement', () => {
    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    const classes = ticker().nativeElement.parentElement?.className ?? '';
    expect(classes).not.toContain('fixed');
    expect(classes).not.toContain('absolute');
    // The left cell absorbs all spare width, so the right controls cannot move.
    expect(classes).toContain('flex-1');
    expect(classes).toContain('min-w-0');
  });

  it('keeps the dock free of any width reservation for the ticker', () => {
    const dockEl = dock().nativeElement as HTMLElement;
    expect(dockEl.getAttribute('style') ?? '').not.toContain('padding-right');
    expect(dockEl.className).not.toContain('justify-end');
  });

  it('drops the ticker while idle and brings it back on the next message', () => {
    expect(ticker()).toBeNull();

    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();
    expect(ticker()).toBeTruthy();

    activityIdle.set(true);
    fixture.detectChanges();
    expect(ticker()).toBeNull();
  });

  it('opens Thoth when the dock ticker is clicked', () => {
    activityIdle.set(false);
    activityItems.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    const line = ticker().nativeElement.querySelector(
      '[data-testid="activity-ticker-line"]',
    );
    expect(line?.textContent?.trim()).toBe('Backup finished');

    ticker().nativeElement.querySelector('button')?.click();
    expect(setCurrentViewMock).toHaveBeenCalledWith('thoth');
  });
});
