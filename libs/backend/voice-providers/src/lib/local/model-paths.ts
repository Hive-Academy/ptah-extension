/**
 * Main-side model-presence checks (moved from `WhisperTranscriber` /
 * `KokoroSynthesizer` `isModelDownloaded`). Pure fs math against the model
 * cache dir + model-id path — no worker spawn just to render a badge.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { VoiceModelSpec } from '@ptah-extension/voice-contracts';
import { WHISPER_MODELS, whisperModelIdFor } from '../worker/whisper-pipeline';
import { DEFAULT_KOKORO_MODEL_ID } from '../worker/kokoro-pipeline';

async function dirIsNonEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { recursive: true });
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function isRepoCached(
  modelCacheDir: string | null,
  repoId: string,
): Promise<boolean> {
  if (!modelCacheDir) return false;
  return dirIsNonEmpty(path.join(modelCacheDir, ...repoId.split('/')));
}

/** Whether the resolved Whisper model is present (curated/hf in cache; dir on disk). */
export async function isWhisperModelDownloaded(
  modelCacheDir: string | null,
  model: VoiceModelSpec,
): Promise<boolean> {
  switch (model.kind) {
    case 'curated': {
      const name = model.name.trim();
      if (!WHISPER_MODELS.has(name)) return false;
      return isRepoCached(modelCacheDir, whisperModelIdFor(name));
    }
    case 'hf':
      return isRepoCached(modelCacheDir, model.repoId);
    case 'dir':
      return dirIsNonEmpty(model.path);
  }
}

/** Whether the resolved Kokoro model is present. */
export async function isKokoroModelDownloaded(
  modelCacheDir: string | null,
  model: VoiceModelSpec,
): Promise<boolean> {
  switch (model.kind) {
    case 'curated': {
      const repo =
        model.name && model.name.length > 0
          ? model.name
          : DEFAULT_KOKORO_MODEL_ID;
      return isRepoCached(modelCacheDir, repo);
    }
    case 'hf':
      return isRepoCached(modelCacheDir, model.repoId);
    case 'dir':
      return dirIsNonEmpty(model.path);
  }
}
