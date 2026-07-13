import { z } from 'zod';

const MAX_DECODED_BYTES = 25 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_DECODED_BYTES / 3) * 4;

export const VoiceTranscribeParamsSchema = z.object({
  audioBase64: z
    .string()
    .min(1, 'audioBase64 must be a non-empty string')
    .max(MAX_BASE64_LENGTH, 'audioBase64 exceeds the 25MB size limit'),
  mimeType: z.string().min(1, 'mimeType must be a non-empty string'),
});

export type VoiceTranscribeParamsParsed = z.infer<
  typeof VoiceTranscribeParamsSchema
>;

/**
 * Model source toggle (FR-4). `curated` uses the built-in model name; `hf`/`dir`
 * pull from a user-supplied HF repo id / local directory (`customModel`).
 */
const MODEL_SOURCE = z.enum(['curated', 'hf', 'dir']);

/**
 * A user-provided custom model source — an HF repo id (e.g. `onnx-community/…`)
 * or an absolute local directory. Kept permissive (paths vary by OS) but bounded
 * in length; a strict id regex would reject valid `owner/name` repo ids and
 * Windows/Unix paths alike.
 */
const CUSTOM_MODEL = z
  .string()
  .trim()
  .min(1, 'customModel must be a non-empty string')
  .max(512, 'customModel must be at most 512 characters');

export const VoiceSetConfigParamsSchema = z.object({
  whisperModel: z
    .string()
    .trim()
    .min(1, 'whisperModel must be a non-empty string')
    .max(50, 'whisperModel must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'whisperModel may only contain letters, numbers, dots, hyphens, and underscores',
    ),
  modelSource: MODEL_SOURCE.optional(),
  customModel: CUSTOM_MODEL.optional(),
});

export type VoiceSetConfigParamsParsed = z.infer<
  typeof VoiceSetConfigParamsSchema
>;

export const VoiceDownloadModelParamsSchema = z.object({
  model: z
    .string()
    .trim()
    .min(1, 'model must be a non-empty string')
    .max(50, 'model must be at most 50 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'model may only contain letters, numbers, dots, hyphens, and underscores',
    )
    .optional(),
});

export type VoiceDownloadModelParamsParsed = z.infer<
  typeof VoiceDownloadModelParamsSchema
>;

const VOICE_ID = z
  .string()
  .trim()
  .min(1, 'voice must be a non-empty string')
  .max(50, 'voice must be at most 50 characters')
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    'voice may only contain letters, numbers, dots, hyphens, and underscores',
  );

export const VoiceSetTtsConfigParamsSchema = z.object({
  voice: VOICE_ID,
});

export type VoiceSetTtsConfigParamsParsed = z.infer<
  typeof VoiceSetTtsConfigParamsSchema
>;

export const VoiceSynthesizeParamsSchema = z.object({
  text: z
    .string()
    .min(1, 'text must be a non-empty string')
    .max(5000, 'text exceeds the 5000 character limit'),
  voice: VOICE_ID.optional(),
});

export type VoiceSynthesizeParamsParsed = z.infer<
  typeof VoiceSynthesizeParamsSchema
>;

// --- Provider-agnostic voice surface (FR-8) -------------------------------

/** The set of selectable voice providers. */
const PROVIDER_ID = z.enum(['local', 'elevenlabs']);

/** A generic non-secret identifier (voice id, model id, output format). */
const CONFIG_ID = z
  .string()
  .trim()
  .min(1, 'value must be a non-empty string')
  .max(64, 'value must be at most 64 characters')
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    'value may only contain letters, numbers, dots, hyphens, and underscores',
  );

export const VoiceListProvidersParamsSchema = z.object({});

export type VoiceListProvidersParamsParsed = z.infer<
  typeof VoiceListProvidersParamsSchema
>;

export const VoiceListVoicesParamsSchema = z.object({
  providerId: PROVIDER_ID,
});

export type VoiceListVoicesParamsParsed = z.infer<
  typeof VoiceListVoicesParamsSchema
>;

export const VoiceGetProviderConfigParamsSchema = z.object({});

export type VoiceGetProviderConfigParamsParsed = z.infer<
  typeof VoiceGetProviderConfigParamsSchema
>;

export const VoiceSetProviderConfigParamsSchema = z.object({
  ttsProvider: PROVIDER_ID.optional(),
  sttProvider: PROVIDER_ID.optional(),
  elevenlabs: z
    .object({
      voiceId: CONFIG_ID.optional(),
      ttsModelId: CONFIG_ID.optional(),
      outputFormat: CONFIG_ID.optional(),
      sttModelId: CONFIG_ID.optional(),
    })
    .optional(),
});

export type VoiceSetProviderConfigParamsParsed = z.infer<
  typeof VoiceSetProviderConfigParamsSchema
>;

export const VoiceSetApiKeyParamsSchema = z.object({
  // Only cloud providers hold a key. `local` is rejected here.
  providerId: z.literal('elevenlabs'),
  // Plaintext key; empty string clears the stored key. Never logged.
  apiKey: z.string().max(256, 'apiKey must be at most 256 characters'),
});

export type VoiceSetApiKeyParamsParsed = z.infer<
  typeof VoiceSetApiKeyParamsSchema
>;

export const VoiceTestConnectionParamsSchema = z.object({
  providerId: z.literal('elevenlabs'),
  // Optional unsaved key for a pre-save probe. Never logged.
  apiKey: z
    .string()
    .min(1, 'apiKey must be a non-empty string')
    .max(256, 'apiKey must be at most 256 characters')
    .optional(),
});

export type VoiceTestConnectionParamsParsed = z.infer<
  typeof VoiceTestConnectionParamsSchema
>;
