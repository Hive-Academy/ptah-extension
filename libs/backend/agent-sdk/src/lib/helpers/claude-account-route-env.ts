import type { ClaudeAccountRoute } from '@ptah-extension/auth-providers-tokens';

// Mirrors the finite selector contract in the account admission command.
// Keep local: auth-providers depends on agent-sdk, never the reverse.
const CONFLICTING_SELECTORS = [
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_PROFILE',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'CLOUD_ML_REGION',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET',
] as const;

/** Apply an admitted route only after the complete child env has been assembled. */
export function applyClaudeAccountRouteEnv(
  baseEnv: Record<string, string | undefined>,
  route?: ClaudeAccountRoute,
): Record<string, string | undefined> {
  if (route?.kind !== 'named') return baseEnv;
  if (!route.canonicalConfigDir.trim()) {
    throw new Error('Named Claude account requires a non-empty canonical config directory.');
  }

  const env: Record<string, string | undefined> = {
    ...baseEnv,
    CLAUDE_CONFIG_DIR: route.canonicalConfigDir,
  };
  // Windows environment names are case-insensitive. Clear only the enumerated
  // selectors and alternate casing of the directory we have just selected.
  const selectors = new Set<string>(CONFLICTING_SELECTORS);
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (
      selectors.has(upper) ||
      (upper === 'CLAUDE_CONFIG_DIR' && key !== upper)
    ) {
      delete env[key];
    }
  }
  // Pin this after clearing every casing so the SDK's Windows fallback cannot
  // select process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ahead of our config dir.
  env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] = route.canonicalConfigDir;
  return env;
}
