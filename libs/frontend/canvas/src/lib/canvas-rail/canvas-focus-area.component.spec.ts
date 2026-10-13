import { ChangeDetectionStrategy, Component, OnDestroy, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasFocusAreaComponent } from './canvas-focus-area.component';

const destroyed: string[] = [];

@Component({ selector: 'ptah-canvas-focus-header', standalone: true, template: '<header>{{ title() }}</header>', changeDetection: ChangeDetectionStrategy.OnPush })
class HeaderStub {
  readonly tabId = input.required<string>(); readonly title = input(''); readonly state = input('idle');
  readonly running = input(false); readonly viewMode = input('full'); readonly band = input('lg');
  readonly stop = output<void>(); readonly toggleViewMode = output<void>(); readonly closeRequested = output<void>();
}
@Component({ selector: 'ptah-canvas-lane-tabs', standalone: true, template: '<button role="tab" aria-selected="true">Orchestrator</button>' })
class TabsStub {
  readonly sessionId = input<string | null>(null); readonly laneKey = input('orchestrator'); readonly laneSelected = output<string>();
}
@Component({ selector: 'ptah-canvas-lane-view', standalone: true, template: '<div class="transcript">{{ tabId() }}:{{ laneKey() }}</div>' })
class ViewStub implements OnDestroy {
  readonly tabId = input.required<string>(); readonly sessionId = input<string | null>(null); readonly laneKey = input('orchestrator');
  ngOnDestroy(): void { destroyed.push(this.tabId()); }
}

describe('CanvasFocusAreaComponent', () => {
  it('activates an inactive tab before stopping its session', async () => {
    const focus = jest.fn();
    const abort = jest.fn().mockResolvedValue(undefined);
    const area = Object.create(CanvasFocusAreaComponent.prototype) as CanvasFocusAreaComponent;
    Object.assign(area, {
      tabs: { activeTabId: () => 'other' },
      canvasStore: { focusTile: focus },
      chatStore: { abortWithConfirmation: abort },
    });
    await area.stop('selected');
    expect(focus).toHaveBeenCalledWith('selected');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('mounts one keyed view and keeps the header element across swaps', () => {
    destroyed.length = 0;
    const lanes = new Map([['a', 'cli:agent-a'], ['b', 'orchestrator']]);
    TestBed.configureTestingModule({
      imports: [CanvasFocusAreaComponent],
      providers: [
        CanvasRenderMetricsService,
        { provide: CanvasStore, useValue: { isSessionRunning: () => false } },
        { provide: TabManagerService, useValue: { findTabByIdAcrossWorkspaces: (id: string) => ({ tab: { title: id, viewMode: 'full', claudeSessionId: null } }) } },
        { provide: ChatStore, useValue: { abortWithConfirmation: jest.fn() } },
        { provide: CanvasDetailService, useValue: { laneKeyFor: (id: string) => lanes.get(id) ?? 'orchestrator', selectLaneFor: jest.fn() } },
      ],
    });
    TestBed.overrideComponent(CanvasFocusAreaComponent, { set: { imports: [HeaderStub, TabsStub, ViewStub] } });
    const fixture = TestBed.createComponent(CanvasFocusAreaComponent);
    fixture.componentRef.setInput('focusedTabId', 'a'); fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('header');
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('ptah-canvas-lane-view')?.textContent).toContain('a:cli:agent-a');
    fixture.componentRef.setInput('focusedTabId', 'b'); fixture.detectChanges();
    expect(destroyed).toEqual(['a']);
    expect(fixture.nativeElement.querySelector('header')).toBe(header);
    expect(fixture.nativeElement.querySelectorAll('ptah-canvas-lane-view')).toHaveLength(1);
    fixture.componentRef.setInput('focusedTabId', 'a'); fixture.detectChanges();
    expect(destroyed).toEqual(['a', 'b']);
    expect(fixture.nativeElement.querySelector('ptah-canvas-lane-view')?.textContent).toContain('a:cli:agent-a');
    const metrics = fixture.debugElement.injector.get(CanvasRenderMetricsService).snapshot();
    expect(metrics.focusSwaps).toBe(2);
    expect(metrics.liveViewMounts).toBe(3);
  });
});
