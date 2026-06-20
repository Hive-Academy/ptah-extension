import { Injectable, computed, inject, signal } from '@angular/core';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import { SurfaceId } from '@ptah-extension/chat-state';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class TribunalSurfaceService {
  private readonly streamRouter = inject(StreamRouter);
  private readonly surfaceRegistry = inject(StreamingSurfaceRegistry);

  private readonly _streamingState = signal<StreamingState>(
    createEmptyStreamingState(),
  );
  private readonly _nudge = signal(0);
  private _surfaceId: SurfaceId | null = null;

  readonly streamingState = computed<StreamingState>(() => {
    this._nudge();
    return this._streamingState();
  });

  registerSurface(surfaceId: SurfaceId): void {
    this._surfaceId = surfaceId;
    this.streamRouter.onSurfaceCreated(surfaceId);
    this.surfaceRegistry.register(
      surfaceId,
      () => this._streamingState(),
      (next) => {
        this._streamingState.set(next);
        this._nudge.update((n) => n + 1);
      },
      { interactive: true },
    );
  }

  routeEvent(surfaceId: SurfaceId, event: FlatStreamEventUnion): void {
    this.streamRouter.routeStreamEventForSurface(event, surfaceId);
    this._nudge.update((n) => n + 1);
  }

  teardown(): void {
    const surfaceId = this._surfaceId;
    if (!surfaceId) return;
    this.streamRouter.onSurfaceClosed(surfaceId);
    this._surfaceId = null;
  }
}
