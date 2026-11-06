import { TestBed } from '@angular/core/testing';
import { LoggingService } from './logging.service';
import { RendererFrameMonitorService } from './renderer-frame-monitor.service';

describe('RendererFrameMonitorService', () => {
  const originalObserver = globalThis.PerformanceObserver;

  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.PerformanceObserver = originalObserver;
    jest.restoreAllMocks();
  });

  it('samples long frames and disconnects on destroy', () => {
    let report: PerformanceObserverCallback | undefined;
    const observe = jest.fn();
    const disconnect = jest.fn();
    class FakeObserver {
      static supportedEntryTypes = ['long-animation-frame'];
      constructor(callback: PerformanceObserverCallback) { report = callback; }
      observe = observe;
      disconnect = disconnect;
      takeRecords = (): PerformanceEntryList => [];
    }
    globalThis.PerformanceObserver = FakeObserver as typeof PerformanceObserver;
    const warn = jest.fn();
    TestBed.configureTestingModule({
      providers: [RendererFrameMonitorService, { provide: LoggingService, useValue: { warn } }],
    });
    TestBed.inject(RendererFrameMonitorService);
    expect(observe).toHaveBeenCalledWith({ type: 'long-animation-frame' });
    const now = jest.spyOn(performance, 'now').mockReturnValue(20_000);
    report?.({ getEntries: () => [{ duration: 250 }] } as PerformanceObserverEntryList,
      {} as PerformanceObserver);
    now.mockReturnValue(20_001);
    report?.({ getEntries: () => [{ duration: 300 }] } as PerformanceObserverEntryList,
      {} as PerformanceObserver);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'RendererFrame',
      'long frame {"durationMs":250,"entryType":"long-animation-frame"}',
    );
    TestBed.resetTestingModule();
    expect(disconnect).toHaveBeenCalled();
  });
});
