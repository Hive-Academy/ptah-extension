import { DestroyRef, Injectable, inject } from '@angular/core';
import { LoggingService } from './logging.service';

@Injectable()
export class RendererFrameMonitorService {
  private readonly logger = inject(LoggingService);
  private readonly observer: PerformanceObserver | null;
  private lastLog = -10_000;

  constructor() {
    const types = typeof PerformanceObserver === 'undefined'
      ? [] : PerformanceObserver.supportedEntryTypes;
    const type = types.includes('long-animation-frame') ? 'long-animation-frame'
      : types.includes('longtask') ? 'longtask' : null;
    this.observer = type ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const now = performance.now();
        if (entry.duration <= 200 || now - this.lastLog < 10_000) continue;
        this.lastLog = now;
        // The renderer->host console bridge forwards text only, so the
        // metrics stay machine-readable as a trailing JSON object.
        const frame = { durationMs: Math.round(entry.duration), entryType: type };
        this.logger.warn('RendererFrame', `long frame ${JSON.stringify(frame)}`);
      }
    }) : null;
    if (type) this.observer?.observe({ type });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }
}
