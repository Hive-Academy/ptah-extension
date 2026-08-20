/**
 * Provider tile form resolution — the pure decision layer behind AuthSection.
 *
 * Extracted from `AuthSection.tsx` because the classification was a chain of
 * booleans (`isLocalProvider`, `isApiKeyProvider`, …) evaluated inline in the
 * component, where it was untestable and where two defects hid:
 *
 *   Issue 3 — `authType: 'none'` short-circuited to the "local, no key" form
 *   BEFORE `supportsOptionalApiKey` was considered, so Ollama Cloud's optional
 *   ollama.com API key had no input anywhere in the TUI. The key unlocks
 *   direct cloud inference plus live model discovery and pricing; without it
 *   the tile could only ever use the signed-in local daemon.
 *
 *   Issue 4 — the endpoint shown on that form was a hardcoded ternary:
 *   `id === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'`.
 *   Every non-Ollama provider that reached the form was labelled as LM
 *   Studio's port, including Ollama Cloud (whose daemon is 11434) and the
 *   Claude Subscription tile (which has no endpoint at all). It also used
 *   `localhost` where the registry deliberately pins `127.0.0.1` — on Windows
 *   `localhost` resolves to `::1` first, where a WSL relay can shadow the real
 *   daemon.
 *
 * There is exactly ONE endpoint table and it is the shared provider registry:
 * `auth:getAuthStatus` forwards each entry's `baseUrl` verbatim, so this module
 * reads that field instead of restating any port. Nothing here invents a
 * default; a provider absent from the registry simply has no endpoint to show.
 */

import type { AnthropicProviderInfo } from '@ptah-extension/shared';

/**
 * Which configuration form a tile should render.
 *
 * - `claude`             — the synthetic "Claude" tile (direct Anthropic API key)
 * - `copilot` / `codex`  — device-code OAuth tiles with their own login flows
 * - `ambient`            — host credentials, no endpoint, no key (claude-cli)
 * - `local`              — local server, no key at all (ollama, lm-studio)
 * - `local-optional-key` — works keyless, but an optional key unlocks more
 *                          (ollama-cloud)
 * - `api-key`            — a key is required (openrouter, moonshot, z-ai, sakana)
 */
export type ProviderFormKind =
  | 'claude'
  | 'copilot'
  | 'codex'
  | 'ambient'
  | 'local'
  | 'local-optional-key'
  | 'api-key';

/** Tile id for the synthetic "Claude" (direct API key) entry. */
export const CLAUDE_TILE_ID = 'claude';

/**
 * Classify a provider tile.
 *
 * Order matters and is the fix for Issue 3: `supportsOptionalApiKey` is tested
 * BEFORE the plain-local verdict, and `nativeAuth` before both, so neither can
 * be swallowed by the broad `authType === 'none'` test that catches Ollama, LM
 * Studio, Ollama Cloud and the Claude Subscription tile alike.
 */
export function resolveProviderFormKind(
  tileId: string,
  provider: AnthropicProviderInfo | null | undefined,
): ProviderFormKind {
  if (tileId === CLAUDE_TILE_ID) return 'claude';
  if (tileId === 'github-copilot') return 'copilot';
  if (tileId === 'openai-codex') return 'codex';

  if (!provider) return 'api-key';

  // Ambient host credentials (~/.claude). No endpoint, no key, nothing to
  // configure — selecting the tile is the whole interaction.
  if (provider.nativeAuth === true) return 'ambient';

  if (provider.authType === 'oauth') return 'api-key';

  const isKeyless = provider.authType === 'none' || provider.isLocal === true;
  if (!isKeyless) return 'api-key';

  return provider.supportsOptionalApiKey === true
    ? 'local-optional-key'
    : 'local';
}

/** True when the tile accepts a key at all (required OR optional). */
export function formAcceptsApiKey(kind: ProviderFormKind): boolean {
  return (
    kind === 'claude' || kind === 'api-key' || kind === 'local-optional-key'
  );
}

/** True when the tile's key is optional — submitting an empty value is valid. */
export function formKeyIsOptional(kind: ProviderFormKind): boolean {
  return kind === 'local-optional-key';
}

/**
 * The endpoint to display for a tile, or `null` when the provider has none.
 *
 * Sourced from the provider registry via the `auth:getAuthStatus` payload —
 * the single per-provider table (Ollama 127.0.0.1:11434, Ollama Cloud's daemon
 * 127.0.0.1:11434, LM Studio localhost:1234/v1, …). `claude-cli` carries an
 * empty `baseUrl` on purpose and correctly yields `null`.
 */
export function resolveProviderEndpoint(
  provider: AnthropicProviderInfo | null | undefined,
): string | null {
  const baseUrl = provider?.baseUrl?.trim();
  return baseUrl ? baseUrl : null;
}
