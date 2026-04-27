import { TestBed } from '@angular/core/testing';
import { StreamingQuotesComponent } from './streaming-quotes.component';

describe('StreamingQuotesComponent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates and starts revealing characters on init', async () => {
    await TestBed.configureTestingModule({
      imports: [StreamingQuotesComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(StreamingQuotesComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    // Initial render before any timer ticks
    expect(fixture.componentInstance.displayedText()).toBe('');

    // Advance the typing interval
    jest.advanceTimersByTime(60);
    fixture.detectChanges();
    expect(fixture.componentInstance.displayedText().length).toBeGreaterThan(0);
  });

  it('cleans up timers on destroy', async () => {
    await TestBed.configureTestingModule({
      imports: [StreamingQuotesComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(StreamingQuotesComponent);
    fixture.detectChanges();
    jest.advanceTimersByTime(50);
    fixture.detectChanges();

    expect(() => fixture.destroy()).not.toThrow();
  });
});
