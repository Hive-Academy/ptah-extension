/**
 * Chat streaming sub-barrel.
 *
 * Re-exports the broadcaster service that owns the webview event loop
 * and the background-agent-completed subscription.
 */
export {
  ChatStreamBroadcaster,
  type WebviewManager,
} from './chat-stream-broadcaster.service';
