/**
 * Narrow entry for embedding two settings components outside the Settings
 * page (TASK_2026_ONBOARDING, "Get ready" pre-steps). Path:
 * `@ptah-extension/chat/settings-embed`.
 *
 * Page-scope contract: a host that embeds `ProvidersSettingsComponent` or
 * `CliOrchestrationMatrixComponent` must provide `SettingsSaveFeedbackService`
 * and `PROVIDER_MODELS_LOADER` (with `ProvidersModelsLoader`), and must render
 * `<ptah-settings-toast />`, as `SettingsComponent` does. A missing provider
 * fails with a `NullInjectorError` when the embedded subtree renders.
 *
 * Import this entry only from `libs/frontend/onboarding/src/lib/ready/`, which
 * is lazy, so the eager chat barrel (`@ptah-extension/chat`) does not grow.
 */
export {
  ProvidersSettingsComponent,
  type ProvidersSettingsDrawerRequest,
} from './lib/settings/providers/providers-settings.component';
export { CliOrchestrationMatrixComponent } from './lib/settings/ptah-ai/cli-orchestration-matrix.component';
export { SettingsSaveFeedbackService } from './lib/settings/feedback/settings-save-feedback.service';
export { ProvidersModelsLoader } from './lib/settings/providers/providers-models-loader.service';
export { SettingsToastComponent } from './lib/settings/feedback/settings-toast.component';
