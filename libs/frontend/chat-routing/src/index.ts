/**
 * @ptah-extension/chat-routing — Stream routing layer.
 *
 * TASK_2026_106 Phase 2: introduces `StreamRouter`, the single service
 * that combines `ConversationRegistry` and `TabSessionBinding` to
 * resolve `event.sessionId → ConversationId → TabId[]`. Currently
 * deployed in shadow mode (observes events, builds registry/binding,
 * does not write to `TabManager`). Phase 3 cuts over.
 *
 * Boundary: tagged `scope:webview` + `type:feature`. Outbound deps:
 * `@ptah-extension/chat-state` (data-access) and `@ptah-extension/shared`
 * (util). NO inbound deps from `chat-state` or `chat-streaming` —
 * routing is the *top* of the chat dependency graph.
 */

export { StreamRouter } from './lib/stream-router.service';
