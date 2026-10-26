import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output, NO_ERRORS_SCHEMA } from '@angular/core';
import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { INSPECTOR_TAB_WIDTH, TabManagerService } from '@ptah-extension/chat';
import { SplitHandleComponent } from '@ptah-extension/chat-ui';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasInspectorDockComponent } from './canvas-inspector-dock.component';

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
    } @else {
      <div [attr.role]="presentation() === 'sheet' ? 'dialog' : null">
        <button
          data-inspector-close
          aria-expanded="true"
          (click)="closeRequested.emit()"
        >
          Close
        </button>
        <ng-content select="[inspectorActions]" />
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

  function mount() {
    TestBed.configureTestingModule({
      imports: [CanvasInspectorDockComponent],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        { provide: TabManagerService, useValue: {
          onTabClosed: () => () => undefined,
          findTabByIdAcrossWorkspaces: () => ({ tab: { title: 'Alpha', viewMode: 'full' } }),
        } },
        { provide: CanvasDetailService, useValue: {
          laneKeyFor: () => 'orchestrator', selectLaneFor: jest.fn(),
        } },
      ],
    });
    TestBed.overrideComponent(CanvasInspectorDockComponent, {
      set: {
        imports: [InspectorStub, NgTemplateOutlet, SplitHandleComponent],
        schemas: [NO_ERRORS_SCHEMA],
      },
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

  function dockParts(host: HTMLElement) {
    return {
      tab: host.querySelector<HTMLButtonElement>('[data-inspector-expand]'),
      aside: host.querySelector<HTMLElement>('[data-inspector-dock]'),
      separator: host.querySelector<HTMLElement>('[role="separator"]'),
    };
  }

  it.each(['near', 'at'] as const)('forwards the %s plan limit to the compact rail', (state) => {
    const { fixture } = mount();
    const limitSummary = { state, text: 'Plan limit', fullText: 'Weekly plan limit', extra: 0, source: 'session' };
    fixture.componentRef.setInput('stats', { limitSummary });
    fixture.componentInstance.closeDock();
    fixture.detectChanges();
    const rail = fixture.debugElement.query(By.directive(InspectorStub)).componentInstance as InspectorStub;
    expect(rail.limitSummary()).toEqual(limitSummary);
  });

  it('subtracts the compact 56px exactly once and never saves it as the dock preference', () => {
    const { fixture } = mount();
    const component = fixture.componentInstance;
    component.dock.preview(400);
    component.dock.commit();
    fixture.detectChanges();
    component.closeDock();
    fixture.detectChanges();
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
    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Loading);
    fixture.detectChanges();
    expect(host.querySelector('[data-inspector-skeleton] ptah-canvas-lane-tabs')).not.toBeNull();
    expect(host.querySelectorAll('ptah-canvas-lane-tabs')).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Complete);
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


});
