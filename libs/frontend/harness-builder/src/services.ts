/**
 * Harness Builder Library - Services-only entry point
 *
 * Lightweight barrel that exports only services — no components. Use this
 * import path from eager code (e.g. the webview's `app.config.ts`, which
 * registers `HarnessWorkflowMessageHandler` in `MESSAGE_HANDLERS`) so that
 * registering the message handler does not drag `HarnessBuilderViewComponent`
 * and `SetupHubComponent` into the initial bundle:
 *
 *   import { HarnessWorkflowMessageHandler } from '@ptah-extension/harness-builder/services';
 *
 * For components, use the main entry point — which should only ever be reached
 * through a dynamic `import()`. Both the harness-builder and setup-hub views
 * resolve out of this one library, so a single lazy chunk serves both:
 *
 *   import('@ptah-extension/harness-builder').then((m) => m.SetupHubComponent);
 *
 * @see TASK_2026_187
 */

export { HarnessBuilderStateService } from './lib/services/harness-builder-state.service';
export { HarnessRpcService } from './lib/services/harness-rpc.service';
export {
  HarnessWorkflowService,
  type HarnessWorkflowMode,
} from './lib/services/harness-workflow.service';
export { HarnessWorkflowMessageHandler } from './lib/services/harness-workflow-message.handler';
