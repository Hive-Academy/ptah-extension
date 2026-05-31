import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  isUnsafeWorkspacePath,
  type IPlatformInfo,
} from '@ptah-extension/platform-core';
import * as path from 'path';

export interface WarmQueryHandle {
  close: () => void;
  query?: unknown;
}

export interface WarmPrewarmFingerprint {
  pathToClaudeCodeExecutable: string | null;
  mcpServers: Record<string, unknown> | null;
  baseUrl?: string | null;
  authEnvHash?: string | null;
  /**
   * The `cwd` baked into the warm subprocess at `startup()` time. Compared
   * against the cwd required by the consumer; a mismatch discards the warm
   * handle because `WarmQuery.query(prompt)` cannot rebind cwd after spawn.
   */
  cwd: string | null;
}

@injectable()
export class SdkWarmQueryManager {
  private static readonly WARM_QUERY_TTL_MS = 5 * 60 * 1000;

  private _prewarmed = false;
  private _warmQuery: WarmQueryHandle | null = null;
  private _warmQueryFingerprint: WarmPrewarmFingerprint | null = null;
  private _warmQueryCreatedAt = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
  ) {}

  /**
   * Pre-spawn an SDK subprocess bound to `cwd`. Returns early without
   * spawning if `cwd` is missing or fails the install-dir/root safety guard,
   * because `WarmQuery.query(prompt)` cannot rebind cwd after spawn — a
   * mis-rooted warm handle would silently leak the wrong cwd into the next
   * new session.
   */
  async prewarm(
    cliJsPath: string | null,
    cwd: string | null | undefined,
    activeMcpServers?: Record<string, unknown>,
  ): Promise<void> {
    if (this._prewarmed) {
      return;
    }

    if (!cwd) {
      this.logger.info(
        '[SdkWarmQueryManager] Skipping prewarm: no workspace cwd available',
      );
      return;
    }
    const safety = isUnsafeWorkspacePath(cwd, this.platformInfo);
    if (!safety.ok) {
      this.logger.warn(
        `[SdkWarmQueryManager] Skipping prewarm: unsafe cwd — ${safety.reason}`,
      );
      return;
    }

    const resolvedCwd = path.resolve(cwd);

    const startTime = performance.now();
    try {
      const sdkModule = (await import('@anthropic-ai/claude-agent-sdk')) as {
        startup?: (params?: {
          options?: unknown;
          initializeTimeoutMs?: number;
        }) => Promise<{ close: () => void; query?: unknown }>;
      };
      const startupFn = sdkModule.startup;
      if (typeof startupFn !== 'function') {
        this.logger.warn(
          '[SdkWarmQueryManager] SDK startup() export not found - skipping prewarm',
          new Error(`startup is ${typeof startupFn}`),
        );
        return;
      }

      const startupOptions: Record<string, unknown> = { cwd: resolvedCwd };
      if (cliJsPath) {
        startupOptions['pathToClaudeCodeExecutable'] = cliJsPath;
      }
      if (activeMcpServers && Object.keys(activeMcpServers).length > 0) {
        startupOptions['mcpServers'] = activeMcpServers;
      }
      const warm = await startupFn({ options: startupOptions });

      if (this._warmQuery) {
        this._warmQuery.close();
      }
      this._warmQuery = warm;
      this._warmQueryCreatedAt = Date.now();
      this._warmQueryFingerprint = {
        pathToClaudeCodeExecutable: cliJsPath,
        mcpServers:
          activeMcpServers && Object.keys(activeMcpServers).length > 0
            ? activeMcpServers
            : null,
        baseUrl: null,
        authEnvHash: null,
        cwd: resolvedCwd,
      };

      const elapsed = (performance.now() - startTime).toFixed(2);
      this.logger.info(
        `[SdkWarmQueryManager] SDK subprocess pre-warmed and retained (${elapsed}ms)`,
      );
      this._prewarmed = true;
    } catch (err) {
      const elapsed = (performance.now() - startTime).toFixed(2);
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : 'UnknownError';
      const redactedMessage = rawMessage.replace(
        /sk-ant-[A-Za-z0-9_-]+/g,
        'sk-ant-***REDACTED***',
      );
      this.logger.warn(
        `[SdkWarmQueryManager] SDK prewarm failed after ${elapsed}ms (will resolve on first query): ${errorName}: ${redactedMessage}`,
      );
    }
  }

  consumeWarmQuery(
    requirements?: WarmPrewarmFingerprint,
  ): WarmQueryHandle | null {
    if (!this._warmQuery) {
      return null;
    }
    const age = Date.now() - this._warmQueryCreatedAt;
    if (age > SdkWarmQueryManager.WARM_QUERY_TTL_MS) {
      this.logger.info(
        `[SdkWarmQueryManager] Discarding stale warm query (age=${age}ms > ttl=${SdkWarmQueryManager.WARM_QUERY_TTL_MS}ms)`,
      );
      this.discardWarmHandle();
      this._prewarmed = false;
      return null;
    }

    if (requirements && this._warmQueryFingerprint) {
      const reason = SdkWarmQueryManager.fingerprintMismatchReason(
        this._warmQueryFingerprint,
        requirements,
      );
      if (reason) {
        this.logger.info(
          `[SdkWarmQueryManager] Discarding warm query — fingerprint mismatch: ${reason}`,
        );
        this.discardWarmHandle();
        this._prewarmed = false;
        return null;
      }
    }

    const handle = this._warmQuery;
    this._warmQuery = null;
    this._warmQueryFingerprint = null;
    this._warmQueryCreatedAt = 0;
    return handle;
  }

  discardWarmHandle(): void {
    if (!this._warmQuery) {
      return;
    }
    try {
      this._warmQuery.close();
    } catch (closeErr) {
      this.logger.warn(
        '[SdkWarmQueryManager] Stale WarmQuery.close() threw',
        closeErr instanceof Error ? closeErr : new Error(String(closeErr)),
      );
    }
    this._warmQuery = null;
    this._warmQueryFingerprint = null;
    this._warmQueryCreatedAt = 0;
  }

  static fingerprintMismatchReason(
    baked: WarmPrewarmFingerprint,
    required: WarmPrewarmFingerprint,
  ): string | null {
    if (
      baked.pathToClaudeCodeExecutable !== required.pathToClaudeCodeExecutable
    ) {
      return (
        `pathToClaudeCodeExecutable differs ` +
        `(warm=${baked.pathToClaudeCodeExecutable ?? 'null'}, ` +
        `required=${required.pathToClaudeCodeExecutable ?? 'null'})`
      );
    }
    const bakedMcp = baked.mcpServers ? JSON.stringify(baked.mcpServers) : '';
    const requiredMcp = required.mcpServers
      ? JSON.stringify(required.mcpServers)
      : '';
    if (bakedMcp !== requiredMcp) {
      return 'mcpServers map differs';
    }
    const bakedBase = baked.baseUrl ?? null;
    const requiredBase = required.baseUrl ?? null;
    if (bakedBase !== requiredBase) {
      return `baseUrl differs (warm=${bakedBase ?? 'null'}, required=${requiredBase ?? 'null'})`;
    }
    const bakedHash = baked.authEnvHash ?? null;
    const requiredHash = required.authEnvHash ?? null;
    if (bakedHash !== requiredHash) {
      return 'authEnv fingerprint differs';
    }
    const bakedCwd = baked.cwd ? path.resolve(baked.cwd) : null;
    const requiredCwd = required.cwd ? path.resolve(required.cwd) : null;
    if (bakedCwd !== requiredCwd) {
      const normBaked =
        bakedCwd && process.platform === 'win32'
          ? bakedCwd.toLowerCase()
          : bakedCwd;
      const normRequired =
        requiredCwd && process.platform === 'win32'
          ? requiredCwd.toLowerCase()
          : requiredCwd;
      if (normBaked !== normRequired) {
        return `cwd differs (warm=${bakedCwd ?? 'null'}, required=${requiredCwd ?? 'null'})`;
      }
    }
    return null;
  }

  dispose(): void {
    this.discardWarmHandle();
    this._prewarmed = false;
  }
}
