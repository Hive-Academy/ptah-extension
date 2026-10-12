import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat';
import { CanvasDetailService } from './canvas-detail.service';
import { CanvasDetailPanelComponent } from './canvas-detail-panel.component';
import { CanvasLaneTabsComponent } from './canvas-lane-tabs.component';
import { CanvasLaneViewComponent } from './canvas-lane-view.component';

@Component({
  selector: 'ptah-canvas-lane-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div data-testid="transcript">{{ tabId() }}</div>',
})
class TranscriptStub {
  readonly tabId = input.required<string>();
  readonly panelId = input('canvas-lane-panel');
  readonly sessionId = input<string | null>(null);
  readonly laneKey = input('orchestrator');
}

@Component({
  selector: 'ptah-canvas-lane-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class TabsStub {
  readonly panelId = input('canvas-lane-panel');
  readonly sessionId = input<string | null>(null);
  readonly laneKey = input('orchestrator');
  readonly laneSelected = output<string>();
}

describe('CanvasDetailPanelComponent', () => {
  const tabs = signal([{ id: 'a', title: 'Alpha', status: 'running' }]);
  const laneKey = signal('orchestrator');
  const close = jest.fn();

  beforeEach(() => {
    close.mockClear();
    laneKey.set('orchestrator');
    TestBed.configureTestingModule({
      imports: [CanvasDetailPanelComponent],
      providers: [
        { provide: TabManagerService, useValue: { tabs } },
        {
          provide: CanvasDetailService,
          useValue: { laneKey, close, selectLane: jest.fn() },
        },
      ],
    });
    TestBed.overrideComponent(CanvasDetailPanelComponent, {
      remove: { imports: [CanvasLaneTabsComponent, CanvasLaneViewComponent] },
      add: { imports: [TabsStub, TranscriptStub] },
    });
  });

  it('shows the session header, one transcript and details without an agent list', () => {
    const fixture = TestBed.createComponent(CanvasDetailPanelComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('[role="region"]')
        .getAttribute('aria-label'),
    ).toBe('Session detail');
    expect(fixture.nativeElement.textContent).toContain('Alpha');
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="transcript"]'),
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelector('ptah-canvas-session-details'),
    ).not.toBeNull();
    fixture.nativeElement
      .querySelector('[aria-label="Close session detail"]')
      .click();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
