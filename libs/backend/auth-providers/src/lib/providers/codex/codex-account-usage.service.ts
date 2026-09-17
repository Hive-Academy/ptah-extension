import { dirname, join, resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import type { IProcessSpawner, SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, type SdkAdapterEvents } from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import { CodexHomeResolver } from './codex-home-resolver';
import type {
  ICodexAccountUsageService, ICodexAuthService, CodexAccountUsageResult,
} from './codex-provider.types';
import {
  CODEX_ACCOUNT_PROTOCOL_VERSION, CODEX_ACCOUNT_USAGE_INT64_FIELDS, codexAccountResponseSchema,
  codexInitializeResponseSchema, codexRateLimitsResponseSchema,
  codexTokenUsageResponseSchema,
} from './codex-account.schemas';

const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LINE_BYTES = 1024 * 1024;

class AppServerError extends Error {
  constructor(readonly kind: 'cli' | 'unavailable' | 'version' | 'method') {
    super(kind);
  }
}

interface RpcResponse { id: number; result?: unknown; error?: { code?: number } }

function samePath(left: string, right: string): boolean {
  const [a, b] = [resolve(left), resolve(right)];
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
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

function joinWithCallerAbort<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
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

function packagedCodexScript(): string {
  const packageJson = require.resolve('@openai/codex/package.json') as string;
  return join(dirname(packageJson), 'bin', 'codex.js');
}

@injectable()
export class CodexAccountUsageService implements ICodexAccountUsageService {
  private cached: CodexAccountUsageResult | null = null;
  private readInFlight: Promise<CodexAccountUsageResult> | null = null;
  private readonly active = new Set<SpawnedProcessHandle>();
  private readonly closing = new Map<SpawnedProcessHandle, Promise<void>>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH) private readonly auth: ICodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER) private readonly codexHome: CodexHomeResolver,
    @inject(SDK_TOKENS.SDK_PROCESS_SPAWNER) private readonly spawner: IProcessSpawner,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS) events: SdkAdapterEvents,
  ) {
    events.onAuthFileChanged((event) => {
      if (event.providerId === 'openai-codex') this.clearCache();
    });
  }

  clearCache(): void { this.cached = null; }

  async getAccountUsage(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<CodexAccountUsageResult> {
    const eligibility = await this.auth.getAccountUsageEligibility();
    if (eligibility !== 'supported') {
      return { status: eligibility, providerId: 'openai-codex' };
    }
    if (!options.refresh && this.cached?.fetchedAt && Date.now() - this.cached.fetchedAt < CACHE_TTL_MS) {
      return this.cached;
    }
    // The initiating caller still owns cancellation of the shared process.
    // Joiners can abandon only their own wait without disrupting other callers.
    if (this.readInFlight) return joinWithCallerAbort(this.readInFlight, options.signal);
    const read = this.performRead(options.signal);
    this.readInFlight = read;
    try { return await read; } finally {
      if (this.readInFlight === read) this.readInFlight = null;
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.active].map((child) => this.closeChild(child)));
  }

  private async performRead(signal?: AbortSignal): Promise<CodexAccountUsageResult> {
    try {
      const result = await this.readFromAppServer(signal);
      this.cached = result;
      return result;
    } catch (error: unknown) {
      const status = error instanceof AppServerError && error.kind === 'version'
        ? 'cli-version-unsupported'
        : error instanceof AppServerError && error.kind === 'method'
          ? 'cli-version-unsupported'
          : error instanceof AppServerError && error.kind === 'cli'
            ? 'cli-unavailable'
            : 'service-unavailable';
      this.logger.warn('[CodexAccountUsage] App Server account read unavailable', { status });
      return this.cached ? { ...this.cached, status: 'stale', staleSince: Date.now() } : {
        status, providerId: 'openai-codex',
      };
    }
  }

  private async readFromAppServer(signal?: AbortSignal): Promise<CodexAccountUsageResult> {
    await this.assertVersion(signal);
    const child = this.spawn(['app-server']);
    const rpc = this.createRpcClient(child, signal);
    try {
      const initialized = codexInitializeResponseSchema.parse(await rpc.request(1, 'initialize', {
        clientInfo: { name: 'ptah', version: '1' },
      }));
      if (!samePath(initialized.codexHome, this.codexHome.path)) throw new AppServerError('unavailable');
      rpc.notify('initialized');
      const account = codexAccountResponseSchema.parse(
        await rpc.request(2, 'account/read', { refreshToken: false }),
      );
      if (account.account?.type === 'apiKey' || account.account?.type === 'amazonBedrock') {
        return { status: 'unsupported-auth', providerId: 'openai-codex' };
      }
      if (account.account?.type !== 'chatgpt') {
        return { status: 'service-unavailable', providerId: 'openai-codex' };
      }
      const quota = codexRateLimitsResponseSchema.parse(
        await rpc.request(3, 'account/rateLimits/read'),
      );
      const activity = codexTokenUsageResponseSchema.parse(
        await rpc.request(4, 'account/usage/read'),
      );
      return {
        status: 'available', providerId: 'openai-codex', fetchedAt: Date.now(),
        account: { planType: account.account.planType },
        quota: {
          ...(quota.rateLimits.primary ? { primary: quota.rateLimits.primary } : {}),
          ...(quota.rateLimits.secondary ? { secondary: quota.rateLimits.secondary } : {}),
        },
        activity: {
          lifetimeTokens: activity.summary.lifetimeTokens,
          dailyUsage: activity.dailyUsageBuckets ?? [],
        },
      };
    } finally {
      await this.closeChild(child);
    }
  }

  private spawn(args: readonly string[]): SpawnedProcessHandle {
    const child = this.spawner.spawnProcess({
      command: process.execPath,
      args: [packagedCodexScript(), ...args],
      env: { ...process.env, CODEX_HOME: this.codexHome.path },
    });
    this.active.add(child);
    child.once('close', () => this.active.delete(child));
    return child;
  }

  private async assertVersion(signal?: AbortSignal): Promise<void> {
    let output: string;
    try {
      const child = this.spawn(['--version']);
      output = await this.readProcessOutput(child, signal);
    } catch (error: unknown) {
      if (error instanceof AppServerError && error.kind === 'version') throw error;
      throw new AppServerError('cli');
    }
    if (!output.trim().endsWith(CODEX_ACCOUNT_PROTOCOL_VERSION)) {
      throw new AppServerError('version');
    }
  }

  private closeChild(child: SpawnedProcessHandle): Promise<void> {
    const existing = this.closing.get(child);
    if (existing) return existing;
    const closing = new Promise<void>((done) => {
      this.active.delete(child);
      child.stdin?.end();
      if (child.killed) { done(); return; }
      const timer = setTimeout(done, 1_000);
      timer.unref?.();
      child.once('close', () => { clearTimeout(timer); done(); });
      child.kill();
    }).finally(() => this.closing.delete(child));
    this.closing.set(child, closing);
    return closing;
  }

  private readProcessOutput(child: SpawnedProcessHandle, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => fail(new AppServerError('unavailable')), REQUEST_TIMEOUT_MS);
      timer.unref?.();
      const fail = (error: Error) => {
        clearTimeout(timer);
        if (!child.killed) child.kill();
        reject(error);
      };
      child.stdout?.on('data', (chunk) => {
        output += String(chunk);
        if (Buffer.byteLength(output) > MAX_LINE_BYTES) fail(new AppServerError('unavailable'));
      });
      child.once('error', () => fail(new AppServerError('unavailable')));
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(output);
        else reject(new AppServerError('unavailable'));
      });
      signal?.addEventListener('abort', () => fail(new AppServerError('unavailable')), { once: true });
    });
  }

  private createRpcClient(child: SpawnedProcessHandle, signal?: AbortSignal): {
    request: (id: number, method: string, params?: unknown) => Promise<unknown>;
    notify: (method: string) => void;
  } {
    let buffer = '';
    const pending = new Map<number, {
      method: string; resolve: (value: unknown) => void; reject: (error: Error) => void;
    }>();
    const rejectAll = (error: Error) => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    };
    child.stdout?.on('data', (chunk) => {
      buffer += String(chunk);
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) return rejectAll(new AppServerError('unavailable'));
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const envelope = JSON.parse(line) as RpcResponse;
          const pendingMethod = pending.get(envelope.id)?.method;
          const response = pendingMethod === 'account/usage/read'
            ? JSON.parse(preserveAccountUsageInt64(line)) as RpcResponse
            : envelope;
          const waiter = pending.get(response.id);
          if (!waiter) continue;
          pending.delete(response.id);
          if (response.error) {
            waiter.reject(new AppServerError(response.error.code === -32601 ? 'method' : 'unavailable'));
          } else {
            waiter.resolve(response.result);
          }
        } catch { rejectAll(new AppServerError('unavailable')); }
      }
    });
    child.once('error', () => rejectAll(new AppServerError('unavailable')));
    child.once('close', () => rejectAll(new AppServerError('unavailable')));
    signal?.addEventListener('abort', () => rejectAll(new AppServerError('unavailable')), { once: true });
    const write = (value: object) => child.stdin?.write(`${JSON.stringify(value)}\n`);
    return {
      request: (id, method, params) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id); reject(new AppServerError('unavailable'));
        }, REQUEST_TIMEOUT_MS);
        timer.unref?.();
        pending.set(id, {
          method,
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        write({ id, method, ...(params === undefined ? {} : { params }) });
      }),
      notify: (method) => { write({ method }); },
    };
  }
}
