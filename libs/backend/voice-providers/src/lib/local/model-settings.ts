/**
 * Settings → `VoiceModelSpec` resolution for the local providers (FR-4).
 * Reads the per-direction source toggle + custom id/path from settings, with
 * the legacy `gateway.voice.whisperModel` fallback moved here.
 *
 * FR-4.4 recoverability: a bad custom source never mutates the last-known-good
 * curated value — switching the source back to `'curated'` always restores a
 * working config (curated name lives in a separate settings key).
 */
import type { VoiceModelSpec } from '@ptah-extension/voice-contracts';
import { DEFAULT_KOKORO_MODEL_ID } from '../worker/kokoro-pipeline';

/** Minimal config reader — satisfied by `IWorkspaceProvider`. */
export interface VoiceSettingsReader {
  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined;
}

export const VOICE_WHISPER_MODEL_KEY = 'voice.whisperModel';
export const VOICE_WHISPER_MODEL_SOURCE_KEY = 'voice.whisperModelSource';
export const VOICE_WHISPER_CUSTOM_MODEL_KEY = 'voice.whisperCustomModel';
export const LEGACY_GATEWAY_WHISPER_MODEL_KEY = 'gateway.voice.whisperModel';
export const DEFAULT_WHISPER_MODEL = 'base.en';

export const VOICE_TTS_VOICE_KEY = 'voice.ttsVoice';
export const VOICE_KOKORO_MODEL_SOURCE_KEY = 'voice.kokoroModelSource';
export const VOICE_KOKORO_CUSTOM_MODEL_KEY = 'voice.kokoroCustomModel';

type ModelSource = 'curated' | 'hf' | 'dir';

function readString(
  reader: VoiceSettingsReader,
  key: string,
  fallback = '',
): string {
  const value = reader.getConfiguration<string>('ptah', key, fallback);
  return typeof value === 'string' ? value.trim() : fallback;
}

function readSource(reader: VoiceSettingsReader, key: string): ModelSource {
  const value = readString(reader, key, 'curated');
  return value === 'hf' || value === 'dir' ? value : 'curated';
}

/**
 * The curated Whisper model name with the legacy fallback chain:
 *   voice.whisperModel → gateway.voice.whisperModel → base.en.
 */
export function resolveWhisperModel(reader: VoiceSettingsReader): string {
  const fresh = readString(reader, VOICE_WHISPER_MODEL_KEY);
  if (fresh.length > 0) return fresh;
  const legacy = readString(reader, LEGACY_GATEWAY_WHISPER_MODEL_KEY);
  if (legacy.length > 0) return legacy;
  return DEFAULT_WHISPER_MODEL;
}

/**
 * Resolve the active STT `VoiceModelSpec`. `override` (a curated model name,
 * e.g. from `voice:downloadModel { model }`) forces the curated source.
 */
export function resolveSttModelSpec(
  reader: VoiceSettingsReader,
  override?: string,
): VoiceModelSpec {
  const trimmedOverride = override?.trim();
  if (trimmedOverride && trimmedOverride.length > 0) {
    return { kind: 'curated', name: trimmedOverride };
  }
  const source = readSource(reader, VOICE_WHISPER_MODEL_SOURCE_KEY);
  if (source === 'hf') {
    const repoId = readString(reader, VOICE_WHISPER_CUSTOM_MODEL_KEY);
    if (repoId.length > 0) return { kind: 'hf', repoId };
  } else if (source === 'dir') {
    const dir = readString(reader, VOICE_WHISPER_CUSTOM_MODEL_KEY);
    if (dir.length > 0) return { kind: 'dir', path: dir };
  }
  return { kind: 'curated', name: resolveWhisperModel(reader) };
}

/** The configured Kokoro voice (default `af_heart`). */
export function resolveTtsVoice(reader: VoiceSettingsReader): string {
  const voice = readString(reader, VOICE_TTS_VOICE_KEY);
  return voice.length > 0 ? voice : 'af_heart';
}

/** Resolve the active TTS `VoiceModelSpec`. */
export function resolveTtsModelSpec(
  reader: VoiceSettingsReader,
): VoiceModelSpec {
  const source = readSource(reader, VOICE_KOKORO_MODEL_SOURCE_KEY);
  if (source === 'hf') {
    const repoId = readString(reader, VOICE_KOKORO_CUSTOM_MODEL_KEY);
    if (repoId.length > 0) return { kind: 'hf', repoId };
  } else if (source === 'dir') {
    const dir = readString(reader, VOICE_KOKORO_CUSTOM_MODEL_KEY);
    if (dir.length > 0) return { kind: 'dir', path: dir };
  }
  return { kind: 'curated', name: DEFAULT_KOKORO_MODEL_ID };
}
