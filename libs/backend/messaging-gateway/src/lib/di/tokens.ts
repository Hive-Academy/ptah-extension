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
  /** ConversationStore — gateway_conversations persistence. */
  GATEWAY_CONVERSATION_STORE: Symbol.for('PtahGatewayConversationStore'),
  /** MessageStore — gateway_messages persistence. */
  GATEWAY_MESSAGE_STORE: Symbol.for('PtahGatewayMessageStore'),
  /** StreamCoalescer factory. */
  GATEWAY_STREAM_COALESCER: Symbol.for('PtahGatewayStreamCoalescer'),
  /** WhisperTranscriber — voice → text. */
  GATEWAY_WHISPER_TRANSCRIBER: Symbol.for('PtahGatewayWhisperTranscriber'),
  /** KokoroSynthesizer — text → voice. */
  GATEWAY_KOKORO_SYNTHESIZER: Symbol.for('PtahGatewayKokoroSynthesizer'),
  /** FfmpegDecoder — OGG/Opus → 16kHz WAV. */
  GATEWAY_FFMPEG_DECODER: Symbol.for('PtahGatewayFfmpegDecoder'),
  /** AttachedSessionRegistry — in-memory attach contention backstop. */
  GATEWAY_ATTACHED_SESSION_REGISTRY: Symbol.for(
    'PtahGatewayAttachedSessionRegistry',
  ),
  /** ISessionResumabilityChecker — JSONL-exists check for the attach flow. */
  GATEWAY_SESSION_RESUMABILITY_CHECKER: Symbol.for(
    'PtahGatewaySessionResumabilityChecker',
  ),
  /** GatewayCommandService — control-plane command handling (never an agent turn). */
  GATEWAY_COMMAND_SERVICE: Symbol.for('PtahGatewayCommandService'),
  /** ConversationTurnTracker — per-conversation turn-in-flight signal. */
  GATEWAY_TURN_TRACKER: Symbol.for('PtahGatewayTurnTracker'),
  /** IGatewaySessionLister — per-workspace resumable-session listing (host impl). */
  GATEWAY_SESSION_LISTER: Symbol.for('PtahGatewaySessionLister'),
  /** ISessionActivityProbe — is a session mid-turn in the agent adapter (host impl). */
  GATEWAY_SESSION_ACTIVITY_PROBE: Symbol.for('PtahGatewaySessionActivityProbe'),
} as const;

export type GatewayDIToken = keyof typeof GATEWAY_TOKENS;
