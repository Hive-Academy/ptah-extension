import { z } from 'zod';
import { defineSetting } from './definition';

/** Supported authentication methods. Matches AuthMethod in @ptah-extension/shared. */
export const AUTH_METHOD_SCHEMA = z.enum(['apiKey', 'claudeCli', 'thirdParty']);

export const AUTH_METHOD_DEF = defineSetting({
  key: 'authMethod',
  scope: 'global',
  sensitivity: 'plain',
  schema: AUTH_METHOD_SCHEMA,
  default: 'apiKey' as const,
  sinceVersion: 1,
});

export const ANTHROPIC_PROVIDER_ID_DEF = defineSetting({
  key: 'anthropicProviderId',
  scope: 'global',
  sensitivity: 'plain',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});
