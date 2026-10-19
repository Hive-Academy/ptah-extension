import { TestBed } from '@angular/core/testing';
import { GuidanceResultPanelComponent } from './guidance-result-panel.component';

describe('GuidanceResultPanelComponent', () => {
  it('returns the checkbox to the saved value while a toggle fails', () => {
    TestBed.configureTestingModule({ imports: [GuidanceResultPanelComponent] });
    const fixture = TestBed.createComponent(GuidanceResultPanelComponent);
    const saved = { generatedAt: null, enabled: true, cacheValid: true };
    fixture.componentRef.setInput('result', saved);
    const emit = jest.spyOn(fixture.componentInstance.enabledChanged, 'emit');
    fixture.detectChanges();
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector(
      'input',
    );
    if (!checkbox) throw new Error('Missing guidance toggle');
    checkbox.click();
    fixture.detectChanges();
    expect(emit).toHaveBeenCalledWith(false);
    expect(checkbox.checked).toBe(true);
  });
  it('shows committed metadata and emits actions without changing agent outcome', () => {
    TestBed.configureTestingModule({ imports: [GuidanceResultPanelComponent] });
    const fixture = TestBed.createComponent(GuidanceResultPanelComponent);
    fixture.componentRef.setInput('showSkip', true);
    fixture.componentRef.setInput('result', {
      generatedAt: '2026-10-18',
      enabled: true,
      cacheValid: false,
    });
    const skip = jest.spyOn(fixture.componentInstance.skipRequested, 'emit');
    const cache = jest.spyOn(fixture.componentInstance.cacheRequested, 'emit');
    const download = jest.spyOn(
      fixture.componentInstance.downloadRequested,
      'emit',
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Cache needs refreshing');
    expect(root.textContent).not.toContain('2026-10-18');
    fixture.componentRef.setInput('runActive', true);
    fixture.detectChanges();
    expect(
      [...root.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Regenerate'),
      ),
    ).toBeUndefined();
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Refresh cache'))
      ?.click();
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Download'))
      ?.click();
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Skip'))
      ?.click();
    expect(download).toHaveBeenCalled();
    expect(cache).toHaveBeenCalled();
    expect(skip).toHaveBeenCalled();
  });
});
