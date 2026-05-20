import { AUTH_METHOD_DEF, ANTHROPIC_PROVIDER_ID_DEF } from './auth-schema';
import { PTAH_CLI_AGENTS_DEF } from './cli-subagent-schema';
import {
  GATEWAY_TELEGRAM_TOKEN_DEF,
  GATEWAY_DISCORD_TOKEN_DEF,
  GATEWAY_SLACK_TOKEN_DEF,
} from './gateway-schema';
import {
  KNOWN_PROVIDER_AUTH_KEYS,
  providerSelectedModelDef,
  providerReasoningEffortDef,
} from './provider-schema';

/**
 * Master registry of all application setting definitions.
 *
 * This flat array is the single source of truth for:
 * - Migration runners (detecting which keys exist at which schema version)
 * - Settings UI generators (building forms from definitions)
 * - Default value resolution
 *
 * Add new definitions to their domain schema file, then include them here.
 */
export const SETTINGS_SCHEMA: readonly any[] = Object.freeze([
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,
  ...KNOWN_PROVIDER_AUTH_KEYS.map(providerSelectedModelDef),
  ...KNOWN_PROVIDER_AUTH_KEYS.map(providerReasoningEffortDef),
  PTAH_CLI_AGENTS_DEF,
  GATEWAY_TELEGRAM_TOKEN_DEF,
  GATEWAY_DISCORD_TOKEN_DEF,
  GATEWAY_SLACK_TOKEN_DEF,
]);
