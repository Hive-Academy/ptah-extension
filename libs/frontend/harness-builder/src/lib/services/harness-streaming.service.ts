import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import type {
  HarnessFlatStreamCompletePayload,
  HarnessFlatStreamPayload,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';

@Injectable({ providedIn: 'root' })
export class HarnessStreamingService implements OnDestroy {
  private readonly state = inject(HarnessBuilderStateService);

  private readonly _completionResult =
    signal<HarnessFlatStreamCompletePayload | null>(null);

  /** Delegates to the single source of truth in HarnessBuilderStateService. */
  public readonly isStreaming = this.state.isConversing;
  public readonly completionResult = this._completionResult.asReadonly();

  public readonly hasError = computed(() => {
    const result = this._completionResult();
    return result !== null && !result.success;
  });

  public readonly errorMessage = computed(() => {
    const result = this._completionResult();
    if (result && !result.success) return result.error ?? 'Operation failed';
    return null;
  });

  private readonly messageHandler = (event: MessageEvent): void => {
    const message = event.data;
    if (!message || !message.type) return;

    if (message.type === 'harness:flat-stream') {
      const payload = message.payload as HarnessFlatStreamPayload;

      if (!this.state.isConversing()) {
        this.state.startStreaming(payload.operationId);
      }

      // TASK_2026_107 Phase 4: route through StreamRouter via the surface
      // façade instead of the deleted hand-rolled accumulator. The façade
      // lazy-mints the surface on first event for a given operationId,
      // so the harness backend doesn't need to emit a discrete "start"
      // message before the first stream payload.
      this.state.routeOperationEvent(payload.operationId, payload.event);
    } else if (message.type === 'harness:flat-stream-complete') {
      const payload = message.payload as HarnessFlatStreamCompletePayload;
      // TASK_2026_107 Phase 4: tear down the per-operation surface routing.
      // Accumulated streaming state is intentionally retained so the
      // execution tree continues to render after completion (cleared on
      // resetStreamingState / reset).
      this.state.unregisterOperationSurface(payload.operationId);
      this._completionResult.set(payload);
      this.state.stopStreaming();
    }
  };

  constructor() {
    window.addEventListener('message', this.messageHandler);
  }

  public ngOnDestroy(): void {
    window.removeEventListener('message', this.messageHandler);
  }

  public reset(): void {
    this._completionResult.set(null);
    this.state.resetStreamingState();
  }
}
