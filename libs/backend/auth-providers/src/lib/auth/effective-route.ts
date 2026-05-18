/**
 * Effective auth-route resolver — single source of truth for "what would
 * happen if I ran an agent right now?"
 *
 * Stream B item #7. The CLI's `ptah doctor` command, the future Electron
 * settings panel, and the VS Code status bar all need the same answer when
 * deciding whether the current config is bootable. This module factors the
 * decision into a pure function so all three callers stay in lockstep.
 *
 * The function is intentionally small and DI-free — it consumes a
 * pre-collected provider snapshot (typically from `llm:getProviderStatus`
 * + `auth:getHealth` + `ClaudeCliDetector.performHealthCheck()`) and a
 * minimal config object, and returns `(route, ready, blockers[])`.
 *
 * Why it lives here (and not in the CLI command file): the resolver must
 * be reusable by non-CLI surfaces. The CLI's `DoctorProviderEntry` shape
 * is structurally compatible with `EffectiveRouteProvider` below, so the
 * CLI can pass its array directly without an adapter step.
 */

import {
  resolveStrategy,
  type AuthStrategyType,
  type LegacyAuthMethod,
} from '@ptah-extension/shared';

/**
 * Minimal provider shape consumed by `resolveEffectiveAuthRoute`. Kept
 * structurally compatible with the CLI's `DoctorProviderEntry` so callers
 * can reuse their probe results without a translation layer.
 */
export interface EffectiveRouteProvider {
  id: string;
  /**
   * Auth modality reported by the registry. Mirrors
   * `LlmGetProviderStatusEntry.authType` after the local-* split:
   *   - 'apiKey'       → IAuthStrategy = 'api-key'
   *   - 'oauth'        → IAuthStrategy = 'oauth-proxy'
   *   - 'local-native' → IAuthStrategy = 'local-native'
   *   - 'local-proxy'  → IAuthStrategy = 'local-proxy'
   *   - 'cli'          → IAuthStrategy = 'cli'
   */
  type: 'apiKey' | 'oauth' | 'local-native' | 'local-proxy' | 'cli' | 'unknown';
  /**
   * Resolved connectivity verdict from a probe. Drives the `blockers[]`
   * decision — anything other than 'connected' / 'reachable' surfaces as a
   * blocker.
   */
  status:
    | 'connected'
    | 'needs-key'
    | 'unauthenticated'
    | 'reachable'
    | 'unreachable'
    | 'not-installed'
    | 'missing'
    | 'unknown'
    | 'skipped';
}

/** Auth-related config slice the resolver consumes. */
export interface EffectiveRouteConfig {
  authMethod: string | null;
  defaultProvider: string | null;
  anthropicProviderId: string | null;
}

export interface EffectiveRouteResult {
  /** Resolved IAuthStrategy id, or 'unresolved' when the input is unusable. */
  route: AuthStrategyType | 'unresolved';
  /** True when no blockers are present. */
  ready: boolean;
  /** Human-readable reasons the route is not ready. Empty when ready. */
  blockers: string[];
}

/**
 * Pure function: project the workspace's current auth config + provider
 * snapshot into a `(route, ready, blockers)` triple.
 *
 * Accepts both kebab (`'claude-cli'`) and legacy camel (`'claudeCli'`)
 * spellings of `authMethod` so it works during Stream A's migration window
 * without coupling to the read-back shim.
 */
export function resolveEffectiveAuthRoute(
  config: EffectiveRouteConfig,
  providers: EffectiveRouteProvider[],
): EffectiveRouteResult {
  const blockers: string[] = [];

  const rawMethod = (config.authMethod ?? '').trim().toLowerCase();
  let legacy: LegacyAuthMethod | null = null;
  if (rawMethod === 'claude-cli' || rawMethod === 'claudecli') {
    legacy = 'claudeCli';
  } else if (rawMethod === 'apikey') {
    legacy = 'apiKey';
  } else if (rawMethod === 'oauth' || rawMethod === 'thirdparty') {
    legacy = 'thirdParty';
  }

  if (legacy === null) {
    blockers.push(
      `authMethod is unset or unrecognized ('${config.authMethod ?? ''}')`,
    );
    return { route: 'unresolved', ready: false, blockers };
  }

  let driverProviderId: string | null = null;
  if (legacy === 'claudeCli') {
    driverProviderId = 'claude-cli';
  } else if (legacy === 'thirdParty') {
    driverProviderId =
      config.anthropicProviderId ?? config.defaultProvider ?? null;
  } else if (legacy === 'apiKey') {
    driverProviderId = config.defaultProvider ?? 'anthropic';
  }

  const driver = providers.find((p) => p.id === driverProviderId);
  const route = resolveStrategy(legacy, {
    authType:
      driver?.type === 'apiKey' || driver?.type === 'oauth'
        ? driver.type
        : driver?.type === 'local-native' || driver?.type === 'local-proxy'
          ? 'none'
          : undefined,
    requiresProxy: driver?.type === 'oauth' || driver?.type === 'local-proxy',
  });

  if (!driver) {
    blockers.push(
      `driver provider '${driverProviderId ?? '(none)'}' not found in registry`,
    );
  } else {
    if (driver.status === 'needs-key') {
      blockers.push(`provider '${driver.id}' has no API key configured`);
    } else if (driver.status === 'unauthenticated') {
      blockers.push(`provider '${driver.id}' is not authenticated`);
    } else if (driver.status === 'unreachable') {
      blockers.push(`provider '${driver.id}' base URL is unreachable`);
    } else if (driver.status === 'not-installed') {
      blockers.push(`provider '${driver.id}' is not installed`);
    } else if (driver.status === 'missing') {
      blockers.push(`Claude CLI is not installed or not on PATH`);
    }
  }

  return { route, ready: blockers.length === 0, blockers };
}
