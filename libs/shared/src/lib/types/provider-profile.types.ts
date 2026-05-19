import { z } from 'zod';

export const ProviderProfileSchema = z.object({
  providerId: z.string().min(1),
  authEnv: z.object({
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_BASE_URL: z.string().optional(),
    ANTHROPIC_AUTH_TOKEN: z.string().optional(),
    ANTHROPIC_DEFAULT_SONNET_MODEL: z.string().optional(),
    ANTHROPIC_DEFAULT_OPUS_MODEL: z.string().optional(),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: z.string().optional(),
  }),
  model: z.string().min(1),
  baseUrl: z.string().optional(),
  cliJsPath: z.string().optional(),
  defaultMaxTokens: z.number().int().positive().optional(),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
