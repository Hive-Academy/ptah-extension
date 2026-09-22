import { computed, inject, type Signal } from '@angular/core';
import { SurfaceRouterService } from './surface-router.service';
import type { ViewType } from './surface-routes';

export { SURFACE_ACTIVE } from '@ptah-extension/shared/angular';

/** Route environment injectors and persistent element injectors use the same source. */
export function surfaceActiveFor(surface: ViewType): () => Signal<boolean> {
  return () => {
    const router = inject(SurfaceRouterService);
    return computed(() => router.currentSurface() === surface);
  };
}
