import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output, NO_ERRORS_SCHEMA } from '@angular/core';
import { type ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ChatStore, INSPECTOR_TAB_WIDTH, SendToMessagingComponent, TabManagerService,
} from '@ptah-extension/chat';
import { LoggingService } from '@ptah-extension/core';
import { SplitHandleComponent } from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasInspectorDockComponent } from './canvas-inspector-dock.component';
import { CanvasFocusHeaderComponent } from './canvas-focus-header.component';

@Component({
  selector: 'ptah-send-to-messaging',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<button type="button">Send to messaging</button>',
  host: { '[attr.data-trigger]': 'trigger()' },
})
class MessagingStub {
  readonly tabId = input.required<string>();
  readonly trigger = input<'text' | 'icon'>('text');
}

@Component({
  selector: 'ptah-session-inspector',
  standalone: true,
  template: `@if (presentation() === 'rail') {
      <button
        data-inspector-expand
        aria-expanded="false"
        (click)="expandRequested.emit('agents')"
      >
        Expand
      </button>
      <ng-content select="[inspectorRailControls]" />
    } @else {
      <div [attr.role]="presentation() === 'sheet' ? 'dialog' : null">
        <button
          data-inspector-close
          aria-expanded="true"
          (click)="closeRequested.emit()"
        >
          Close
        </button>
        <ng-content select="[inspectorControls]" />
        <ng-content select="[inspectorSection]" />
        <button data-lane (click)="laneRequested.emit('agent-1')">
          Open lane
        </button>
      </div>
    }`,
})
class InspectorStub {
  readonly tabId = input.required<string>();
  readonly presentation = input('embedded');
  readonly sessionTitle = input('');
  readonly sessionStatus = input('');
  readonly workflow = input<string | null>(null);
  readonly branch = input<string | null>(null);
  readonly selectedAgentKey = input<string | null>();
  readonly focusSection = input<string | null>(null);
  readonly expandRequested = output<
    'session' | 'agents' | 'todos' | undefined
  >();
  readonly hasLaneSurface = input(false);
  readonly stats = input<unknown>(null);
  readonly limitSummary = input<unknown>();
  readonly laneRequested = output<string>();
  readonly closeRequested = output<void>();
}


const DOCK_WIDTH_KEY = 'ptah.inspector-dock-width.v1';

