import { TestBed } from '@angular/core/testing';
import { commandCenterClock } from './command-center-clock';

describe('commandCenterClock', () => {
  it('ticks every 30 seconds and clears its timer on destroy', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000_000);
      const now = TestBed.runInInjectionContext(commandCenterClock);
      expect(now()).toBe(1_000_000);
      jest.advanceTimersByTime(30_000);
      expect(now()).toBe(1_030_000);
      TestBed.resetTestingModule();
      jest.advanceTimersByTime(30_000);
      expect(now()).toBe(1_030_000);
    } finally {
      jest.useRealTimers();
    }
  });
});
