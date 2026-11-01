import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WallClockService } from '@ptah-extension/core';
import type { AskUserQuestionRequest } from '@ptah-extension/shared';
import { QuestionCardComponent } from './question-card.component';

describe(QuestionCardComponent.name, () => {
  let fixture: ComponentFixture<QuestionCardComponent>;
  let clock: WallClockService;
  let releases: Array<() => void>;
  let acquire: jest.SpyInstance;
  let clockIntervals: Array<ReturnType<typeof setInterval>>;
  let clearIntervalSpy: jest.SpyInstance;

  const request = (timeoutAt: number): AskUserQuestionRequest => ({
    id: 'question-1',
    toolName: 'AskUserQuestion',
    timestamp: 1_000,
    timeoutAt,
    questions: [{
      question: 'Which option?',
      header: 'Choice',
      options: [
        { label: 'First', description: 'First option' },
        { label: 'Second', description: 'Second option' },
      ],
      multiSelect: false,
    }],
  });

  const render = (value: AskUserQuestionRequest): void => {
    fixture = TestBed.createComponent(QuestionCardComponent);
    fixture.componentRef.setInput('request', value);
    fixture.detectChanges();
    TestBed.tick();
  };

  beforeEach(async () => {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    }).setSystemTime(1_000);
    await TestBed.configureTestingModule({ imports: [QuestionCardComponent] }).compileComponents();
    clock = TestBed.inject(WallClockService);
    releases = [];
    clockIntervals = [];
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    const realAcquire = clock.acquire.bind(clock);
    acquire = jest.spyOn(clock, 'acquire').mockImplementation((cadence) => {
      const priorIntervals = setIntervalSpy.mock.results.length;
      const release = jest.fn(realAcquire(cadence));
      const createdIntervals = setIntervalSpy.mock.results.slice(priorIntervals);
      expect(createdIntervals).toHaveLength(1);
      clockIntervals.push(createdIntervals[0].value);
      releases.push(release);
      return release;
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses the absolute deadline when remounted and releases at expiry', () => {
    const value = request(6_000);
    render(value);
    expect(fixture.nativeElement.textContent).toContain('5s');
    expect(clockIntervals).toHaveLength(1);

    fixture.destroy();
    expect(releases[0]).toHaveBeenCalledTimes(1);
    jest.setSystemTime(3_000);
    render(value);
    expect(fixture.nativeElement.textContent).toContain('3s');
    expect(acquire).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(3_000);
    TestBed.tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('0s');
    expect(releases[1]).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(clockIntervals[1]);
  });

  it('refreshes a stale clock on an already-expired mount', () => {
    jest.setSystemTime(5_000);
    render(request(3_000));

    expect(fixture.nativeElement.textContent).toContain('0s');
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(clockIntervals[0]);
  });

  it('preserves the no-timeout sentinel without acquiring the clock', () => {
    render(request(0));

    expect(fixture.nativeElement.textContent).toContain('No timeout');
    expect(acquire).not.toHaveBeenCalled();
    expect(clockIntervals).toHaveLength(0);
  });
});
