import { TestBed } from '@angular/core/testing';
import { GuidanceRunCardComponent } from './guidance-run-card.component';

describe('GuidanceRunCardComponent', () => {
  it('disables Stop while stopping and shows neutral unknown text', () => {
    TestBed.configureTestingModule({ imports: [GuidanceRunCardComponent] });
    const fixture = TestBed.createComponent(GuidanceRunCardComponent);
    fixture.componentRef.setInput('status', 'cancelling');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('button')
        ?.hasAttribute('disabled'),
    ).toBe(true);
    fixture.componentRef.setInput('status', 'stop-unknown');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'could not be confirmed',
    );
  });
  it('emits Retry for failure without showing unknown provider/model', () => {
    TestBed.configureTestingModule({ imports: [GuidanceRunCardComponent] });
    const fixture = TestBed.createComponent(GuidanceRunCardComponent);
    fixture.componentRef.setInput('status', 'failed');
    fixture.componentRef.setInput('snapshot', {
      runId: 'r',
      sourceLabel: 'Workspace discovery (missing)',
      provider: null,
      model: null,
    });
    const retry = jest.spyOn(fixture.componentInstance.retryRequested, 'emit');
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    expect(retry).toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'unknown',
    );
  });
});
