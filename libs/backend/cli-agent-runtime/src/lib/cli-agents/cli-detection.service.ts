/**
 * CLI Detection Service
 *
 * Detects on first call and caches results.
 * Registered adapters: Codex, Copilot, Cursor, Antigravity, OpenCode, Pi, Grok
 * and, when the host registered it, the native Claude SDK lane.
 * Exposes detection results for MCP tools and namespace.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type {
  IAuthSecretsService,
  SentryService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { CliType, CliDetectionResult } from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliModelInfo,
  CodexAdapterFactory,
} from './cli-adapters/cli-adapter.interface';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import { bestMessagingCapability } from './cli-adapters/cli-adapter.interface';
import { fixPathReady } from './cli-adapters/fix-path';
import { CopilotSdkAdapter } from './cli-adapters/copilot-sdk.adapter';
import { CopilotPermissionBridge } from './cli-adapters/copilot-permission-bridge';
import { CursorCliAdapter } from './cli-adapters/cursor-cli.adapter';
import { AntigravityCliAdapter } from './cli-adapters/antigravity-cli.adapter';
import { OpencodeCliAdapter } from './cli-adapters/opencode-cli.adapter';
import { PiCliAdapter } from './cli-adapters/pi-cli.adapter';
import { GrokCliAdapter } from './cli-adapters/grok-cli.adapter';
import { ClaudeCliAdapter } from './cli-adapters/claude-cli.adapter';

function unavailableCodexAdapter(cause: Error): CliAdapter {
  const failure = new Error(`Native Codex adapter unavailable: ${cause.message}`, {
    cause,
  });
  return {
    name: 'codex',
    displayName: 'Codex CLI',
    roleChannel: 'developer-instructions',
    supportsMcp: false,
    capabilities: () => ({ steer: false, interrupt: false, continuation: false }),
    detect: async () => ({ cli: 'codex', installed: false, messagingMode: 'none' }),
    listModels: async () => [],
    parseOutput: (raw) => raw,
    runSdk: async () => { throw failure; },
  };
}

/**
 * Oldest in-flight scan that {@link CliDetectionService.refresh} joins. Above
 * the 12 s plan-owner discovery deadline, so a normal scan is always joined.
 */
const REFRESH_JOIN_MAX_AGE_MS = 15_000;

@injectable()
export class CliDetectionService {
  private readonly adapters: Map<CliType, CliAdapter> = new Map();
  private detectionCache: Map<CliType, CliDetectionResult> | null = null;
  /** In-flight detection promise to prevent concurrent detection races */
  private detectionInFlight: Promise<CliDetectionResult[]> | null = null;
  /** Cache generation; invalidateCache() bumps it so older scans are not reused. */
  private generation = 0;
  /** Generation the in-flight scan started in. */
  private inFlightGeneration = -1;
  /** Wall-clock start of the in-flight scan. */
  private inFlightStartedAt = 0;
  /** Cached model lists per CLI type */
  private modelCache: Map<CliType, CliModelInfo[]> | null = null;
  private modelInFlight: Promise<Record<string, CliModelInfo[]>> | null = null;

