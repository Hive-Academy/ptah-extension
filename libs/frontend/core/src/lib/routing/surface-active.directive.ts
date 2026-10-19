import { Directive, inject } from '@angular/core';
import { SURFACE_ACTIVE, surfaceActiveFor } from './surface-active';

/**
 * Element injector boundary for the always-mounted, non-outlet canvas tree.
 * The tree is active while the settled route is the chat surface.
 */
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
  readonly active = surfaceActiveFor('chat')();
}
