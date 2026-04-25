/**
 * StreamingControl — Inverted-dependency contract for tab/streaming coordination.
 *
 * TASK_2026_103 Wave B1: Breaks the file-level cycles
 *
 *   tab-manager.service ↔ chat-store/streaming-handler.service
 *   tab-manager.service ↔ agent-monitor.store
 *
 * Direction of dependency BEFORE:
 *   TabManager → StreamingHandlerService (concrete) → TabManager   (cycle)
 *   TabManager → AgentMonitorStore (concrete) → TabManager         (cycle)
 *
 * Direction of dependency AFTER:
 *   TabManager → StreamingControl (interface) ← StreamingHandlerService
 *                                            ← AgentMonitorStore
 *
 * The streaming/agent services already legitimately depend on TabManager to
 * read & update tab state. TabManager only needs a thin contract to clean up
 * per-session worker state when a tab is closed. Owning that contract here
 * (a neutral location with NO imports of any of the workers) flips the arrow
 * so the worker services can keep importing TabManager without forming a cycle.
 *
 * IMPORTANT: This module MUST NOT import StreamingHandlerService,
 * AgentMonitorStore, or any other chat service. Doing so re-introduces the
 * cycle. The concrete binding lives in
 * `chat-store/streaming-control-impl.service.ts`, registered as the value
 * for the STREAMING_CONTROL token in the application's composition root
 * (see `apps/ptah-extension-webview/src/app/app.config.ts`).
 */

import { InjectionToken } from '@angular/core';

/**
 * Operations TabManagerService needs to perform on streaming/agent workers
 * during tab lifecycle (close, force-close).
 *
 * Implementations live in `chat-store/streaming-control-impl.service.ts` and
 * delegate to the concrete `StreamingHandlerService` and `AgentMonitorStore`
 * services. Consumers MUST inject only this token, never the concretes, when
 * called from tab-manager.service.
 */
export interface StreamingControl {
  /**
   * Clean up deduplication state and warning caches for a session.
   * Mirrors `StreamingHandlerService.cleanupSessionDeduplication`.
   */
  cleanupSessionDeduplication(sessionId: string): void;

  /**
   * Remove non-running agent monitor cards belonging to a session.
   * Mirrors `AgentMonitorStore.clearSessionAgents`.
   */
  clearSessionAgents(sessionId: string): void;
}

/**
 * DI token for StreamingControl. Bound to `StreamingControlImpl` via a
 * `{ provide: STREAMING_CONTROL, useExisting: StreamingControlImpl }`
 * provider in the app composition root.
 */
export const STREAMING_CONTROL = new InjectionToken<StreamingControl>(
  'STREAMING_CONTROL',
);
