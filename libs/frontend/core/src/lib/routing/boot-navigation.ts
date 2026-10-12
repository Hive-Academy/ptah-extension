/**
 * Decides the webview's first navigation (TASK_2026_524, decision D5).
 *
 * A pure, total function: no I/O, no Angular. The boot path gathers the three
 * inputs and acts on the returned plan.
 *
 * Precedence:
 *  1. `window.initialView`, the DevTools override — always explicit;
 *  2. the host's `ptahConfig.initialView`, when it is non-null and differs
 *     from the persisted `seed` (or nothing was persisted) — a new deep link;
 *  3. the persisted route;
 *  4. the host value as a surface id (normalised by the caller, which falls
 *     back to `chat`).
 *
 * Rule 2 compares against `seed` because VS Code reloads an existing panel
 * with the same HTML: an editor panel opened on `analytics` still carries
 * `initialView: 'analytics'` after the user moved on, and Electron always
 * sends `'chat'`. A host value equal to the seed was already consumed, so the
 * persisted route wins.
 */

import type { WebviewRouteState } from '@ptah-extension/shared';

export interface BootInput {
  /** `window.initialView` — the DevTools override. */
  readonly devToolsOverride: string | undefined;
  /** `ptahConfig.initialView` — the host's deep link. */
  readonly hostInitialView: string | null | undefined;
  /** `parseWebviewRouteState(getState())`. */
  readonly restored: WebviewRouteState | null;
}

/**
 * What the boot path does first.
 *
 * `seed` is the host value to persist with the next route write. The DevTools
 * override is never a seed.
 */
export type BootPlan =
  | {
      readonly kind: 'route';
      readonly route: string;
      readonly seed: string | null;
    }
  | {
      readonly kind: 'surface';
      readonly rawView: string | undefined;
      readonly seed: string | null;
    };

export function resolveBootNavigation(input: BootInput): BootPlan {
  const { devToolsOverride, hostInitialView, restored } = input;
  const seed = hostInitialView ?? restored?.seed ?? null;

  if (devToolsOverride !== undefined) {
    return { kind: 'surface', rawView: devToolsOverride, seed };
  }
  if (hostInitialView != null && hostInitialView !== restored?.seed) {
    return { kind: 'surface', rawView: hostInitialView, seed };
  }
  if (restored !== null) {
    return { kind: 'route', route: restored.route, seed };
  }
  return { kind: 'surface', rawView: hostInitialView ?? undefined, seed };
}
