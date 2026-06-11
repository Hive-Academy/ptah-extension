import { Injectable, computed, signal } from '@angular/core';
import type { SurfaceId } from '@ptah-extension/chat-state';

@Injectable({ providedIn: 'root' })
export class WorkflowSessionClaimService {
  private readonly _claims = signal<ReadonlyMap<string, SurfaceId>>(new Map());

  readonly hasClaims = computed(() => this._claims().size > 0);

  claim(correlationId: string, surfaceId: SurfaceId): void {
    this._claims.update((prev) => {
      const next = new Map(prev);
      next.set(correlationId, surfaceId);
      return next;
    });
  }

  release(correlationId: string): void {
    if (!this._claims().has(correlationId)) return;
    this._claims.update((prev) => {
      const next = new Map(prev);
      next.delete(correlationId);
      return next;
    });
  }

  surfaceFor(correlationId: string): SurfaceId | null {
    return this._claims().get(correlationId) ?? null;
  }
}
