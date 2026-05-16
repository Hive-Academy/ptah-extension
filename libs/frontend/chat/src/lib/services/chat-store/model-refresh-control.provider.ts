/**
 * provideModelRefreshControl — Composition-root helper for binding the
 * `MODEL_REFRESH_CONTROL` token (from `@ptah-extension/chat-state`) to its
 * concrete `ModelStateService` implementation (from `@ptah-extension/core`).
 *
 * Mirrors `provideStreamingControl()`.
 *
 * `chat-state` (tagged `type:data-access`) cannot import
 * `@ptah-extension/core` (`type:core`) per Nx module-boundary rules. This
 * factory lives in `chat` (`type:feature`, allowed to depend on
 * `type:core`) and binds the inverted-dependency token at the application
 * composition root:
 *
 *   providers: [
 *     ...
 *     ...provideModelRefreshControl(),
 *   ]
 */

import { Provider } from '@angular/core';
import { MODEL_REFRESH_CONTROL } from '@ptah-extension/chat-state';
import { ModelStateService } from '@ptah-extension/core';

export function provideModelRefreshControl(): Provider[] {
  return [
    {
      provide: MODEL_REFRESH_CONTROL,
      useFactory: (modelState: ModelStateService) => ({
        refreshModels: () => modelState.refreshModels(),
      }),
      deps: [ModelStateService],
    },
  ];
}
