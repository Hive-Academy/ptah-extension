import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { VSCodeService } from '@ptah-extension/core';

/**
 * Lets a route match only when the webview runs inside the Electron desktop
 * app.
 *
 * It is a `canMatch` guard, not `canActivate`, on purpose: a refused match
 * happens before the Router calls the route's `loadComponent`, so a VS Code
 * webview never requests the surface's lazy chunk. The Router then tries the
 * next route, and the table's `**` fallback lands the user on `chat` — the
 * same place any other surface this host cannot show ends up.
 *
 * `VSCodeService.isElectron` is read per navigation rather than captured once,
 * because the service owns the host config and is the one source of truth for
 * which host the renderer is running in.
 */
export const electronOnlySurface: CanMatchFn = () =>
  inject(VSCodeService).isElectron;
