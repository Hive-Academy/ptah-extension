/**
 * Provider / Model Picker - Barrel Export
 *
 * Domain-free provider + model selector driven by the shared provider
 * registry. Takes its model catalogue from an injected
 * {@link PROVIDER_MODELS_LOADER} so it can render in both the VS Code webview
 * and Electron without importing a `type:core` transport.
 *
 * @module native/provider-model-picker
 */
export { ProviderModelPickerComponent } from './provider-model-picker.component';
export type {
  ProviderModelSelection,
  ProviderIdentityOption,
} from './provider-model-picker.component';
// Compact, one-row searchable model control (Batch 28b): the picker's own search field, for hosts where a whole
// picker card does not fit (the Settings Main Agent popover). The host builds the options.
export { ProviderModelSearchFieldComponent } from './provider-model-search-field.component';
export type { ProviderModelSearchOption } from './provider-model-search-field.component';
export { PROVIDER_MODELS_LOADER } from './provider-models-loader.port';
export type { ProviderModelsLoader } from './provider-models-loader.port';
