import { Component, input, output } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  DisplayPanelComponent,
  type DisplayPanelViewStateChange,
  type DisplaySurface,
} from '@ptah-extension/chat-ui/display-panel';
import type { TurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ArtifactRecord } from '@ptah-extension/shared';
import {
  toWire,
  type DisplayWindowView,
} from '../../../services/display-window/display-window-wire';
import { DisplayWindowComponent } from './display-window.component';
import { DisplayWindowStateHandler } from './display-window-state.handler';

const artifact: ArtifactRecord = {
  id: 'abcdefghijklmnop',
  title: 'Preview',
  revision: 1,
  sessionId: 'tab-1',
  viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
  createdAt: '2026-10-20T12:00:00.000Z',
};

@Component({ selector: 'ptah-display-panel', standalone: true, template: '' })
class StubPanel {
  readonly surfaces = input<readonly DisplaySurface[]>([]);
  readonly artifacts = input<readonly ArtifactRecord[]>([]);
  readonly open = input(true);
  readonly fullscreenArtifactId = input<string | null>(null);
  readonly fullscreenChange = output<boolean>();
  readonly summary = input<TurnSummaryModel | null>(null);
  readonly summaryTurnKey = input('');
  readonly selectedKey = input<string | null>(null);
  readonly scrollToSelectedOnMount = input(false);
  readonly pinned = input(false);
  readonly viewStates = input<ReadonlyMap<string, SurfaceViewState>>(new Map());
  readonly actionError = input<string | null>(null);
  readonly selectedKeyChange = output<string>();
  readonly viewStateChange = output<DisplayPanelViewStateChange>();
  readonly openFile = output<string>();
  readonly review = output<void>();
  readonly openExternal = output<string>();
  readonly retryArtifacts = output<void>();
}

function view(partial: Partial<DisplayWindowView> = {}): DisplayWindowView {
  return {
    theme: { name: 'anubis-light', mode: 'light' },
    open: true,
    pinned: true,
    count: 1,
    selectedKey: `artifact:${artifact.id}`,
    scrollToSelectedOnMount: true,
    fullscreenArtifactId: null,
    summary: null,
    summaryTurnKey: '',
    surfaces: [],
    viewStates: new Map(),
    artifacts: [artifact],
    actionError: null,
    notice: null,
    ...partial,
  };
}

type RpcReply = { success: boolean; data?: unknown };

