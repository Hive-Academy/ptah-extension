import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat';
import { CanvasDetailService } from './canvas-detail.service';
import { CanvasDetailPanelComponent } from './canvas-detail-panel.component';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';

@Component({
  selector: 'ptah-canvas-detail-transcript',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div data-testid="transcript">{{ tabId() }}</div>',
})
class TranscriptStub {
  readonly tabId = input.required<string>();
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
        { provide: CanvasDetailService, useValue: { laneKey, close } },
      ],
    });
    TestBed.overrideComponent(CanvasDetailPanelComponent, {
      remove: { imports: [CanvasDetailTranscriptComponent] },
      add: { imports: [TranscriptStub] },
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
