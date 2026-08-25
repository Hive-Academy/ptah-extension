/**
 * The one dependency {@link ProviderModelPickerComponent} has on the outside
 * world, expressed as a port rather than a concrete service.
 *
 * WHY A PORT AND NOT AN RPC CALL. `libs/frontend/ui` is tagged
 * `["scope:webview", "type:ui"]`, and the Nx module-boundary rule for
 * `sourceTag: 'type:ui'` restricts it to `['type:ui', 'type:util']`
 * (root `eslint.config.mjs`). `@ptah-extension/core` — which owns
 * `VSCodeService` and therefore every RPC round-trip — is `type:core`, so
 * importing it from here is a lint error, not a style opinion.
 * `@ptah-extension/shared` is `type:util`, which is why the wire *types*
 * below are legal while the transport is not.
 *
 * The practical payoff is host portability: the Electron-only Memory tab
 * provides `MemoryDiagnosticsRpcService`, while the Skills tab — which ships
 * to the VS Code webview AND Electron — provides its own RPC service. Both
 * already expose `listModels(providerId?)` against the generic
 * `provider:listModels` method, so both satisfy this port structurally with
 * no adapter.
 *
 * @module native/provider-model-picker
 */
import { InjectionToken } from '@angular/core';
import type { ProviderListModelsResult } from '@ptah-extension/shared';

/**
 * Loads the model catalogue for a provider.
 *
 * Implementations are expected to resolve — not reject — for the ordinary
 * "provider is misconfigured" case, reporting it through
 * {@link ProviderListModelsResult.error}. The picker handles a rejection too,
 * but a resolved error keeps the already-loaded list visible.
 */
export interface ProviderModelsLoader {
  /**
   * @param providerId Registry id to list models for, or `undefined` to list
   *   models for whichever provider the host has active. The picker passes
   *   `undefined` (never `''`) when no provider is pinned.
   */
  listModels(providerId?: string): Promise<ProviderListModelsResult>;
}

/**
 * Provide this wherever a `<ptah-provider-model-picker>` is rendered. It is
 * the ONLY token the picker injects — see the injector-surface assertions in
 * `provider-model-picker.component.spec.ts`.
 */
export const PROVIDER_MODELS_LOADER = new InjectionToken<ProviderModelsLoader>(
  'PROVIDER_MODELS_LOADER',
);
