/**
 * Setup Wizard Library - composition-root entry point
 *
 * Narrow barrel for the webview's eager composition root: the two routed
 * components (`app.routes.ts`) and the providers and push handlers that must
 * register at bootstrap (`app.config.ts`). Nothing else.
 *
 *   import { WizardViewComponent } from '@ptah-extension/setup-wizard/app';
 *
 * Why it exists: every wizard step after `welcome`, the selection list and the
 * next-steps panel render inside `@defer`. A static import of the wide
 * `@ptah-extension/setup-wizard` barrel re-exports those same components, and
 * esbuild then keeps them in the initial bundle next to their lazy chunk. That
 * cancels the deferral (about 208 kB of setup-wizard code, measured from the
 * production metafile, TASK_2026_701). Eager code imports from here; the wide
 * barrel is for specs and other consumers.
 */

export { WizardViewComponent } from './lib/components/wizard-view.component';
export { GenerationWorkflowShellComponent } from './lib/components/generation-workflow-shell.component';
export { SetupWizardStateService } from './lib/services/setup-wizard-state.service';
export { SetupGenerationOpenHandler } from './lib/services/setup-generation-open.handler';
export { GenerationRunEventAdapter } from './lib/services/generation-run-event-adapter';
export { provideWizardInternalState } from './lib/services/wizard-internal-state.provider';
export { provideSetupWizardFocusRouter } from './lib/services/setup-wizard-focus-router.provider';