describe('DisplayWindowComponent', () => {
  let replies: Record<string, RpcReply>;
  let call: jest.Mock;

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    replies = {
      'displayWindow:getState': {
        success: true,
        data: { state: { tabId: 'tab-1', revision: 3, state: toWire(view()) } },
      },
      'displayWindow:action': { success: true, data: { relayed: true } },
      'displayWindow:close': { success: true, data: { closed: true } },
      'artifacts:openLink': { success: true, data: { opened: true } },
    };
    call = jest.fn(
      async (method: string) => replies[method] ?? { success: false },
    );
    TestBed.configureTestingModule({
      imports: [DisplayWindowComponent],
      providers: [{ provide: ClaudeRpcService, useValue: { call } }],
    });
    TestBed.overrideComponent(DisplayWindowComponent, {
      remove: { imports: [DisplayPanelComponent] },
      add: { imports: [StubPanel] },
    });
  });

  async function render(): Promise<ComponentFixture<DisplayWindowComponent>> {
    const fixture = TestBed.createComponent(DisplayWindowComponent);
    fixture.detectChanges();
    await settle(fixture);
    return fixture;
  }

  /** The schema chunk loads through a dynamic import Angular does not track. */
  async function settle(
    fixture: ComponentFixture<DisplayWindowComponent>,
  ): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  }

  function host(
    fixture: ComponentFixture<DisplayWindowComponent>,
  ): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function panel(fixture: ComponentFixture<DisplayWindowComponent>): StubPanel {
    return fixture.debugElement.query(By.directive(StubPanel))
      .componentInstance as StubPanel;
  }

  it('pulls the cached state on boot and renders the panel from it', async () => {
    const fixture = await render();
    expect(call).toHaveBeenCalledWith('displayWindow:getState', {});
    const stub = panel(fixture);
    expect(stub.artifacts()).toEqual([artifact]);
    expect(stub.selectedKey()).toBe(`artifact:${artifact.id}`);
    expect(stub.pinned()).toBe(true);
    const title = host(fixture).querySelector(
      '[data-testid="display-window-title"]',
    );
    expect(title?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Display · 1');
  });

  it('applies the snapshot theme to the document root', async () => {
    await render();
    expect(document.documentElement.getAttribute('data-theme')).toBe(
      'anubis-light',
    );
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe(
      'light',
    );
  });

  it('a state push replaces the snapshot', async () => {
    const fixture = await render();
    TestBed.inject(DisplayWindowStateHandler).handleMessage({
      type: 'displayWindow:state',
      payload: {
        tabId: 'tab-1',
        revision: 4,
        state: toWire(view({ selectedKey: 'summary', artifacts: [] })),
      },
    });
    await settle(fixture);
    expect(panel(fixture).selectedKey()).toBe('summary');
    expect(panel(fixture).artifacts()).toEqual([]);
  });

  it('waits, without a panel, until the main window published', async () => {
    replies['displayWindow:getState'] = {
      success: true,
      data: { state: null },
    };
    const fixture = await render();
    expect(fixture.debugElement.query(By.directive(StubPanel))).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="display-window-waiting"]'),
    ).not.toBeNull();
  });

  it('shows an error for an invalid snapshot', async () => {
    replies['displayWindow:getState'] = {
      success: true,
      data: { state: { tabId: 'tab-1', revision: 1, state: { version: 1 } } },
    };
    const fixture = await render();
    expect(
      host(fixture).querySelector('[data-testid="display-window-error"]'),
    ).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(StubPanel))).toBeNull();
  });

  it('turns panel outputs into displayWindow:action for the snapshot tab', async () => {
    const fixture = await render();
    const stub = panel(fixture);
    stub.selectedKeyChange.emit('summary');
    stub.openFile.emit('src/a.ts');
    stub.review.emit();
    stub.fullscreenChange.emit(true);
    stub.fullscreenChange.emit(false);
    const viewState: SurfaceViewState = {
      components: { root: { page: 2 } },
      drafts: {},
    };
    stub.viewStateChange.emit({ surfaceKey: 'id:stats', viewState });

    const actions = call.mock.calls
      .filter(([method]) => method === 'displayWindow:action')
      .map(([, params]) => params);
    expect(actions).toEqual([
      { tabId: 'tab-1', action: { type: 'select', key: 'summary' } },
      { tabId: 'tab-1', action: { type: 'open-file', path: 'src/a.ts' } },
      { tabId: 'tab-1', action: { type: 'review' } },
      { tabId: 'tab-1', action: { type: 'fullscreen-closed' } },
      {
        tabId: 'tab-1',
        action: { type: 'view-state', surfaceKey: 'id:stats', viewState },
      },
    ]);
  });

  it('opens links through artifacts:openLink and reports a refusal', async () => {
    replies['artifacts:openLink'] = { success: true, data: { opened: false } };
    const fixture = await render();
    panel(fixture).openExternal.emit('https://example.com');
    await settle(fixture);
    expect(call).toHaveBeenCalledWith('artifacts:openLink', {
      url: 'https://example.com',
    });
    expect(host(fixture).textContent).toContain('Could not open the link.');
  });

  it('Re-attach sends the attach action', async () => {
    const fixture = await render();
    host(fixture)
      .querySelector<HTMLButtonElement>(
        '[data-testid="display-window-reattach"]',
      )
      ?.click();
    expect(call).toHaveBeenCalledWith('displayWindow:action', {
      tabId: 'tab-1',
      action: { type: 'attach' },
    });
  });

  it('Re-attach before any snapshot closes the window directly', async () => {
    replies['displayWindow:getState'] = {
      success: true,
      data: { state: null },
    };
    const fixture = await render();
    host(fixture)
      .querySelector<HTMLButtonElement>(
        '[data-testid="display-window-reattach"]',
      )
      ?.click();
    expect(call).toHaveBeenCalledWith('displayWindow:close', {});
  });

  it('Retry in the panel pulls the state again', async () => {
    const fixture = await render();
    call.mockClear();
    panel(fixture).retryArtifacts.emit();
    expect(call).toHaveBeenCalledWith('displayWindow:getState', {});
  });
});