  /**
   * @param spawner - The off-thread process spawner, reusing `agent-sdk`'s
   *   existing `SDK_PROCESS_SPAWNER` binding. Every rival-CLI adapter that
   *   launches a child gets it, because `child_process.spawn` is a synchronous
   *   `CreateProcessW` on Windows and those launches measured 300-900 ms of
   *   event-loop lag each (TASK_2026_367). Codex uses its selected adapter's
   *   own runtime; Cursor runs its vendor SDK in process.
   */
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_PROCESS_SPAWNER)
    private readonly spawner: IProcessSpawner,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    /**
     * The native Claude SDK lane, constructed by the runtime registration
     * (`registerCliAgentRuntime`) from SDK services every host registers.
     * Its construction never loads the SDK or starts a query: `detect()` only
     * resolves the bundled executable and query function, and an unavailable
     * SDK reports `installed: false` without touching the other adapters.
     * Detection is installation only — a signed-out account still detects
     * as installed; named-account admission is decided at spawn time.
     * `null` keeps a caller that constructs the service directly on the
     * previous seven-adapter roster.
     */
    @inject(ClaudeCliAdapter)
    claudeAdapter: ClaudeCliAdapter | null = null,
    /** The host supplies the native Codex lane; null marks it unavailable. */
    @inject(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, { isOptional: true })
    codexAdapterFactory: CodexAdapterFactory | null = null,
  ) {
    let codexAdapter: CliAdapter;
    if (codexAdapterFactory) {
      try {
        codexAdapter = codexAdapterFactory.create();
      } catch (error) {
        // degradation-audit: reported - preserve peer adapters while surfacing native Codex composition failure.
        const cause = error instanceof Error ? error : new Error(String(error));
        this.logger.error('[CliDetection] Native Codex adapter factory failed', cause);
        this.sentryService.captureException(cause, {
          errorSource: 'CliDetectionService.codexAdapterFactory',
        });
        codexAdapter = unavailableCodexAdapter(cause);
      }
    } else {
      const cause = new Error('Native Codex lane adapter factory is not registered');
      this.logger.warn('[CliDetection] Native Codex adapter unavailable', cause);
      codexAdapter = unavailableCodexAdapter(cause);
    }
    this.adapters.set('codex', codexAdapter);
    const permissionBridge = new CopilotPermissionBridge();
    this.adapters.set(
      'copilot',
      new CopilotSdkAdapter(permissionBridge, this.spawner),
    );

    // The Cursor provider key lives only in the secrets store (TASK_2026_538);
    // the resolver is lazy so the adapter re-reads the secret on every use.
    this.adapters.set(
      'cursor',
      new CursorCliAdapter(this.logger, () =>
        this.authSecrets.getProviderKey('cursor'),
      ),
    );
    this.adapters.set(
      'antigravity',
      new AntigravityCliAdapter(this.spawner, undefined, this.logger),
    );
    this.adapters.set('opencode', new OpencodeCliAdapter(this.spawner));
    this.adapters.set('pi', new PiCliAdapter(this.spawner));
    this.adapters.set('grok', new GrokCliAdapter(this.spawner, this.logger));
    // Last, so the existing auto-detect fallback order is unchanged.
    if (claudeAdapter) this.adapters.set('claude', claudeAdapter);

    this.logger.info('[CliDetection] Service initialized with adapters', {
      adapters: [...this.adapters.keys()].join(', '),
    });
    this.refreshWhenShellPathLands();
  }

  /**
   * The login-shell PATH probe started by `fixPath` answers after boot and
   * detection never waits for it. When it changes PATH, drop the cached scan
   * once, so the next detection finds CLIs that only the login shell's PATH
   * contains (macOS/Linux GUI launches). On Windows the PATH never changes.
   */
  private refreshWhenShellPathLands(): void {
    const before = process.env['PATH'] ?? '';
    fixPathReady()
      .then((after) => {
        if (after !== before) this.invalidateCache();
      })
      .catch((error: unknown) => {
        // degradation-audit: reported - a failed PATH wait only skips the one-time refresh.
        const cause = error instanceof Error ? error : new Error(String(error));
        this.logger.warn('[CliDetection] Login-shell PATH refresh skipped', cause);
      });
  }

  /**
   * Detect all registered CLI agents.
   * Results are cached after first call. Invalidation discards the cache, and
   * a scan that started before it is neither joined nor cached.
   * Uses promise deduplication to prevent race conditions when called concurrently.
   */
  async detectAll(): Promise<CliDetectionResult[]> {
    if (this.detectionCache) {
      return Array.from(this.detectionCache.values());
    }
    const current = this.currentInFlight();
    if (current) {
      this.logger.debug(
        '[CliDetection] Detection already in progress, reusing in-flight promise',
      );
      return current;
    }

    const inFlight = this.doDetectAll(this.generation);
    this.detectionInFlight = inFlight;
    this.inFlightGeneration = this.generation;
    this.inFlightStartedAt = Date.now();

    try {
      return await inFlight;
    } finally {
      if (this.detectionInFlight === inFlight) this.detectionInFlight = null;
    }
  }

  /**
   * Fresh detection for an explicit re-detect request (`agent:detectClis`).
   * A scan already running in the current generation is fresh, so join it
   * instead of starting a second concurrent scan. A scan older than
   * {@link REFRESH_JOIN_MAX_AGE_MS} may be stuck on one adapter, so it is not
   * joined. Otherwise drop the cache and scan again.
   */
  async refresh(): Promise<CliDetectionResult[]> {
    const current = this.currentInFlight();
    if (current && Date.now() - this.inFlightStartedAt < REFRESH_JOIN_MAX_AGE_MS) {
      return current;
    }
    this.invalidateCache();
    return this.detectAll();
  }

  /** The in-flight scan, only when it started in the current generation. */
  private currentInFlight(): Promise<CliDetectionResult[]> | null {
    return this.detectionInFlight && this.inFlightGeneration === this.generation
      ? this.detectionInFlight
      : null;
  }

  /**
   * Internal detection implementation.
   */
  private async doDetectAll(generation: number): Promise<CliDetectionResult[]> {
    this.logger.info('[CliDetection] Detecting installed CLI agents...');
    // Do NOT await the login-shell PATH probe here: starting every adapter in
    // this tick is what lets peer detection run while one binary probe hangs.
    // The host starts the probe at boot (`fixPath`); its result is merged when
    // it answers, and detection does not block the main loop waiting for it.
    const entries = await Promise.all(
      [...this.adapters].map(async ([name, adapter]): Promise<[CliType, CliDetectionResult]> => {
        try {
          const result: CliDetectionResult = {
            ...(await adapter.detect()),
            roleDelivery: 'preamble',
            roleChannel: adapter.roleChannel,
          };
          if (result.installed) {
            this.logger.info(`[CliDetection] ${adapter.displayName} detected`, {
              path: result.path,
              version: result.version,
            });
          } else {
            this.logger.debug(
              `[CliDetection] ${adapter.displayName} not installed`,
            );
          }
          return [name, result];
        } catch (error: unknown) {
          // degradation-audit: reported - failed adapter detection is captured and shown as unavailable.
          const err = error instanceof Error ? error : new Error(String(error));
          this.sentryService.captureException(err, {
            errorSource: 'CliDetectionService.doDetectAll',
          });
          this.logger.error(
            `[CliDetection] Error detecting ${adapter.displayName}`,
            err,
          );
          return [name, {
            cli: name,
            installed: false,
            messagingMode: bestMessagingCapability(adapter.capabilities()),
            roleDelivery: 'preamble',
            roleChannel: adapter.roleChannel,
          }];
        }
      }),
    );

    const results = new Map(entries);
    if (this.generation === generation) this.detectionCache = results;
    return Array.from(results.values());
  }

  /**
   * Get detection result for a specific CLI
   */
  async getDetection(cli: CliType): Promise<CliDetectionResult | undefined> {
    const all = await this.detectAll();
    return all.find((r) => r.cli === cli);
  }

  /**
   * Get list of installed CLIs only
   */
  async getInstalledClis(): Promise<CliDetectionResult[]> {
    const all = await this.detectAll();
    return all.filter((r) => r.installed);
  }

  /**
   * Get the adapter for a specific CLI
   */
  getAdapter(cli: CliType): CliAdapter | undefined {
    return this.adapters.get(cli);
  }

  /**
   * List available models for all installed CLIs that support listModels().
   * Results are cached until invalidateCache() is called.
   */
  async listModelsForAll(): Promise<Record<string, CliModelInfo[]>> {
    if (this.modelCache) {
      const result: Record<string, CliModelInfo[]> = {};
      for (const [cli, models] of this.modelCache) {
        result[cli] = models;
      }
      return result;
    }
    if (this.modelInFlight) return this.modelInFlight;
    const pending = this.loadModelsForAll();
    this.modelInFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.modelInFlight === pending) this.modelInFlight = null;
    }
  }

  private async loadModelsForAll(): Promise<Record<string, CliModelInfo[]>> {
    const generation = this.generation;
    const detections = await this.detectAll();
    const cache = new Map<CliType, CliModelInfo[]>();

    for (const detection of detections) {
      if (!detection.installed) continue;

      const adapter = this.adapters.get(detection.cli);
      if (!adapter?.listModels) continue;

      try {
        const models = await adapter.listModels();
        cache.set(detection.cli, models);
      } catch (error) {
        // degradation-audit: reported - model lookup failure is captured and omitted from the model map.
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'CliDetectionService.listModelsForAll',
        });
        this.logger.warn(
          `[CliDetection] Failed to list models for ${detection.cli}`,
          { error: err.message },
        );
      }
    }

    if (this.generation === generation) this.modelCache = cache;

    const result: Record<string, CliModelInfo[]> = {};
    for (const [cli, models] of cache) {
      result[cli] = models;
    }
    return result;
  }

  /**
   * Invalidate cached detection. A scan already running is not joined by
   * later callers and does not write the cache when it finishes.
   */
  invalidateCache(): void {
    this.detectionCache = null;
    this.modelCache = null;
    this.modelInFlight = null;
    this.generation++;
  }

  /**
   * CHECK — not refresh — each rival CLI's stored credentials at startup, so a
   * stale-credential fallback on first use is visible in the log beforehand.
   *
   * No adapter here refreshes anything: `ensureTokensFresh` reads the CLI's own
   * credential file and reports. The log said "credential refresh: fresh" and
   * meant "a credential is present", which read as a contradiction next to
   * `auth:getAuthStatus` reporting the same Codex token as stale in the same
   * session (TASK_2026_342). Wording now matches what actually happens.
   */
  async refreshCliTokens(): Promise<void> {
    for (const cli of ['codex', 'cursor', 'opencode', 'pi', 'grok'] as const) {
      const adapter = this.adapters.get(cli);
      if (adapter?.ensureTokensFresh) {
        const fresh = await adapter.ensureTokensFresh();
        this.logger.info(
          `[CliDetection] ${cli} credential check: ${
            fresh ? 'usable' : 'stale/unavailable'
          }`,
        );
        if (fresh) {
          this.modelCache = null;
        }
      }
    }
  }
}
