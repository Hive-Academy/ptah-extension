import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type {
  AuthGetCodexReadinessResponse,
  ReadinessTrigger,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';

const READINESS_RPC_TIMEOUT_MS = 25_000;
const OUTCOMES: ReadonlySet<string> = new Set([
  'signed-in', 'stale', 'signed-out', 'unreadable', 'timeout',
]);
const SOURCES: ReadonlySet<string> = new Set(['installed', 'bundled']);
const UNREADABLE: ReadonlySet<string> = new Set(['auth-file', 'home']);
const REASONS: ReadonlySet<string> = new Set(['timeout', 'local']);

export interface CodexReadinessView {
  readonly status: 'inert' | 'idle' | 'checking' | 'ready';
  readonly result: AuthGetCodexReadinessResponse | null;
  readonly localFailure: boolean;
  readonly transportTimeout: boolean;
}

const IDLE: CodexReadinessView = {
  status: 'idle', result: null, localFailure: false, transportTimeout: false,
};
const INERT: CodexReadinessView = { ...IDLE, status: 'inert' };
const FAILED: CodexReadinessView = { status: 'ready', result: null, localFailure: true, transportTimeout: false };

@Injectable({ providedIn: 'root' })
export class CodexReadinessService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly enabled = inject(VSCodeService).isElectron;
  private readonly viewState = signal<CodexReadinessView>(this.enabled ? IDLE : INERT);
  private seq = 0;
  private disposed = false;

  readonly view = this.viewState.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.disposed = true; });
  }

  async read(refresh: boolean, trigger?: ReadinessTrigger): Promise<void> {
    if (!this.enabled || this.disposed) return;
    const seq = ++this.seq;
    this.viewState.update((view) => ({ ...view, status: 'checking' }));
    const { result, transportTimeout } = await this.fetch(refresh, trigger);
    if (this.disposed || seq !== this.seq) return;
    this.viewState.set(result
      ? { status: 'ready', result, localFailure: false, transportTimeout: false }
      : { ...FAILED, transportTimeout });
  }

  private async fetch(
    refresh: boolean,
    trigger?: ReadinessTrigger,
  ): Promise<{ result: AuthGetCodexReadinessResponse | null; transportTimeout: boolean }> {
    try {
      const response = await this.rpc.call(
        'auth:getCodexReadiness',
        { refresh, ...(trigger === undefined ? {} : { trigger }) },
        { timeout: READINESS_RPC_TIMEOUT_MS },
      );
      if (!response.isSuccess()) {
        return { result: null, transportTimeout: response.error?.startsWith('RPC timeout:') ?? false };
      }
      const result: unknown = response.data;
      if (!isCodexReadiness(result)) return { result: null, transportTimeout: false };
      const binary = result.binary.state === 'found'
        ? { state: 'found' as const, path: result.binary.path, version: result.binary.version, source: result.binary.source }
        : result.binary.state === 'unknown'
          ? { state: 'unknown' as const, reason: result.binary.reason }
          : { state: 'missing' as const };
      const signIn = result.signIn.unreadable === undefined
        ? { outcome: result.signIn.outcome }
        : { outcome: result.signIn.outcome, unreadable: result.signIn.unreadable };
      return { result: { binary, signIn, checkedAt: result.checkedAt }, transportTimeout: false };
    } catch {
      return { result: null, transportTimeout: false };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCodexReadiness(value: unknown): value is AuthGetCodexReadinessResponse {
  if (!isRecord(value)) return false;
  const binary = value['binary'];
  const signIn = value['signIn'];
  const checkedAt = value['checkedAt'];
  if (!isRecord(binary) || !isRecord(signIn)) return false;
  if (typeof checkedAt !== 'string') return false;
  if (binary['state'] === 'found') {
    if (typeof binary['path'] !== 'string' || typeof binary['version'] !== 'string' ||
        typeof binary['source'] !== 'string' || !SOURCES.has(binary['source'])) return false;
  } else if (binary['state'] === 'unknown') {
    if (typeof binary['reason'] !== 'string' || !REASONS.has(binary['reason'])) return false;
  } else if (binary['state'] !== 'missing') return false;
  return typeof signIn['outcome'] === 'string' && OUTCOMES.has(signIn['outcome']) &&
    (signIn['unreadable'] === undefined ||
      (signIn['outcome'] === 'unreadable' && typeof signIn['unreadable'] === 'string' && UNREADABLE.has(signIn['unreadable'])));
}
