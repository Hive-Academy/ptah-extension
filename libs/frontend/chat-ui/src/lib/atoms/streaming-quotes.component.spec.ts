import { ApplicationRef, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StreamingQuotesComponent } from './streaming-quotes.component';

describe('StreamingQuotesComponent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('updates the rendered quote outside Angular without an application tick', async () => {
    await TestBed.configureTestingModule({
      imports: [StreamingQuotesComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(StreamingQuotesComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    let applicationTicks = 0;
    const tickSubscription = TestBed.inject(ApplicationRef).afterTick.subscribe(
      () => applicationTicks++,
    );
    const zoneStates: boolean[] = [];
    const internals = component as unknown as {
      renderText(text: string): void;
    };
    const originalRenderText = internals.renderText.bind(component);
    jest.spyOn(internals, 'renderText').mockImplementation((value) => {
      zoneStates.push(NgZone.isInAngularZone());
      originalRenderText(value);
    });

    expect(component).toBeTruthy();
    // Initial render before any timer ticks
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.typewriter-text')
        ?.textContent?.trim(),
    ).toBe('');

    // No explicit detectChanges: the hard-coded quote is written directly to
    // this component's text node while the callback remains outside NgZone.
    jest.advanceTimersByTime(50);

    expect(zoneStates).toEqual([false]);
    expect(applicationTicks).toBe(0);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.typewriter-text')
        ?.textContent?.trim(),
    ).toBe('L');
    tickSubscription.unsubscribe();
  });

  it('restores the typing period after each delete cycle and clears dead handles', async () => {
    const intervalSpy = jest.spyOn(globalThis, 'setInterval');

    await TestBed.configureTestingModule({
      imports: [StreamingQuotesComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(StreamingQuotesComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const firstQuoteLength = 'Let me think about this...'.length;
    jest.advanceTimersByTime((firstQuoteLength + 1) * 50);

    expect(
      (
        component as unknown as {
          typingInterval: ReturnType<typeof setInterval> | null;
        }
      ).typingInterval,
    ).toBeNull();

    jest.advanceTimersByTime(2000);
    jest.advanceTimersByTime((firstQuoteLength + 1) * 30);

    expect(
      intervalSpy.mock.calls
        .map((call) => call[1])
        .filter((delay) => delay === 30 || delay === 50),
    ).toEqual([50, 30, 50]);
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
