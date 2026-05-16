/**
 * `ptah doctor` (alias `diagnose`) — single-shot diagnostic walk.
 *
 * Emits a `doctor.report` notification with a snapshot of:
 *
 *   - License        — tier / valid / daysRemaining / expiryWarning
 *   - Auth           — authMethod / defaultProvider / anthropicProviderId
 *   - Providers      — id / type / status (per-provider connectivity check)
 *   - Effective      — resolved auth route + ready flag + blockers[]
 *
 * The command boots `withEngine({ mode: 'full', requireSdk: false })` so the
 * RPC handlers needed for the snapshot are wired without requiring an active
 * SDK adapter (the doctor must work even when auth is misconfigured).
 *
 * Per-provider status checks:
 *   - apiKey      → connected if `hasApiKey` is true, otherwise `needs-key`.
 *   - oauth       → call `auth:getHealth` and report 'connected' /
 *                   'unauthenticated' / 'unknown'.
 *   - local       → HEAD/GET against the registry-default base URL (or the
 *                   `provider.<id>.baseUrl` override if present), 2s timeout.
 *                   Reports 'reachable' / 'unreachable'.
 *   - cli         → `ClaudeCliDetector.performHealthCheck()` —
 *                   'connected' / 'missing'.
 *
 * The "effective auth route" is computed by `resolveEffectiveAuthRoute`, a
 * pure function exported from `@ptah-extension/agent-sdk`. It mirrors the
 * runtime decision the SDK adapter makes on startup so doctor's view of
 * "what would happen if I ran an agent right now?" stays in lockstep.
 */

import {
  SDK_TOKENS,
  resolveEffectiveAuthRoute,
  type ClaudeCliDetector,
  type EffectiveRouteProvider,
  type EffectiveRouteResult,
} from '@ptah-extension/agent-sdk';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

/** Options accepted by `ptah doctor` (currently none — kept for symmetry). */
export interface DoctorOptions {
  /** Reserved for future verbose toggles. */
  verbose?: boolean;
}

/** Stderr sink used for fatal validation errors; tests may inject a buffer. */
export interface DoctorStderrLike {
  write(chunk: string): boolean;
}

/**
 * Per-provider probe result emitted in the report's `providers[]` array.
 *
 * `type` is the auth modality reported by the registry; `status` is the
 * resolved connectivity verdict from the probe (or 'skipped' when the probe
 * could not run — e.g. local provider with an unreachable URL on a
 * disconnected host).
 */
export interface DoctorProviderEntry {
  id: string;
  type: 'apiKey' | 'oauth' | 'local-native' | 'local-proxy' | 'cli' | 'unknown';
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
  /** Free-form detail for human-readable rendering (e.g. CLI version). */
  detail?: string;
}

/**
 * Verdict from the local-provider reachability probe.
 *
 * Coherent policy:
 *   - 'reachable'      → HTTP 2xx (server is up and serving)
 *   - 'unreachable'    → HTTP non-2xx (server up but rejected our request)
 *   - 'not-installed'  → ECONNREFUSED (nothing listening on the port)
 *   - 'unknown'        → AbortError / DNS / generic network failure
 */
export type LocalProbeVerdict =
  | 'reachable'
  | 'unreachable'
  | 'not-installed'
  | 'unknown';

/** Result shape emitted via `doctor.report`. */
export interface DoctorReport {
  license: {
    tier: string;
    valid: boolean;
    daysRemaining: number | null;
    expiryWarning: 'near_expiry' | 'critical' | null;
  };
  auth: {
    authMethod: string | null;
    defaultProvider: string | null;
    anthropicProviderId: string | null;
  };
  providers: DoctorProviderEntry[];
  effective: EffectiveRouteResult;
  timestamp: string;
}

// Re-export the resolver so existing CLI consumers (and the doctor spec) can
// import it from `./doctor.js` for backwards compatibility. The canonical
// home is `@ptah-extension/agent-sdk`.
export { resolveEffectiveAuthRoute } from '@ptah-extension/agent-sdk';

/** Optional collaborators — tests inject; production omits. */
export interface DoctorExecuteHooks {
  stderr?: DoctorStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /**
   * Override the per-provider local-reachability probe. Production uses a
   * `fetch` HEAD with a 2s `AbortController`. Tests inject a stub.
   */
  probeLocal?: (url: string) => Promise<LocalProbeVerdict>;
  /** Override the `now` clock for deterministic timestamps in tests. */
  now?: () => Date;
}

/**
 * Execute the `ptah doctor` command. Returns the process exit code.
 */
