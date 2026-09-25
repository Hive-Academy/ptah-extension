/**
 * @ptah-extension/chat-routing — Stream routing layer.
 *
 * `StreamRouter` is the single service that combines `ConversationRegistry`
 * and `TabSessionBinding` to resolve `event.sessionId → ConversationId → TabId[]`.
 *
 * `SurfaceUpdateInbox` is the single eager intake for `surface:updated`
 * pushes: a zod-free routing-id dispatcher that lazy consumers claim
 * (TASK_2026_494).
 *
 * Boundary: tagged `scope:webview` + `type:feature`. Outbound deps:
 * `@ptah-extension/chat-state` (data-access), `@ptah-extension/chat-streaming`
 * and `@ptah-extension/chat-types` (StreamingState), `@ptah-extension/core`
 * (the `MessageHandler` contract, type-only) and `@ptah-extension/shared`
 * (util). NO inbound deps from `chat-state` or `chat-streaming` —
 * routing is the *top* of the chat dependency graph.
 */

export { StreamRouter } from './lib/stream-router.service';

export {
  StreamingSurfaceRegistry,
  type SurfaceAdapter,
} from './lib/streaming-surface-registry.service';

export { WorkflowSessionClaimService } from './lib/workflow-session-claim.service';

export {
  SurfaceUpdateInbox,
  type SurfaceUpdateListener,
} from './lib/surface-update-inbox.service';
