import { signal, type Provider, type Signal } from '@angular/core';
import { SURFACE_ACTIVE } from '../lib/routing/surface-active';

/**
 * Bind `SURFACE_ACTIVE` for a spec that instantiates a gated consumer.
 *
 * Every consumer inside `scope:webview` injects the token NON-optionally, on
 * purpose: the webview binds it at the composition root, per route and through
 * `SurfaceActiveDirective`, so a missing binding is a wiring bug. An optional
 * inject would instead fall back to "always active", which reads as success —
 * the gate would be dead, nothing would throttle, and every test would stay
 * green. Failing loudly is the point, so a spec supplies the value explicitly
 * rather than production code guessing one.
 *
 * `libs/frontend/markdown` injects nothing at all. It is `scope:shared` and
 * `apps/ptah-landing-page` consumes it, so it cannot depend on a token that
 * only the webview binds. `SurfaceMarkdownPipe.transform` takes activity as an
 * ARGUMENT instead, which leaves the decision with the webview host that knows
 * the answer and keeps the landing page working without a provider. A spec for
 * that pipe passes the boolean directly and needs nothing from here.
 *
 * Pass a writable signal instead of a boolean when the spec needs to toggle
 * activity mid-test and assert the pause and the reactivation.
 */
export function provideSurfaceActiveTesting(
  active: boolean | Signal<boolean> = true,
): Provider {
  const value = typeof active === 'boolean' ? signal(active) : active;
  return { provide: SURFACE_ACTIVE, useValue: value };
}
