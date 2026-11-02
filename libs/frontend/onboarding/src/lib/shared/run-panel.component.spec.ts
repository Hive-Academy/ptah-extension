import { TestBed } from '@angular/core/testing';
import { RunPanelComponent } from './run-panel.component';

describe('RunPanelComponent', () => {
  function render(state: string, viewState?: string) {
    TestBed.configureTestingModule({ imports: [RunPanelComponent] });
    const fixture = TestBed.createComponent(RunPanelComponent);
    fixture.componentRef.setInput('title', 'Agent generation');
    fixture.componentRef.setInput('state', state);
    if (viewState) fixture.componentRef.setInput('viewState', viewState);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = () => Array.from(el.querySelectorAll('button'));
    const labels = () => buttons().map(button => button.textContent?.trim());
    return { fixture, el, buttons, labels };
  }

  it('emits Stop while running and disables actions while stopping', () => {
    TestBed.configureTestingModule({ imports: [RunPanelComponent] });
    const fixture = TestBed.createComponent(RunPanelComponent);
    fixture.componentRef.setInput('title', 'Agent generation');
    fixture.componentRef.setInput('state', 'running');
    const stop = jest.fn();
    fixture.componentInstance.stop.subscribe(stop);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('button') as HTMLButtonElement).click();
    expect(stop).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('state', 'cancelling');
    fixture.detectChanges();
    expect(el.querySelector('button')).toBeNull();
    expect(el.textContent).toContain('Stopping');
  });

  it.each(['stop-unconfirmed', 'stop-unknown'])('offers recovery for %s', viewState => {
    const { fixture, labels, buttons } = render('cancelling', viewState);
    const retry = jest.fn();
    const startOver = jest.fn();
    fixture.componentInstance.retry.subscribe(retry);
    fixture.componentInstance.startOver.subscribe(startOver);
    expect(labels()).toEqual(['Retry', 'Start over']);
    buttons()[0].click();
    buttons()[1].click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(startOver).toHaveBeenCalledTimes(1);
  });

  it('offers Retry and Start over on failure', () => {
    const { fixture, labels, buttons } = render('failed');
    const retry = jest.fn();
    const startOver = jest.fn();
    fixture.componentInstance.retry.subscribe(retry);
    fixture.componentInstance.startOver.subscribe(startOver);
    expect(labels()).toEqual(['Retry', 'Start over']);
    buttons()[0].click();
    buttons()[1].click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(startOver).toHaveBeenCalledTimes(1);
  });

  it('offers only Resume for a resumable run', () => {
    const { fixture, labels, buttons } = render('resumable');
    const resume = jest.fn();
    fixture.componentInstance.resumeRequested.subscribe(resume);
    expect(labels()).toEqual(['Resume']);
    buttons()[0].click();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('offers only Continue for a completed run', () => {
    const { fixture, labels, buttons } = render('done');
    const continueRun = jest.fn();
    fixture.componentInstance.continueRun.subscribe(continueRun);
    expect(labels()).toEqual(['Continue']);
    buttons()[0].click();
    expect(continueRun).toHaveBeenCalledTimes(1);
  });

  it('uses the supplied continue label for a completed run', () => {
    const { fixture, labels } = render('done');
    fixture.componentRef.setInput('continueLabel', 'Choose agents');
    fixture.detectChanges();
    expect(labels()).toEqual(['Choose agents']);
  });

  it('announces safe failure copy without rendering backend details', () => {
    const { fixture, el } = render('failed');
    fixture.componentRef.setInput('error', 'Backend failure at /private/workspace with token=abc123');
    fixture.detectChanges();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The run could not be completed. Try again.');
    expect(alert?.textContent).not.toContain('/private/workspace');
    expect(alert?.textContent).not.toContain('token=abc123');
  });
});
