import { Injectable, signal } from '@angular/core';

export interface CanvasRenderMetrics {
  readonly creationOptionWrites: number;
  readonly layoutComputations: number;
  readonly applyChecks: number;
  readonly applyPasses: number;
  readonly gridUpdates: number;
  readonly changeCallbacks: number;
  readonly acceptedGestures: number;
  readonly rejectedGestures: number;
  readonly cancelledGestures: number;
}

type CanvasRenderMetric = keyof CanvasRenderMetrics;

const EMPTY_METRICS: CanvasRenderMetrics = {
  creationOptionWrites: 0,
  layoutComputations: 0,
  applyChecks: 0,
  applyPasses: 0,
  gridUpdates: 0,
  changeCallbacks: 0,
  acceptedGestures: 0,
  rejectedGestures: 0,
  cancelledGestures: 0,
};

/** Canvas-local bounded diagnostic counters; no transcript/session data. */
@Injectable()
export class CanvasRenderMetricsService {
  private counters: CanvasRenderMetrics = EMPTY_METRICS;
  /** Reactive publication clock; counter reads themselves stay allocation-free. */
  readonly version = signal(0);

  snapshot(): CanvasRenderMetrics {
    return this.counters;
  }

  increment(
    metric: CanvasRenderMetric,
    amount = 1,
    publish = true,
  ): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.counters = {
      ...this.counters,
      [metric]: Math.min(
        Number.MAX_SAFE_INTEGER,
        this.counters[metric] + amount,
      ),
    };
    if (publish) this.version.update((value) => value + 1);
  }

  /** Publish counters incremented from inside a computed without writing there. */
  publish(): void {
    this.version.update((value) => value + 1);
  }
}
