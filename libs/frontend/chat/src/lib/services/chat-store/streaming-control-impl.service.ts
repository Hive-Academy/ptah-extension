/**
 * StreamingControlImpl — Concrete binding for the STREAMING_CONTROL token.
 *
 * TASK_2026_103 Wave B1: Implementation lives in `chat-store/` (alongside the
 * worker services it delegates to) so that `tab-manager.service` can depend
 * only on the neutral `streaming-control.ts` interface module — flipping the
 * arrow that previously formed a cycle.
 *
 * This file is intentionally tiny: it adds NO new logic, it only delegates
 * each method on the StreamingControl contract to the existing concrete
 * service. Behavior is identical to the previous direct calls.
 *
 * The class is `providedIn: 'root'`. Consumers should NOT inject this class
 * directly; inject the STREAMING_CONTROL token instead. The composition root
 * binds the token to this class via:
 *   { provide: STREAMING_CONTROL, useExisting: StreamingControlImpl }
 */

import { inject, Injectable } from '@angular/core';
import { StreamingControl } from '@ptah-extension/chat-state';

import {
  AgentMonitorStore,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';

@Injectable({ providedIn: 'root' })
export class StreamingControlImpl implements StreamingControl {
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly agentMonitorStore = inject(AgentMonitorStore);

  cleanupSessionDeduplication(sessionId: string): void {
    this.streamingHandler.cleanupSessionDeduplication(sessionId);
  }

  clearSessionAgents(sessionId: string): void {
    this.agentMonitorStore.clearSessionAgents(sessionId);
  }
}
