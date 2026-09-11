import { TestBed } from '@angular/core/testing';
import { CanvasRenderMetricsService } from './canvas-render-metrics.service';

describe('CanvasRenderMetricsService', () => {
  it('counts locally and saturates instead of overflowing', () => {
    TestBed.configureTestingModule({ providers: [CanvasRenderMetricsService] });
    const metrics = TestBed.inject(CanvasRenderMetricsService);
    const version = metrics.version();
    metrics.increment('gridUpdates', 2);
    metrics.increment('gridUpdates', Number.MAX_SAFE_INTEGER);
    metrics.increment('gridUpdates', Number.NaN);
    expect(metrics.snapshot().gridUpdates).toBe(Number.MAX_SAFE_INTEGER);
    expect(metrics.version()).toBeGreaterThan(version);
  });

  it('can count a computation without publishing until its apply checkpoint', () => {
    TestBed.configureTestingModule({ providers: [CanvasRenderMetricsService] });
    const metrics = TestBed.inject(CanvasRenderMetricsService);
    metrics.increment('layoutComputations', 1, false);
    expect(metrics.version()).toBe(0);
    expect(metrics.snapshot().layoutComputations).toBe(1);
    metrics.publish();
    expect(metrics.version()).toBe(1);
  });
});
