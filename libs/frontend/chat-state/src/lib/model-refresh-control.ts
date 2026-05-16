/**
 * ModelRefreshControl — Inverted-dependency contract for refreshing the
 * available-models list after `TabManagerService.createTab()`.
 *
 * `chat-state` is tagged `type:data-access`, which per the Nx module-boundary
 * rules can only depend on `type:data-access` and `type:util`. Owning a thin
 * contract here lets the concrete `ModelStateService` adapter live in
 * `@ptah-extension/chat` (`type:feature`, allowed to depend on `type:core`)
 * and bind the token in the application's composition root.
 *
 * IMPORTANT: This module MUST NOT import `ModelStateService` or any other
 * service from `@ptah-extension/core`. Doing so re-introduces the boundary
 * violation.
 */

import { InjectionToken } from '@angular/core';

/**
 * Operation that TabManagerService invokes after creating a brand-new tab so
 * that the model selector picks up any newly-installed CLIs/agents.
 */
export interface ModelRefreshControl {
  /**
   * Refresh the available-models list. Failures should be logged by the
   * implementation but must not throw — `createTab()` is a UI-blocking call
   * and a stale model list is far better than an unhandled rejection.
   */
  refreshModels(): Promise<void>;
}

/**
 * DI token for `ModelRefreshControl`. Bound in
 * `apps/ptah-extension-webview/src/app/app.config.ts` via
 * `provideModelRefreshControl()`.
 */
export const MODEL_REFRESH_CONTROL = new InjectionToken<ModelRefreshControl>(
  'MODEL_REFRESH_CONTROL',
);
