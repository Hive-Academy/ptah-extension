/**
 * Provider profile — the resolved per-session auth/model bundle handed to the
 * agent SDK. The matching `ProviderProfileSchema` lives in
 * `provider-profile.schemas.ts` so this type carries no `zod` dependency.
 */

import type { ProviderAccountBinding } from './provider-account.types';

/** Anthropic-shaped auth environment carried by a {@link ProviderProfile}. */
export interface ProviderProfileAuthEnv {
  ANTHROPIC_API_KEY?: string | undefined;
  ANTHROPIC_BASE_URL?: string | undefined;
  ANTHROPIC_AUTH_TOKEN?: string | undefined;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string | undefined;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string | undefined;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string | undefined;
}

/** Resolved provider profile for a single session. */
export interface ProviderProfile {
  /** Backend-admitted immutable snapshot; absence preserves legacy routing. */
  accountBinding?: ProviderAccountBinding | undefined;
  /** Opaque authoritative registry linkage, never an account directory. */
  accountBindingId?: string | undefined;
  providerId: string;
  authEnv: ProviderProfileAuthEnv;
  model: string;
  baseUrl?: string | undefined;
  cliJsPath?: string | undefined;
  defaultMaxTokens?: number | undefined;
  reasoningEffort?: '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
}
