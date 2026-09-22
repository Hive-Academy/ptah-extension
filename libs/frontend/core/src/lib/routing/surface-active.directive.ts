import { Directive, computed, inject, input } from '@angular/core';
import { AppStateManager } from '../services/app-state.service';
import { SURFACE_ACTIVE, surfaceActiveFor } from './surface-active';

/** Element injector boundary for the two always-mounted, non-outlet trees. */
@Directive({
  selector: '[ptahSurfaceActive]',
  standalone: true,
  providers: [
    {
      provide: SURFACE_ACTIVE,
      useFactory: () => inject(SurfaceActiveDirective).active,
    },
  ],
})
export class SurfaceActiveDirective {
  readonly surface = input.required<'chat' | 'canvas'>({
    alias: 'ptahSurfaceActive',
  });
  private readonly chatAddressed = surfaceActiveFor('chat')();
  private readonly appState = inject(AppStateManager);
  readonly active = computed(
    () =>
      this.chatAddressed() &&
      this.appState.layoutMode() ===
        (this.surface() === 'canvas' ? 'grid' : 'single'),
  );
}
