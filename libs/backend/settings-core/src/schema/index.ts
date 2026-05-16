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
// Using unknown here is intentional — the array holds heterogeneous definitions.
// Callers that need the typed version access the individual exports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETTINGS_SCHEMA: readonly any[] = Object.freeze([
  // Auth
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,

  // Per-provider model + reasoning (auto-expanded from the known provider list)
  ...KNOWN_PROVIDER_AUTH_KEYS.map(providerSelectedModelDef),
  ...KNOWN_PROVIDER_AUTH_KEYS.map(providerReasoningEffortDef),

  // CLI sub-agents
  PTAH_CLI_AGENTS_DEF,

  // Gateway secrets
  GATEWAY_TELEGRAM_TOKEN_DEF,
  GATEWAY_DISCORD_TOKEN_DEF,
  GATEWAY_SLACK_TOKEN_DEF,
]);
