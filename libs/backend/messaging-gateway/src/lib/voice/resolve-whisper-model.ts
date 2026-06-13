/**
 * resolveWhisperModel — shared fallback chain for the Whisper voice model.
 *
 * The model setting moved out of the gateway namespace into a shared
 * `voice.whisperModel` key. Existing installs may still carry a customized
 * `gateway.voice.whisperModel` in ~/.ptah/settings.json, so reads resolve:
 *   stored voice.whisperModel -> stored gateway.voice.whisperModel -> base.en.
 *
 * An empty-string sentinel default is passed to getConfiguration so an unset
 * key resolves to '' (caller default wins over the registry default in
 * PtahFileSettingsManager.get) — letting us distinguish "never set" from
 * "resolved to its registry default".
 */

export const VOICE_WHISPER_MODEL_KEY = 'voice.whisperModel';
export const LEGACY_GATEWAY_WHISPER_MODEL_KEY = 'gateway.voice.whisperModel';
export const DEFAULT_WHISPER_MODEL = 'base.en';

export interface WhisperModelConfigReader {
  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined;
}

export function resolveWhisperModel(
  workspace: WhisperModelConfigReader,
): string {
  const fresh = workspace.getConfiguration<string>(
    'ptah',
    VOICE_WHISPER_MODEL_KEY,
    '',
  );
  if (typeof fresh === 'string' && fresh.trim().length > 0) {
    return fresh.trim();
  }

  const legacy = workspace.getConfiguration<string>(
    'ptah',
    LEGACY_GATEWAY_WHISPER_MODEL_KEY,
    '',
  );
  if (typeof legacy === 'string' && legacy.trim().length > 0) {
    return legacy.trim();
  }

  return DEFAULT_WHISPER_MODEL;
}
