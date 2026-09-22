/**
 * The frontend's view onto the surface-id contract.
 *
 * The list, the `ViewType` union and the predicates **live in
 * `@ptah-extension/shared`** and are re-exported here. That is not indirection
 * for its own sake: `WebviewHtmlGenerator` in `apps/ptah-extension-vscode` has
 * to validate `initialView` against the same list, it is extension-host code,
 * and a backend-to-frontend import is forbidden. `libs/shared` is the one
 * sanctioned bridge, so it owns the ids (TASK_2026_524 revision 1, F4).
 *
 * This file stays because it is the specifier every frontend consumer already
 * imports from, and because `@ptah-extension/core` is where the routing seam
 * lives. Add nothing here that the extension host might also need — put it in
 * `libs/shared/src/lib/types/webview-surface.types.ts` instead.
 *
 * URL → surface parsing is deliberately NOT here. It needs Angular's URL
 * grammar (matrix parameters are legal on a segment), so it lives in
 * `SurfaceRouterService`, which has the Router to parse with.
 */

export {
  ACCEPTED_INITIAL_VIEWS,
  DEFAULT_SURFACE_ID,
  LEGACY_SURFACE_ALIASES,
  SURFACE_ROUTE_IDS,
  isAcceptedInitialView,
  isSurfaceRouteId,
  surfaceIdFromSegment,
  surfaceRoutePath,
  type ViewType,
} from '@ptah-extension/shared';
