import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import type {
  IProcessSpawner,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import type { PlanLimitWindow, QuotaOwnerRef } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  CODEX_INITIALIZE_TIMEOUT_MS,
  normalizeCodexHomeKey,
  type CodexAccountUsageClient,
} from '@ptah-extension/codex-runtime';
import {
  SDK_TOKENS,
  resolveCodexNativeBinaryPath,
  type SdkAdapterEvents,
} from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import { accountOwnerKey, quotaOwnerRefFromKey } from '../../quota/provider-owner.resolver';
import { mapCodexAccountUsage } from '../../quota/readers/codex-plan-usage.reader';
import { CodexHomeResolver } from './codex-home-resolver';
import type {
  ICodexAccountUsageService,
  ICodexAuthService,
  CodexAccountUsageResult,
} from './codex-provider.types';
import {
  CODEX_ACCOUNT_USAGE_INT64_FIELDS,
  codexAccountResponseSchema,
  codexInitializeResponseSchema,
  codexRateLimitsResponseSchema,
  codexTokenUsageResponseSchema,
} from './codex-account.schemas';

const CACHE_TTL_MS = 30_000;
// A read that did not end in usable data is answered from memory for this
// long, so callers that poll cannot turn it into a spawn per call.
const MISS_BACKOFF_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LINE_BYTES = 1024 * 1024;
const LIVE_REFRESH_MIN_INTERVAL_MS = 1_000;
const MAX_RELEASED_LIVE_CONTEXTS = 256;

class AppServerError extends Error {
  constructor(readonly kind: 'cli' | 'unavailable' | 'method') {
    super(kind);
  }
}

class CodexReadStageError extends Error {
  constructor(
    readonly stage: string,
    readonly underlyingError: unknown,
  ) {
    super(stage);
  }
}

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code?: number };
}

/** One App Server read: the RPC-safe result plus its backend-only owner key. */
interface AppServerRead {
  result: CodexAccountUsageResult;
  ownerKey: string | null;
}

export interface CodexRateLimitsUpdate {
  readonly contextId: string;
  readonly home: string;
  readonly observedAt: number;
}

export interface CodexLiveUsageUpdate {
  readonly owner: QuotaOwnerRef;
  readonly windows: readonly PlanLimitWindow[];
  readonly result: CodexAccountUsageResult;
}

interface LiveContext {
  readonly home: string;
  ownerKey?: string;
}

function samePath(left: string, right: string): boolean {
  const [a, b] = [resolve(left), resolve(right)];
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

const accountUsageInt64Pattern = new RegExp(
  `("(?:${CODEX_ACCOUNT_USAGE_INT64_FIELDS.join('|')})"\\s*:\\s*)(-?\\d+)`,
  'g',
);

function preserveAccountUsageInt64(line: string): string {
  return line.replace(accountUsageInt64Pattern, '$1"$2"');
}

function callerAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function joinWithCallerAbort<T>(
  shared: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(callerAbortError());
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => finish(() => rejectPromise(callerAbortError()));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void shared.then(
      (value) => finish(() => resolvePromise(value)),
      (error: unknown) => finish(() => rejectPromise(error)),
    );
  });
}

