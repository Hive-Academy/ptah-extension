/**
 * Codex Provider Module - Barrel exports
 *
 */

// Auth service (injectable, stateful)
export { CodexAuthService } from './codex-auth.service';

// Translation proxy (injectable, thin subclass of TranslationProxyBase)
export { CodexTranslationProxy } from './codex-translation-proxy';

// Provider registry entry (static data)
export {
  CODEX_PROVIDER_ENTRY,
  CODEX_DEFAULT_TIERS,
} from './codex-provider-entry';

// Constants
export {
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  CODEX_OAUTH_SENTINEL,
} from './codex-provider.types';

// Codex-specific type exports
export type { ICodexAuthService, CodexAuthFile } from './codex-provider.types';
