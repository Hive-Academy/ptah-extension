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
export type { ProviderModelSelection } from './provider-model-picker.component';
export { PROVIDER_MODELS_LOADER } from './provider-models-loader.port';
export type { ProviderModelsLoader } from './provider-models-loader.port';
