/**
 * IVoiceTokenVault — encrypt/decrypt port for storing the ElevenLabs API key at
 * rest as base64 ciphertext in `~/.ptah/settings.json`.
 *
 * Decision D4: this is a **structural twin** of messaging-gateway's
 * `ITokenVault` (identical 3-method shape). We deliberately do NOT import
 * `ITokenVault` — that would create a `voice-providers → messaging-gateway`
 * edge dragging grammy/discord.js/@slack/bolt into the voice dep graph. The
 * Electron host registers the SAME `ElectronSafeStorageVault` instance under
 * both `GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT` and
 * `VOICE_CONTRACT_TOKENS.VOICE_TOKEN_VAULT` via TypeScript structural typing —
 * no adapter class needed.
 *
 * Decrypt failures return `null` so callers surface a one-time
 * "please re-enter your API key" notification rather than crashing.
 */
export interface IVoiceTokenVault {
  /** True when the platform offers real (OS-keychain backed) encryption. */
  isEncryptionAvailable(): boolean;
  /** Encrypt plaintext → base64 ciphertext (string-safe for JSON). */
  encrypt(plaintext: string): string;
  /** Decrypt base64 ciphertext → plaintext, or `null` on failure. */
  decrypt(ciphertext: string): string | null;
}
