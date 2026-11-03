import { TestBed } from '@angular/core/testing';
import { OwnerConflictBannerComponent } from './owner-conflict-banner.component';

describe('OwnerConflictBannerComponent', () => {
  it('labels the conflict and emits Open it and Retry', () => {
    TestBed.configureTestingModule({ imports: [OwnerConflictBannerComponent] });
    const fixture = TestBed.createComponent(OwnerConflictBannerComponent);
    const open = jest.fn();
    const retry = jest.fn();
    fixture.componentInstance.openOwner.subscribe(open);
    fixture.componentInstance.retry.subscribe(retry);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Another run is active');
    const buttons = el.querySelectorAll('button');
    buttons[0].click();
    buttons[1].click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the supplied conflict detail without emitting an action on render', () => {
    TestBed.configureTestingModule({ imports: [OwnerConflictBannerComponent] });
    const fixture = TestBed.createComponent(OwnerConflictBannerComponent);
    fixture.componentRef.setInput('message', 'The other tab owns this run.');
    const open = jest.fn();
    const retry = jest.fn();
    fixture.componentInstance.openOwner.subscribe(open);
    fixture.componentInstance.retry.subscribe(retry);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="status"]')?.textContent).toContain('The other tab owns this run.');
    expect(open).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    (el.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
