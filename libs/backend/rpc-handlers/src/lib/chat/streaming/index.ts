/**
 * Chat streaming sub-barrel.
 *
 * Re-exports the broadcaster service that owns the webview event loop
 * and the background-agent-completed subscription.
 */
export {
  ChatStreamBroadcaster,
  DEBUG_LOG_EVERY_N_EVENTS,
  type WebviewManager,
} from './chat-stream-broadcaster.service';
export {
  StreamBatchBuffer,
  STREAM_BATCH_INTERVAL_MS,
  STREAM_BATCH_MAX_EVENTS,
  type BatchSink,
  type StreamBatchBufferOptions,
} from './stream-batch-buffer';
