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
});

export type VoiceSetConfigParamsParsed = z.infer<
  typeof VoiceSetConfigParamsSchema
>;