describe('CanvasInspectorDockComponent', () => {
  beforeEach(() => localStorage.removeItem(DOCK_WIDTH_KEY));

  const abort = jest.fn();
  const toggleTabViewMode = jest.fn();
  const logError = jest.fn();
  beforeEach(() => {
    abort.mockReset().mockResolvedValue(undefined);
    toggleTabViewMode.mockReset();
    logError.mockReset();
  });

  function mount(options: { running?: boolean; withControls?: boolean } = {}) {
    TestBed.configureTestingModule({
      imports: [CanvasInspectorDockComponent],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        { provide: ChatStore, useValue: { abortWithConfirmation: abort } },
        { provide: LoggingService, useValue: { error: logError } },
        { provide: CanvasStore, useValue: {
          isSessionRunning: () => options.running ?? false, focusTile: jest.fn(),
        } },
        { provide: TabManagerService, useValue: {
          onTabClosed: () => () => undefined,
          activeTabId: () => 'a',
          toggleTabViewMode,
          findTabByIdAcrossWorkspaces: () => ({ tab: { title: 'Alpha', viewMode: 'full' } }),
        } },
        { provide: CanvasDetailService, useValue: {
          laneKeyFor: () => 'orchestrator', selectLaneFor: jest.fn(),
        } },
      ],
    });
    TestBed.overrideComponent(CanvasInspectorDockComponent, {
      set: {
        imports: [
          InspectorStub, NgTemplateOutlet, SplitHandleComponent,
          ...(options.withControls ? [CanvasFocusHeaderComponent] : []),
        ],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
    TestBed.overrideComponent(CanvasFocusHeaderComponent, {
      remove: { imports: [SendToMessagingComponent] },
      add: { imports: [MessagingStub] },
    });
    const fixture = TestBed.createComponent(CanvasInspectorDockComponent);
    fixture.componentRef.setInput('root', fixture.nativeElement);
    fixture.componentRef.setInput('focusedId', 'a');
    fixture.componentRef.setInput('panelId', 'rail-left-lane-panel');
    fixture.componentRef.setInput('dockShown', true);
    fixture.componentRef.setInput('dockOpen', true);
    fixture.componentRef.setInput('availableWidth', 1096);
    fixture.detectChanges();
    return { fixture };
  }

  /** The compact rail is deferred too: complete every open block, then render. */
  async function completeDeferBlocks(fixture: ComponentFixture<CanvasInspectorDockComponent>) {
    for (const block of await fixture.getDeferBlocks()) {
      await block.render(DeferBlockState.Complete);
    }
    fixture.detectChanges();
  }

  function dockParts(host: HTMLElement) {
    return {
      tab: host.querySelector<HTMLButtonElement>('[data-inspector-expand]'),
      aside: host.querySelector<HTMLElement>('[data-inspector-dock]'),
      separator: host.querySelector<HTMLElement>('[role="separator"]'),
    };
  }

  it.each([900, 400])('uses an overlay at %ipx and occupies only the compact rail', width => {
    const { fixture } = mount();
    fixture.componentRef.setInput('availableWidth', width - 304);
    fixture.detectChanges();
    expect(fixture.componentInstance.overlay()).toBe(true);
    expect(fixture.componentInstance.occupiedWidth()).toBe(56);
    const aside = dockParts(fixture.nativeElement).aside!;
    expect(aside.classList.contains('fixed')).toBe(true);
    expect(aside.style.maxWidth).toBe('100vw');
    expect(dockParts(fixture.nativeElement).separator).toBeNull();
  });

  it('expands and selects the clicked rail agent', () => {
    const { fixture } = mount();
    fixture.componentInstance.closeDock();
    fixture.componentInstance.selectRailAgent('a', 'cli:chosen');
    expect(fixture.componentInstance.dockOpen()).toBe(true);
    expect(fixture.componentInstance.inspectorSection()).toBe('agents');
    expect(TestBed.inject(CanvasDetailService).selectLaneFor).toHaveBeenCalledWith('a', 'cli:chosen');
  });

  it.each(['near', 'at'] as const)('forwards the %s plan limit to the compact rail', async (state) => {
    const { fixture } = mount();
    const limitSummary = { state, text: 'Plan limit', fullText: 'Weekly plan limit', extra: 0, source: 'session' };
    fixture.componentRef.setInput('stats', { limitSummary });
    fixture.componentInstance.closeDock();
    fixture.detectChanges();
    await completeDeferBlocks(fixture);
    const rail = fixture.debugElement.query(By.directive(InspectorStub)).componentInstance as InspectorStub;
    expect(rail.limitSummary()).toEqual(limitSummary);
  });

  it('subtracts the compact 56px exactly once and never saves it as the dock preference', async () => {
    const { fixture } = mount();
    const component = fixture.componentInstance;
    component.dock.preview(400);
    component.dock.commit();
    fixture.detectChanges();
    component.closeDock();
    fixture.detectChanges();
    await completeDeferBlocks(fixture);
    expect(component.occupiedWidth()).toBe(INSPECTOR_TAB_WIDTH);
    expect(component.availableWidth() - component.occupiedWidth()).toBe(1040);
    expect(fixture.nativeElement.querySelector('[data-inspector-rail]').style.width).toBe('56px');
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBe('400');
    component.expandInspector();
    fixture.detectChanges();
    expect(component.availableWidth()).toBe(1096);
    expect(component.dock.maxWidth()).toBe(560);
    expect(component.occupiedWidth()).toBe(400);
    expect(component.availableWidth() - component.occupiedWidth()).toBe(696);
    expect(dockParts(fixture.nativeElement).aside?.style.width).toBe('400px');
    expect(fixture.nativeElement.querySelector('[data-inspector-rail]')).toBeNull();
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBe('400');
  });

  it('closing the compact sheet focuses the rail expand control once its deferred block mounts', async () => {
    const { fixture } = mount();
    const host: HTMLElement = fixture.nativeElement;
    document.body.appendChild(host);
    fixture.componentRef.setInput('dockOpen', false);
    fixture.componentRef.setInput('compactSheet', true);
    fixture.componentRef.setInput('detailsOpen', true);
    fixture.detectChanges();
    expect(host.querySelector('[data-inspector-rail]')).toBeNull();
    fixture.componentInstance.closeCompactSheet();
    fixture.detectChanges();
    await fixture.whenStable();
    // The sheet destroyed the rail's block: it is not mounted yet after the next render.
    expect(host.querySelector('[data-inspector-expand]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await completeDeferBlocks(fixture);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(host.querySelector('[data-inspector-expand]'));
    host.remove();
  });

  it.each(['dock', 'sheet'])('renders exactly one lane selector during and after deferred %s loading', async (presentation) => {
    const { fixture } = mount();
    if (presentation === 'sheet') {
      fixture.componentRef.setInput('dockShown', false);
      fixture.componentRef.setInput('compactSheet', true);
      fixture.componentRef.setInput('detailsOpen', true);
      fixture.detectChanges();
    }
    const host: HTMLElement = fixture.nativeElement;
    // `when` is already true on creation, so Angular skips @placeholder and
    // shows @loading while the inspector chunk downloads.
    // The docked view also holds the collapsed rail's block, which comes first.
    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(presentation === 'dock' ? 2 : 1);
    const inspectorBlock = blocks[blocks.length - 1];
    await inspectorBlock.render(DeferBlockState.Loading);
    fixture.detectChanges();
    expect(host.querySelector('[data-inspector-skeleton] ptah-canvas-lane-tabs')).not.toBeNull();
    expect(host.querySelectorAll('ptah-canvas-lane-tabs')).toHaveLength(1);
    await inspectorBlock.render(DeferBlockState.Complete);
    fixture.detectChanges();
    expect(host.querySelector('[data-inspector-skeleton]')).toBeNull();
    expect(host.querySelectorAll('ptah-session-inspector ptah-canvas-lane-tabs')).toHaveLength(1);
  });

  it('a key step persists the width, a remount restores it, and a narrow board clamps only the render', () => {
    let { fixture } = mount();
    dockParts(fixture.nativeElement).separator?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
    expect(dockParts(fixture.nativeElement).aside?.style.width).toBe('352px');
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBe('352');
    fixture.destroy();
    TestBed.resetTestingModule();
    ({ fixture } = mount());
    expect(dockParts(fixture.nativeElement).aside?.style.width).toBe('352px');
    fixture.componentRef.setInput('availableWidth', 704);
    fixture.detectChanges();
    // 704 px are shared by main content and dock; the 56 px rail is absent.
    expect(dockParts(fixture.nativeElement).aside?.style.width).toBe('344px');
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBe('352');
    fixture.componentRef.setInput('availableWidth', 1096);
    fixture.detectChanges();
    expect(dockParts(fixture.nativeElement).aside?.style.width).toBe('352px');
  });

  it('double-click resets to the default and forgets the width; Escape mid-drag keeps the stored width', () => {
    const { fixture } = mount();
    const parts = () => dockParts(fixture.nativeElement);
    parts().separator?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBe('384');
    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 500,
    });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    parts().separator?.dispatchEvent(down);
    fixture.detectChanges();
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
    expect(parts().aside?.style.width).toBe('384px');
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBe('384');
    parts().separator?.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    fixture.detectChanges();
    expect(parts().aside?.style.width).toBe('336px');
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBeNull();
  });

  it('wires the projected rail controls: Stop aborts, the view toggle switches, Close emits the id', async () => {
    const { fixture } = mount({ running: true, withControls: true });
    fixture.componentInstance.closeDock();
    fixture.detectChanges();
    await completeDeferBlocks(fixture);
    const rail: HTMLElement = fixture.nativeElement.querySelector('[data-inspector-rail]');
    const closed: string[] = [];
    fixture.componentInstance.closeRequested.subscribe((id) => closed.push(id));
    rail.querySelector<HTMLButtonElement>('[data-stop]')!.click();
    await fixture.whenStable();
    expect(abort).toHaveBeenCalledTimes(1);
    rail.querySelector<HTMLButtonElement>('[data-compact]')!.click();
    expect(toggleTabViewMode).toHaveBeenCalledWith('a');
    rail.querySelector<HTMLButtonElement>('[aria-label="Close session"]')!.click();
    expect(closed).toEqual(['a']);
  });

  it('logs a failed stop instead of leaving the rejection unhandled', async () => {
    const { fixture } = mount();
    const failure = new Error('abort failed');
    abort.mockRejectedValueOnce(failure);
    await expect(fixture.componentInstance.stopSession('a')).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith('CanvasInspectorDock', 'Could not stop session', failure);
  });

  it('shows Hand off once in the expanded sidebar and keeps it in the rail menu, which escapes the scrolling rail', async () => {
    const { fixture } = mount({ withControls: true });
    const host: HTMLElement = fixture.nativeElement;
    await completeDeferBlocks(fixture);
    // Expanded: Hand off is one icon button among the title-row controls; no menu there.
    expect(host.querySelectorAll('ptah-send-to-messaging')).toHaveLength(1);
    expect(
      host.querySelector('[data-inspector-dock] [role="group"] ptah-send-to-messaging')?.getAttribute('data-trigger'),
    ).toBe('icon');
    expect(host.querySelector('[data-inspector-dock] [data-header-menu]')).toBeNull();
    fixture.componentInstance.closeDock();
    fixture.detectChanges();
    await completeDeferBlocks(fixture);
    host.querySelector<HTMLButtonElement>('[data-inspector-rail] [data-header-menu]')!.click();
    fixture.detectChanges();
    const menu = host.querySelector<HTMLElement>('[data-inspector-rail] [role="menu"]')!;
    expect(menu.querySelector('ptah-send-to-messaging')).not.toBeNull();
    // Fixed, not absolute: the rail's overflow cannot clip it.
    expect(menu.classList.contains('fixed')).toBe(true);
    expect(menu.classList.contains('absolute')).toBe(false);
  });

  it('caps the grip so a drag keeps 560 px of chat and never flips to the overlay mid-drag', () => {
    const { fixture } = mount();
    const component = fixture.componentInstance;
    const separator = () => dockParts(fixture.nativeElement).separator;
    // 1096 px shared: the grip stops at 1096 - 560 = 536 px.
    expect(component.dockedMaxWidth()).toBe(536);
    expect(separator()?.getAttribute('aria-valuemax')).toBe('536');
    separator()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect(component.overlay()).toBe(false);
    expect(separator()).not.toBeNull();
    expect(dockParts(fixture.nativeElement).aside?.style.width).toBe('536px');
  });

  it('drops an uncommitted drag draft when a host resize flips the dock into the overlay', () => {
    const { fixture } = mount();
    const component = fixture.componentInstance;
    component.dock.preview(500);
    fixture.detectChanges();
    expect(component.dock.width()).toBe(500);
    fixture.componentRef.setInput('availableWidth', 700);
    fixture.detectChanges();
    expect(component.overlay()).toBe(true);
    fixture.componentRef.setInput('availableWidth', 1096);
    fixture.detectChanges();
    expect(component.dock.width()).toBe(336);
    expect(localStorage.getItem(DOCK_WIDTH_KEY)).toBeNull();
  });
});
