/**
 * DI Token Registry — Messaging Gateway Tokens.
 *
 * Convention mirrors `libs/backend/agent-sdk/src/lib/di/tokens.ts`:
 * - Always `Symbol.for('Name')` (globally interned).
 * - Each description is globally unique across all token files (Ptah-prefixed).
 * - Frozen `as const` so consumer types narrow on the symbol values.
 */
export const GATEWAY_TOKENS = {
  /** GatewayService — top-level facade. */
  GATEWAY_SERVICE: Symbol.for('PtahGatewayService'),
  /** ITokenVault — encrypts/decrypts platform tokens. */
  GATEWAY_TOKEN_VAULT: Symbol.for('PtahGatewayTokenVault'),
  /** BindingStore — gateway_bindings persistence. */
  GATEWAY_BINDING_STORE: Symbol.for('PtahGatewayBindingStore'),
  /** MessageStore — gateway_messages persistence. */
  GATEWAY_MESSAGE_STORE: Symbol.for('PtahGatewayMessageStore'),
  /** StreamCoalescer factory. */
  GATEWAY_STREAM_COALESCER: Symbol.for('PtahGatewayStreamCoalescer'),
  /** WhisperTranscriber — voice → text. */
  GATEWAY_WHISPER_TRANSCRIBER: Symbol.for('PtahGatewayWhisperTranscriber'),
  /** FfmpegDecoder — OGG/Opus → 16kHz WAV. */
  GATEWAY_FFMPEG_DECODER: Symbol.for('PtahGatewayFfmpegDecoder'),
} as const;

export type GatewayDIToken = keyof typeof GATEWAY_TOKENS;
