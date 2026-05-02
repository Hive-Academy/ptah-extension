/**
 * DI Token Registry — Messaging Gateway Tokens.
 *
 * Convention mirrors `libs/backend/agent-sdk/src/lib/di/tokens.ts`:
 * - Always `Symbol.for('Name')` (globally interned).
 * - Each description is globally unique across all token files.
 * - Frozen `as const` so consumer types narrow on the symbol values.
 */
export const GATEWAY_TOKENS = {
  /** GatewayService — top-level facade. */
  GATEWAY_SERVICE: Symbol.for('GatewayService'),
  /** ITokenVault — encrypts/decrypts platform tokens. */
  GATEWAY_TOKEN_VAULT: Symbol.for('GatewayTokenVault'),
  /** BindingStore — gateway_bindings persistence. */
  GATEWAY_BINDING_STORE: Symbol.for('GatewayBindingStore'),
  /** MessageStore — gateway_messages persistence. */
  GATEWAY_MESSAGE_STORE: Symbol.for('GatewayMessageStore'),
  /** StreamCoalescer factory. */
  GATEWAY_STREAM_COALESCER: Symbol.for('GatewayStreamCoalescer'),
  /** WhisperTranscriber — voice → text. */
  GATEWAY_WHISPER_TRANSCRIBER: Symbol.for('GatewayWhisperTranscriber'),
  /** FfmpegDecoder — OGG/Opus → 16kHz WAV. */
  GATEWAY_FFMPEG_DECODER: Symbol.for('GatewayFfmpegDecoder'),
  /** Per-platform IMessagingAdapter factories. */
  GATEWAY_TELEGRAM_ADAPTER: Symbol.for('GatewayTelegramAdapter'),
  GATEWAY_DISCORD_ADAPTER: Symbol.for('GatewayDiscordAdapter'),
  GATEWAY_SLACK_ADAPTER: Symbol.for('GatewaySlackAdapter'),
} as const;

export type GatewayDIToken = keyof typeof GATEWAY_TOKENS;