export async function execute(
  _opts: DoctorOptions,
  globals: GlobalOptions,
  hooks: DoctorExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: DoctorStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;
  const now = hooks.now ?? (() => new Date());
  const probeLocal = hooks.probeLocal ?? defaultProbeLocal;

  try {
    return await engine(
      globals,
      { mode: 'full', requireSdk: false },
      async (ctx) => {
        const transport = ctx.transport;

        // 1. License snapshot.
        const licenseRaw = await safeCall<{
          tier?: string;
          valid?: boolean;
          daysRemaining?: number | null;
          expiryWarning?: 'near_expiry' | 'critical' | null;
        }>(transport, 'license:getStatus', {});
        const license: DoctorReport['license'] = {
          tier: licenseRaw?.tier ?? 'unknown',
          valid: licenseRaw?.valid === true,
          daysRemaining:
            typeof licenseRaw?.daysRemaining === 'number'
              ? licenseRaw.daysRemaining
              : null,
          expiryWarning: licenseRaw?.expiryWarning ?? null,
        };

        // 2. Auth snapshot. `auth:getAuthStatus` carries `authMethod` and
        // `anthropicProviderId`; `defaultProvider` lives on
        // `llm:getDefaultProvider` (LLM provider registry, not auth config).
        const authStatus = await safeCall<{
          authMethod?: string | null;
          anthropicProviderId?: string | null;
        }>(transport, 'auth:getAuthStatus', {});
        const defaultProviderResp = await safeCall<{
          provider?: string | null;
          defaultProvider?: string | null;
        }>(transport, 'llm:getDefaultProvider', {});
        const auth: DoctorReport['auth'] = {
          authMethod: authStatus?.authMethod ?? null,
          defaultProvider:
            defaultProviderResp?.provider ??
            defaultProviderResp?.defaultProvider ??
            null,
          anthropicProviderId: authStatus?.anthropicProviderId ?? null,
        };

        // 3. Provider probe.
        const providerStatus = await safeCall<{
          providers?: Array<{
            name?: string;
            authType?: string;
            hasApiKey?: boolean;
            isLocal?: boolean;
            requiresProxy?: boolean;
            baseUrl?: string | null;
          }>;
        }>(transport, 'llm:getProviderStatus', {});

        // OAuth providers need a single round-trip; cache the result so the
        // copilot+codex slots share one health call.
        const oauthHealth = await safeCall<{
          copilotAuthenticated?: boolean;
          codexAuthenticated?: boolean;
        }>(transport, 'auth:getHealth', undefined);

        const providers: DoctorProviderEntry[] = [];
        for (const p of providerStatus?.providers ?? []) {
          const id = p.name ?? '';
          if (!id) continue;
          const entry = await probeProvider(p, oauthHealth, probeLocal);
          providers.push(entry);
        }

        // 4. Claude CLI slot — always probed regardless of authMethod so the
        // operator can see whether the CLI is available before switching.
        // Guard against duplicates in case the registry ever exposes a
        // 'claude-cli' entry directly.
        if (!providers.find((p) => p.id === 'claude-cli')) {
          try {
            const detector = ctx.container.resolve<ClaudeCliDetector>(
              SDK_TOKENS.SDK_CLI_DETECTOR,
            );
            const health = await detector.performHealthCheck();
            providers.push({
              id: 'claude-cli',
              type: 'cli',
              status: health.available ? 'connected' : 'missing',
              detail: health.version
                ? `claude ${health.version}`
                : health.error,
            });
          } catch {
            providers.push({
              id: 'claude-cli',
              type: 'cli',
              status: 'unknown',
            });
          }
        }

        // 5. Effective route resolution (pure).
        const effective = resolveEffectiveAuthRoute(auth, providers);

        const report: DoctorReport = {
          license,
          auth,
          providers,
          effective,
          timestamp: now().toISOString(),
        };

        await formatter.writeNotification(
          'doctor.report',
          report as unknown as Record<string, unknown>,
        );
        return ExitCode.Success;
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`ptah doctor: ${message}\n`);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProviderStatusRaw {
  name?: string;
  authType?: string;
  hasApiKey?: boolean;
  isLocal?: boolean;
  requiresProxy?: boolean;
  baseUrl?: string | null;
}

async function probeProvider(
  p: ProviderStatusRaw,
  oauthHealth: {
    copilotAuthenticated?: boolean;
    codexAuthenticated?: boolean;
  } | null,
  probeLocal: (url: string) => Promise<LocalProbeVerdict>,
): Promise<DoctorProviderEntry> {
  const id = p.name ?? '';
  const authType = p.authType ?? '';

  if (authType === 'apiKey') {
    return {
      id,
      type: 'apiKey',
      status: p.hasApiKey === true ? 'connected' : 'needs-key',
    };
  }

  if (authType === 'oauth') {
    let status: DoctorProviderEntry['status'] = 'unknown';
    if (id === 'github-copilot' || id === 'copilot') {
      status =
        oauthHealth?.copilotAuthenticated === true
          ? 'connected'
          : 'unauthenticated';
    } else if (id === 'openai-codex' || id === 'codex') {
      status =
        oauthHealth?.codexAuthenticated === true
          ? 'connected'
          : 'unauthenticated';
    }
    return { id, type: 'oauth', status };
  }

  if (authType === 'none' && p.isLocal === true) {
    const localKind: 'local-native' | 'local-proxy' =
      p.requiresProxy === true ? 'local-proxy' : 'local-native';
    if (typeof p.baseUrl === 'string' && p.baseUrl.length > 0) {
      const verdict = await probeLocal(p.baseUrl);
      return {
        id,
        type: localKind,
        status: verdict,
      };
    }
    return { id, type: localKind, status: 'skipped' };
  }

  return { id, type: 'unknown', status: 'unknown' };
}

/**
 * Default local-provider reachability probe.
 *
 * Uses `fetch` with a 2s `AbortController` timeout. Disambiguates verdicts:
 *   - 2xx                     → 'reachable'
 *   - non-2xx                 → 'unreachable' (server up, rejected request)
 *   - ECONNREFUSED            → 'not-installed' (nothing listening)
 *   - timeout / DNS / generic → 'unknown'
 */
async function defaultProbeLocal(url: string): Promise<LocalProbeVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    // Drain the body so the connection can close cleanly. Some local
    // servers (LM Studio) hold the connection open until the body is read.
    try {
      await res.text();
    } catch {
      // Best-effort drain; ignore.
    }
    return res.ok ? 'reachable' : 'unreachable';
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.cause as { code?: string } | undefined)?.code === 'ECONNREFUSED'
    ) {
      return 'not-installed';
    }
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

async function safeCall<T>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T | null> {
  try {
    const response = await transport.call<unknown, T>(method, params);
    if (!response.success) return null;
    return (response.data as T) ?? null;
  } catch {
    return null;
  }
}
