import { TestBed } from '@angular/core/testing';
import { ReviewSettingsDrawerComponent } from './review-settings-drawer.component';

describe('ReviewSettingsDrawerComponent', () => {
  it('shows the Minor default without publication controls and closes on Escape', () => {
    TestBed.configureTestingModule({ imports: [ReviewSettingsDrawerComponent] });
    const fixture = TestBed.createComponent(ReviewSettingsDrawerComponent);
    const close = jest.fn(); fixture.componentInstance.closed.subscribe(close);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Minor');
    expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).toBeNull();
    fixture.nativeElement.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
