export { MemoryPlatformLocation } from './memory-platform-location';
export { SURFACE_ACTIVE, provideSurfaceActive } from './surface-active';
export {
  SurfaceRouterService,
  surfaceNavigationLanded,
  type SurfaceNavigationResult,
} from './surface-router.service';
// `ViewType` is deliberately NOT re-exported here. It is declared in
// `@ptah-extension/shared` (`webview-surface.types.ts`) so the extension host
// can validate against the same contract, and it reaches
// `@ptah-extension/core` consumers through `app-state.service.ts`, which is the
// specifier every caller already uses.
export {
  ACCEPTED_INITIAL_VIEWS,
  DEFAULT_SURFACE_ID,
  LEGACY_SURFACE_ALIASES,
  SURFACE_ROUTE_IDS,
  isAcceptedInitialView,
  isSurfaceRouteId,
  surfaceIdFromSegment,
  surfaceRoutePath,
} from './surface-routes';
