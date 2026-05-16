/**
 * @ptah-extension/chat-routing — Stream routing layer.
 *
 * `StreamRouter` is the single service that combines `ConversationRegistry`
 * and `TabSessionBinding` to resolve `event.sessionId → ConversationId → TabId[]`.
 *
 * Boundary: tagged `scope:webview` + `type:feature`. Outbound deps:
 * `@ptah-extension/chat-state` (data-access) and `@ptah-extension/shared`
 * (util). NO inbound deps from `chat-state` or `chat-streaming` —
 * routing is the *top* of the chat dependency graph.
 */

export { StreamRouter } from './lib/stream-router.service';

export {
  StreamingSurfaceRegistry,
  type SurfaceAdapter,
} from './lib/streaming-surface-registry.service';
