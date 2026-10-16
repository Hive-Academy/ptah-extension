/**
 * Harness Builder Library - Services-only entry point
 *
 * Lightweight barrel that exports only services — no components. Use this
 * import path from eager code (e.g. the webview's `app.config.ts`, which
 * registers `HarnessWorkflowMessageHandler` in `MESSAGE_HANDLERS`) so that
 * registering the message handler does not drag `HarnessBuilderViewComponent`
 * and `SetupHubComponent` into the initial bundle. The handler also loads
 * workflow requests and proposal hydration on first message, so this barrel's
 * re-exports must remain tree-shakeable:
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
export { HarnessBuilderRecordsService } from './lib/services/harness-builder-records.service';
export { HarnessProposalHydrationService } from './lib/services/harness-proposal-hydration.service';
export { HarnessHelperService } from './lib/services/harness-helper.service';
export { HarnessWorkflowRequestService } from './lib/services/harness-workflow-request.service';
export { HarnessWorkflowMessageHandler } from './lib/services/harness-workflow-message.handler';
