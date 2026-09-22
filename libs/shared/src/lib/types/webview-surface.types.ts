/**
 * The webview's surface ids — the ONE list, and the contract both sides of the
 * host boundary validate against.
 *
 * **Why this lives in `libs/shared`.** Three places used to keep their own
 * allow-list of view names and all three disagreed: `App.handleInitialView`
 * (8 entries), `AppStateManager.handleMessage` (13) and
 * `WebviewHtmlGenerator._getHtmlForWebview` (6). TASK_2026_524 collapsed them
 * into one list. The first two are Angular code and could have read it from
 * `@ptah-extension/core`; the third is **extension-host code**, and a
 * backend-to-frontend import is forbidden. `libs/shared` is the one sanctioned
 * bridge, so the list and the union it enumerates live here and
 * `libs/frontend/core/src/lib/routing/surface-routes.ts` re-exports them for
 * every existing frontend consumer.
 *
 * This module is deliberately dependency-free — no Angular, no Node, no
 * `vscode` — because both the renderer and the extension host import it.
 *
 * TASK_2026_492_0bcc remaps these surfaces into two navigation sets. Keeping
 * every id here is what makes that remap a single edit.
 */

/**
 * A surface the user can be looking at.
 *
 * Every member except `orchestra-canvas` is a route id — see
 * {@link SURFACE_ROUTE_IDS}. `orchestra-canvas` is the one legacy alias: it
 * used to be a view and is now a layout mode of the chat surface, so
 * `AppStateManager.normalizeInitialView` maps it onto `chat` plus grid layout.
 * It is still a legal wire value — `ptah.openOrchestraCanvas` sends it — which
 * is why {@link ACCEPTED_INITIAL_VIEWS} accepts it and
 * {@link SURFACE_ROUTE_IDS} does not.
 *
 * `command-builder` and `context-tree` were removed from this union by
 * TASK_2026_524: both were listed in three allow-lists and had no render
 * branch anywhere in the application, so no navigation to either could ever
 * have displayed anything.
 */
export type ViewType =
  | 'chat'
  | 'analytics'
  | 'settings'
  | 'setup-wizard'
  | 'orchestra-canvas'
  | 'harness-builder'
  | 'setup-hub'
  | 'thoth'
  | 'marketplace'
  | 'tribunal'
  | 'tasks';

/**
 * Every surface that has a route, in the order the route table declares them.
 *
 * `chat` is included and is the default, even though the chat and canvas
 * content area is deliberately NOT rendered through the outlet — its route
 * exists so that "no standalone surface is showing" is an addressable state
 * rather than the absence of one.
 */
export const SURFACE_ROUTE_IDS: readonly ViewType[] = [
  'chat',
  'setup-wizard',
  'settings',
  'analytics',
  'harness-builder',
  'setup-hub',
  'thoth',
  'marketplace',
  'tribunal',
  'tasks',
];

/**
 * View ids the host may still send that are NOT routes, each of which the
 * renderer rewrites onto a real surface.
 *
 * One entry, and it is load-bearing: `ptah.openOrchestraCanvas`
 * (`apps/ptah-extension-vscode/src/core/ptah-extension.ts`) passes
 * `initialView: 'orchestra-canvas'`. Dropping it from the host allow-list is
 * what made that command open an empty panel — the generator threw, the public
 * boundary swallowed the throw and returned fallback HTML whose root element
 * does not match the app's selector.
 */
export const LEGACY_SURFACE_ALIASES: readonly ViewType[] = ['orchestra-canvas'];

/**
 * Every value a host may legally pass as `initialView`, or send in a
 * `SWITCH_VIEW` message.
 *
 * This is what both `WebviewHtmlGenerator` and
 * `AppStateManager.normalizeInitialView` validate against, so the host can
 * never reject a surface the renderer can reach, nor accept one it cannot.
 */
export const ACCEPTED_INITIAL_VIEWS: readonly ViewType[] = [
  ...SURFACE_ROUTE_IDS,
  ...LEGACY_SURFACE_ALIASES,
];

/** Where an unknown, missing or non-routable surface id lands. */
export const DEFAULT_SURFACE_ID: ViewType = 'chat';

/** Whether `value` is one of {@link SURFACE_ROUTE_IDS}. */
export function isSurfaceRouteId(value: unknown): value is ViewType {
  return (
    typeof value === 'string' &&
    (SURFACE_ROUTE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Whether `value` is something a host may legally send — a route id or a
 * legacy alias.
 */
export function isAcceptedInitialView(value: unknown): value is ViewType {
  return (
    typeof value === 'string' &&
    (ACCEPTED_INITIAL_VIEWS as readonly string[]).includes(value)
  );
}

/** The absolute router URL that addresses `id`. */
export function surfaceRoutePath(id: ViewType): string {
  return `/${id}`;
}

/**
 * The surface a **parsed** primary URL segment addresses.
 *
 * Takes a segment path, not a URL. Angular's URL grammar allows matrix
 * parameters on a segment (`/settings;panel=auth`), and the string surgery
 * this replaced compared the raw `settings;panel=auth` against the id list —
 * so the Router activated the settings route while the surface signal reported
 * `chat` and the outlet hid itself (TASK_2026_524 revision 1, F5). Parsing is
 * the Router's job; `SurfaceRouterService` hands the already-parsed segment
 * path in.
 *
 * Falls back to {@link DEFAULT_SURFACE_ID} for the empty URL the Router holds
 * before the first navigation and for anything unrecognised, so the return
 * type stays total and no caller has to handle a null surface.
 */
export function surfaceIdFromSegment(path: string | undefined): ViewType {
  return isSurfaceRouteId(path) ? path : DEFAULT_SURFACE_ID;
}
