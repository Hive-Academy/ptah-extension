import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WallClockService } from '@ptah-extension/core';
import type { PermissionRequest } from '@ptah-extension/shared';
import { PermissionRequestCardComponent } from './permission-request-card.component';

describe(PermissionRequestCardComponent.name, () => {
  let fixture: ComponentFixture<PermissionRequestCardComponent>;
  let clock: WallClockService;
  let releases: Array<() => void>;
  let acquire: jest.SpyInstance;
  let clockIntervals: Array<ReturnType<typeof setInterval>>;
  let clearIntervalSpy: jest.SpyInstance;

  const request = (timeoutAt: number, id = 'permission-1'): PermissionRequest => ({
    id,
    toolName: 'Read',
    toolInput: { file_path: 'example.ts' },
    timestamp: 1_000,
    description: 'Read example.ts',
    timeoutAt,
  });

  const render = (value: PermissionRequest): jest.Mock => {
    fixture = TestBed.createComponent(PermissionRequestCardComponent);
    const responded = jest.fn();
    fixture.componentInstance.responded.subscribe(responded);
    fixture.componentRef.setInput('request', value);
    fixture.detectChanges();
    TestBed.tick();
    return responded;
  };

  beforeEach(async () => {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    }).setSystemTime(1_000);
    await TestBed.configureTestingModule({ imports: [PermissionRequestCardComponent] }).compileComponents();
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

  it('denies exactly once at the deadline and releases the shared clock', () => {
    const responded = render(request(3_000));
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(clockIntervals).toHaveLength(1);

    jest.advanceTimersByTime(2_000);
    TestBed.tick();
    fixture.detectChanges();

    expect(responded).toHaveBeenCalledTimes(1);
    expect(responded).toHaveBeenCalledWith({
      id: 'permission-1',
      decision: 'deny',
      reason: 'Request timeout',
    });
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(clockIntervals[0]);
    jest.advanceTimersByTime(5_000);
    TestBed.tick();
    expect(responded).toHaveBeenCalledTimes(1);
  });

  it('denies once when mounted after the deadline with a stale clock value', () => {
    jest.setSystemTime(5_000);
    const responded = render(request(3_000));

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(responded).toHaveBeenCalledTimes(1);
    expect(responded).toHaveBeenCalledWith({
      id: 'permission-1',
      decision: 'deny',
      reason: 'Request timeout',
    });
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(clockIntervals[0]);
    TestBed.tick();
    expect(responded).toHaveBeenCalledTimes(1);
  });

  it('does not acquire or auto-deny for an unlimited request', () => {
    const responded = render(request(0));

    expect(acquire).not.toHaveBeenCalled();
    expect(responded).not.toHaveBeenCalled();
    expect(clockIntervals).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('No timeout');
  });
});