@injectable()
export class CodexAccountUsageService implements ICodexAccountUsageService {
  private cached: CodexAccountUsageResult | null = null;
  private ownerKey: string | null = null;
  /**
   * Bumped by `clearCache`. A read that started before the bump finishes for
   * its own callers but is not cached, so an account change (auth file
   * rewritten mid-read) never re-installs the previous account's data or key.
   */
  private generation = 0;
  private readInFlight: Promise<CodexAccountUsageResult> | null = null;
  private lastMiss: { at: number; result: CodexAccountUsageResult } | null =
    null;
  private readonly active = new Set<SpawnedProcessHandle>();
  private readonly closing = new Map<SpawnedProcessHandle, Promise<void>>();
  private readonly liveContexts = new Map<string, LiveContext>();
  private readonly releasedLiveContexts = new Set<string>();
  private readonly liveReads = new Map<string, Promise<CodexLiveUsageUpdate | null>>();
  private readonly lastLiveReads = new Map<string, number>();
  private liveClosed = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly auth: ICodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER)
    private readonly codexHome: CodexHomeResolver,
    @inject(SDK_TOKENS.SDK_PROCESS_SPAWNER)
    private readonly spawner: IProcessSpawner,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS) events: SdkAdapterEvents,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_USAGE_CLIENT)
    private coreClient: CodexAccountUsageClient | null = null,
  ) {
    events.onAuthFileChanged((event) => {
      if (event.providerId === 'openai-codex') this.clearCache();
    });
  }

  /** Electron attaches its host-owned reader; other hosts retain the fallback. */
  attachCoreClient(client: CodexAccountUsageClient): void {
    if (this.coreClient === client) return;
    this.coreClient = client;
    this.liveClosed = false;
    this.releasedLiveContexts.clear();
    this.cached = null;
    this.ownerKey = null;
    this.generation += 1;
    this.readInFlight = null;
    this.lastMiss = null;
    this.lastLiveReads.clear();
  }

  detachCoreClient(client: CodexAccountUsageClient): void {
    if (this.coreClient !== client) return;
    this.liveClosed = true;
    this.liveContexts.clear();
    this.releasedLiveContexts.clear();
    this.lastLiveReads.clear();
    this.coreClient = null;
  }

  private homeKind(home?: string): 'default' | 'explicit' | 'invalid' {
    if (home === undefined) return 'default';
    try {
      return normalizeCodexHomeKey(home, process.platform) ===
        normalizeCodexHomeKey(this.codexHome.path, process.platform)
        ? 'default'
        : 'explicit';
    } catch {
      return 'invalid';
    }
  }

  clearCache(home?: string): void {
    const kind = this.homeKind(home);
    if (kind === 'invalid') return;
    if (this.coreClient) this.coreClient.clearCache(home ?? this.codexHome.path);
    if (kind === 'explicit') return;
    this.cached = null;
    this.ownerKey = null;
    this.generation += 1;
    // Later callers start a fresh read instead of joining one begun before the change.
    this.readInFlight = null;
    this.lastMiss = null;
  }

  currentOwnerKey(home?: string): string | null {
    const kind = this.homeKind(home);
    if (kind === 'invalid') return null;
    if (this.coreClient) {
      const coreKey = this.coreClient.currentOwnerKey(home ?? this.codexHome.path);
      return kind === 'default' ? coreKey ?? this.ownerKey : coreKey;
    }
    if (home !== undefined && kind === 'explicit') return null;
    return this.ownerKey;
  }

  async getAccountUsage(
    options: { home?: string; refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<CodexAccountUsageResult> {
    // One shared client owns every home when composition supplies it.
    const kind = this.homeKind(options.home);
    if (kind === 'invalid') {
      return { status: 'service-unavailable', providerId: 'openai-codex' };
    }
    if (this.coreClient) {
      const result = await this.coreClient.read(options.home ?? this.codexHome.path, {
        refresh: options.refresh,
        signal: options.signal,
      });
      if (result.status !== 'service-unavailable' || kind === 'explicit') return result;
      // A shared client can outlive the last session profile for the default home.
    }
    if (options.home !== undefined && kind === 'explicit') {
      return { status: 'service-unavailable', providerId: 'openai-codex' };
    }
    const eligibility = await this.auth.getAccountUsageEligibility();
    if (eligibility !== 'supported') {
      return { status: eligibility, providerId: 'openai-codex' };
    }
    if (
      !options.refresh &&
      this.cached?.fetchedAt &&
      Date.now() - this.cached.fetchedAt < CACHE_TTL_MS
    ) {
      return this.cached;
    }
    if (
      !options.refresh &&
      this.lastMiss !== null &&
      Date.now() - this.lastMiss.at < MISS_BACKOFF_MS
    ) {
      return this.lastMiss.result;
    }
    // The initiating caller still owns cancellation of the shared process.
    // Joiners can abandon only their own wait without disrupting other callers.
    if (this.readInFlight !== null) {
      const shared = this.readInFlight;
      try {
        return await joinWithCallerAbort(shared, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw callerAbortError();
        // The initiating caller cancelled the shared process. Give this
        // still-active caller a fresh read instead of its abort.
        if (this.readInFlight === shared) this.readInFlight = null;
        return this.getAccountUsage(options);
      }
    }
    const read = this.performRead(options.signal);
    this.readInFlight = read;
    try {
      return await read;
    } finally {
      if (this.readInFlight === read) this.readInFlight = null;
    }
  }

  applyRateLimitsUpdated(
    update: CodexRateLimitsUpdate,
  ): Promise<CodexLiveUsageUpdate | null> {
    const client = this.coreClient;
    if (
      !client ||
      this.liveClosed ||
      this.releasedLiveContexts.has(update.contextId) ||
      !update.contextId ||
      !Number.isFinite(update.observedAt)
    )
      return Promise.resolve(null);
    let home: string;
    try {
      home = normalizeCodexHomeKey(update.home, process.platform);
    } catch {
      // degradation-audit: optional-capability — An invalid live home cannot update quota evidence; regular pull reads report their own status.
      return Promise.resolve(null);
    }
    const context = this.liveContexts.get(update.contextId);
    if (context && context.home !== home) return Promise.resolve(null);
    this.liveContexts.set(update.contextId, context ?? { home });
    const key = `${update.contextId}\0${home}`;
    const existing = this.liveReads.get(key);
    if (existing) return existing;
    const pending = this.performLiveRead(client, update, home)
      .finally(() => {
        if (this.liveReads.get(key) === pending) this.liveReads.delete(key);
      });
    this.liveReads.set(key, pending);
    return pending;
  }

  openRateLimitsContext(contextId: string): void {
    this.releasedLiveContexts.delete(contextId);
    const prefix = `${contextId}\0`;
    for (const key of this.liveReads.keys()) {
      if (key.startsWith(prefix)) this.liveReads.delete(key);
    }
  }

  releaseRateLimitsContext(contextId: string): void {
    this.liveContexts.delete(contextId);
    this.releasedLiveContexts.delete(contextId);
    this.releasedLiveContexts.add(contextId);
    if (this.releasedLiveContexts.size <= MAX_RELEASED_LIVE_CONTEXTS) return;
    const oldest = this.releasedLiveContexts.values().next().value;
    if (oldest !== undefined) this.releasedLiveContexts.delete(oldest);
  }

  private async performLiveRead(
    client: CodexAccountUsageClient,
    update: CodexRateLimitsUpdate,
    home: string,
  ): Promise<CodexLiveUsageUpdate | null> {
    const context = this.liveContexts.get(update.contextId);
    const cached = await client.read(home);
    if (
      this.liveClosed ||
      !context ||
      this.liveContexts.get(update.contextId) !== context ||
      context.home !== home ||
      (cached.status !== 'available' && cached.status !== 'stale') ||
      cached.fetchedAt === undefined
    )
      return null;
    const ownerKey = client.currentOwnerKey(home);
    if (!ownerKey || (context.ownerKey && context.ownerKey !== ownerKey))
      return null;
    context.ownerKey = ownerKey;
    const lastReadAt = this.lastLiveReads.get(home);
    if (
      cached.fetchedAt >= update.observedAt ||
      (lastReadAt !== undefined &&
        update.observedAt >= lastReadAt &&
        update.observedAt - lastReadAt < LIVE_REFRESH_MIN_INTERVAL_MS)
    ) {
      return this.mapLiveResult(client, update, context, home, ownerKey, cached);
    }
    const result = await client.read(home, { refresh: true });
    if (
      result.status !== 'available' ||
      result.fetchedAt === undefined ||
      result.fetchedAt < update.observedAt
    )
      return null;
    return this.mapLiveResult(client, update, context, home, ownerKey, result);
  }

  private mapLiveResult(
    client: CodexAccountUsageClient,
    update: CodexRateLimitsUpdate,
    context: LiveContext,
    home: string,
    ownerKey: string,
    result: CodexAccountUsageResult,
  ): CodexLiveUsageUpdate | null {
    if (
      this.liveClosed ||
      this.liveContexts.get(update.contextId) !== context ||
      result.fetchedAt === undefined ||
      client.currentOwnerKey(home) !== ownerKey
    )
      return null;
    const reading = mapCodexAccountUsage(result, result.fetchedAt);
    this.lastLiveReads.set(
      home,
      Math.max(this.lastLiveReads.get(home) ?? 0, result.fetchedAt),
    );
    return {
      owner: quotaOwnerRefFromKey(ownerKey),
      windows: reading.windows,
      result,
    };
  }

  async close(): Promise<void> {
    this.liveClosed = true;
    this.liveContexts.clear();
    this.releasedLiveContexts.clear();
    this.lastLiveReads.clear();
    await Promise.all(this.liveReads.values());
    this.liveReads.clear();
    await Promise.all([...this.active].map((child) => this.closeChild(child)));
  }

  private async performRead(
    signal?: AbortSignal,
  ): Promise<CodexAccountUsageResult> {
    const generation = this.generation;
    try {
      const { result, ownerKey } = await this.readFromAppServer(
        generation,
        signal,
      );
      if (generation === this.generation) {
        this.cached = result;
        this.ownerKey = ownerKey;
        this.lastMiss =
          result.status === 'available' ? null : { at: Date.now(), result };
      }
      return result;
    } catch (error: unknown) {
      if (signal?.aborted) throw callerAbortError();
      const cause =
        error instanceof CodexReadStageError ? error.underlyingError : error;
      const status =
        cause instanceof AppServerError && cause.kind === 'method'
          ? 'cli-version-unsupported'
          : cause instanceof AppServerError && cause.kind === 'cli'
            ? 'cli-unavailable'
            : 'service-unavailable';
      this.logger.warn(
        '[CodexAccountUsage] App Server account read unavailable',
        {
          status,
          stage: error instanceof CodexReadStageError ? error.stage : 'spawn',
          errorClass:
            cause instanceof Error ? cause.constructor.name : typeof cause,
        },
      );
      const result: CodexAccountUsageResult = this.cached
        ? { ...this.cached, status: 'stale', staleSince: Date.now() }
        : {
            status,
            providerId: 'openai-codex',
          };
      if (generation === this.generation)
        this.lastMiss = { at: Date.now(), result };
      return result;
    }
  }

  private async readFromAppServer(
    generation: number,
    signal?: AbortSignal,
  ): Promise<AppServerRead> {
    let child: SpawnedProcessHandle;
    try {
      child = this.spawn(['app-server']);
    } catch {
      throw new AppServerError('cli');
    }
    const rpc = this.createRpcClient(child, signal);
    let stage = 'initialize';
    try {
      const initialized = codexInitializeResponseSchema.parse(
        await rpc.request(
          1,
          'initialize',
          {
            clientInfo: { name: 'ptah', version: '1' },
          },
          CODEX_INITIALIZE_TIMEOUT_MS,
        ),
      );
      stage = 'home';
      if (!samePath(initialized.codexHome, this.codexHome.path))
        throw new AppServerError('unavailable');
      rpc.notify('initialized');
      stage = 'account';
      const account = codexAccountResponseSchema.parse(
        await rpc.request(2, 'account/read', { refreshToken: false }),
      );
      if (
        account.account?.type === 'apiKey' ||
        account.account?.type === 'amazonBedrock'
      ) {
        return {
          result: { status: 'unsupported-auth', providerId: 'openai-codex' },
          ownerKey: null,
        };
      }
      if (account.account?.type !== 'chatgpt') {
        return {
          result: { status: 'service-unavailable', providerId: 'openai-codex' },
          ownerKey: null,
        };
      }
      // The email is identity material only: hashed here, never returned or logged.
      const email = account.account.email?.trim();
      const ownerKey = email
        ? accountOwnerKey('openai-codex', `${this.codexHome.path}\0${email}`)
        : null;
      if (generation === this.generation && this.ownerKey !== ownerKey) {
        this.cached = null;
        this.ownerKey = ownerKey;
      }
      stage = 'rate-limits';
      const quota = codexRateLimitsResponseSchema.parse(
        await rpc.request(3, 'account/rateLimits/read'),
      );
      const limits = quota.rateLimitsByLimitId?.['codex'] ?? quota.rateLimits;
      let activity:
        ReturnType<typeof codexTokenUsageResponseSchema.parse> | undefined;
      stage = 'activity';
      try {
        activity = codexTokenUsageResponseSchema.parse(
          await rpc.request(4, 'account/usage/read'),
        );
      } catch (error: unknown) {
        if (signal?.aborted) throw error;
        this.logger.debug('[CodexAccountUsage] optional read unavailable', {
          stage,
          errorClass:
            error instanceof Error ? error.constructor.name : typeof error,
        });
      }
      const reachedType = limits.rateLimitReachedType;
      const result: CodexAccountUsageResult = {
        status: 'available',
        providerId: 'openai-codex',
        fetchedAt: Date.now(),
        account: { planType: account.account.planType },
        quota: {
          ...(limits.primary ? { primary: limits.primary } : {}),
          ...(limits.secondary ? { secondary: limits.secondary } : {}),
          ...(reachedType ? { rateLimitReachedType: reachedType } : {}),
        },
        ...(activity && {
          activity: {
            lifetimeTokens: activity.summary.lifetimeTokens,
            dailyUsage: activity.dailyUsageBuckets ?? [],
          },
        }),
      };
      return { result, ownerKey };
    } catch (error: unknown) {
      throw new CodexReadStageError(stage, error);
    } finally {
      await this.closeChild(child);
    }
  }

  private spawn(args: readonly string[]): SpawnedProcessHandle {
    // The native binary, not the `codex.js` launcher: on Electron
    // `process.execPath` is the Ptah app, so launching the script with it
    // opened a second app instance (Plane PTAH-20).
    const binary = resolveCodexNativeBinaryPath();
    if (binary === undefined) throw new AppServerError('cli');
    const child = this.spawner.spawnProcess({
      command: binary,
      args: [...args],
      env: { ...process.env, CODEX_HOME: this.codexHome.path },
    });
    this.active.add(child);
    child.once('close', () => this.active.delete(child));
    return child;
  }

  private closeChild(child: SpawnedProcessHandle): Promise<void> {
    const existing = this.closing.get(child);
    if (existing !== undefined) return existing;
    const closing = new Promise<void>((done) => {
      this.active.delete(child);
      child.stdin?.end();
      if (child.killed) {
        done();
        return;
      }
      const timer = setTimeout(done, 1_000);
      timer.unref?.();
      child.once('close', () => {
        clearTimeout(timer);
        done();
      });
      child.kill();
    }).finally(() => this.closing.delete(child));
    this.closing.set(child, closing);
    return closing;
  }

  private createRpcClient(
    child: SpawnedProcessHandle,
    signal?: AbortSignal,
  ): {
    request: (
      id: number,
      method: string,
      params?: unknown,
      timeoutMs?: number,
    ) => Promise<unknown>;
    notify: (method: string) => void;
  } {
    let buffer = '';
    const pending = new Map<
      number,
      {
        method: string;
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >();
    const rejectAll = (error: Error) => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    };
    child.stdout?.on('data', (chunk) => {
      buffer += String(chunk);
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES)
        return rejectAll(new AppServerError('unavailable'));
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const envelope = JSON.parse(line) as RpcResponse;
          const pendingMethod = pending.get(envelope.id)?.method;
          const response =
            pendingMethod === 'account/usage/read'
              ? (JSON.parse(preserveAccountUsageInt64(line)) as RpcResponse)
              : envelope;
          const waiter = pending.get(response.id);
          if (!waiter) continue;
          pending.delete(response.id);
          if (response.error) {
            waiter.reject(
              new AppServerError(
                response.error.code === -32601 ? 'method' : 'unavailable',
              ),
            );
          } else {
            waiter.resolve(response.result);
          }
        } catch {
          rejectAll(new AppServerError('unavailable'));
        }
      }
    });
    child.once('error', () => rejectAll(new AppServerError('unavailable')));
    child.once('close', () => rejectAll(new AppServerError('unavailable')));
    signal?.addEventListener(
      'abort',
      () => rejectAll(new AppServerError('unavailable')),
      { once: true },
    );
    const write = (value: object) =>
      child.stdin?.write(`${JSON.stringify(value)}\n`);
    return {
      request: (id, method, params, timeoutMs = REQUEST_TIMEOUT_MS) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new AppServerError('unavailable'));
          }, timeoutMs);
          timer.unref?.();
          pending.set(id, {
            method,
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          write({ id, method, ...(params === undefined ? {} : { params }) });
        }),
      notify: (method) => {
        write({ method });
      },
    };
  }
}
