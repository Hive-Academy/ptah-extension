import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { MESSAGE_TYPES, type CodexLoginMode, type CodexLoginState } from '@ptah-extension/shared';
import { AuthStateService } from './auth-state.service';
import { ClaudeRpcService } from './claude-rpc.service';
import { acceptsCodexLogin, isFinalCodexLogin, parseCodexLoginState } from './codex-login';
import type { MessageHandler } from './message-router.types';
import { VSCodeService } from './vscode.service';

const NOTHING_SEEN_MS = 20_000;
const RPC_TIMEOUT_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class CodexSignInService implements MessageHandler {
  readonly handledMessageTypes = [MESSAGE_TYPES.AUTH_CODEX_LOGIN_STATUS] as const;
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly authState = inject(AuthStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stateValue = signal<CodexLoginState | null>(null);
  readonly state = this.stateValue.asReadonly();
  private readonly nothingSeenValue = signal(false);
  readonly nothingSeen = this.nothingSeenValue.asReadonly();
  private readonly refreshFailedValue = signal(false);
  readonly refreshFailed = this.refreshFailedValue.asReadonly();
  private readonly refreshingValue = signal(false);
  readonly refreshing = this.refreshingValue.asReadonly();
  private readonly confirmationValue = signal<'idle' | 'checking' | 'confirmed' | 'failed'>('idle');
  readonly confirmation = this.confirmationValue.asReadonly();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private previousAttemptId: string | null = null;
  private disposed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.disposed = true;
      this.generation++;
      this.clearTimer();
    });
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (!this.vscode.isElectron || this.disposed || message.type !== MESSAGE_TYPES.AUTH_CODEX_LOGIN_STATUS) return;
    const state = parseCodexLoginState(message.payload);
    if (state) this.accept(state);
  }

  start(mode: CodexLoginMode = 'browser'): Promise<void> {
    return this.launch(mode, false);
  }

  restart(mode: CodexLoginMode = 'browser'): Promise<void> {
    return this.launch(mode, true);
  }

  private async launch(mode: CodexLoginMode, restart: boolean): Promise<void> {
    if (!this.vscode.isElectron || this.disposed) return;
    const generation = ++this.generation;
    this.refreshFailedValue.set(false);
    this.refreshingValue.set(false);
    this.confirmationValue.set('idle');
    if (restart || isFinalCodexLogin(this.stateValue())) {
      this.previousAttemptId = this.stateValue()?.attemptId ?? null;
      this.stateValue.set(null);
      this.nothingSeenValue.set(false);
      this.clearTimer();
    }
    try {
      const result = await this.rpc.call('auth:codexLogin', { mode, restart }, { timeout: RPC_TIMEOUT_MS });
      if (generation !== this.generation || this.disposed) return;
      if (!result.isSuccess()) {
        this.localFailure(mode);
        return;
      }
      const response: unknown = result.data;
      if (isRecord(response)) {
        const state = parseCodexLoginState(response['state']);
        if (state) {
          this.accept(state);
          return;
        }
        if (response['state'] === undefined && response['success'] === false) {
          this.localFailure(mode);
        }
      } else {
        this.localFailure(mode);
      }
    } catch {
      if (generation === this.generation && !this.disposed) this.localFailure(mode);
    }
  }

  async cancel(): Promise<void> {
    if (!this.vscode.isElectron || this.disposed) return;
    try {
      await this.rpc.call('auth:codexLoginCancel', {}, { timeout: RPC_TIMEOUT_MS });
    } catch {
      // A status push, if any, remains authoritative.
    }
  }

  private localFailure(mode: CodexLoginMode): void {
    const current = this.stateValue();
    if (isFinalCodexLogin(current)) return;
    this.accept({ attemptId: current?.attemptId ?? `local-${this.generation}`, mode, status: 'failed' });
  }

  private accept(next: CodexLoginState): void {
    if (!this.stateValue() && next.attemptId === this.previousAttemptId) return;
    if (!acceptsCodexLogin(this.stateValue(), next)) return;
    this.previousAttemptId = null;
    const previous = this.stateValue();
    this.stateValue.set(next);
    if (next.status !== 'succeeded') {
      this.refreshFailedValue.set(false);
      this.refreshingValue.set(false);
      this.confirmationValue.set('idle');
    }
    this.nothingSeenValue.set(false);
    this.clearTimer();
    if ((next.status === 'starting' || next.status === 'running') && !next.verificationUrl && !next.userCode) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.nothingSeenValue.set(true);
      }, NOTHING_SEEN_MS);
    }
    if (next.status === 'succeeded' && previous?.status !== 'succeeded') {
      void this.checkAuthStatus();
    }
  }

  async checkAuthStatus(): Promise<void> {
    if (this.disposed || this.stateValue()?.status !== 'succeeded' || this.refreshingValue()) return;
    const generation = this.generation;
    this.refreshingValue.set(true);
    this.refreshFailedValue.set(false);
    this.confirmationValue.set('checking');
    let confirmed = false;
    try {
      confirmed = await this.authState.refreshAuthStatus();
    } catch {
      confirmed = false;
    }
    if (this.disposed || generation !== this.generation) return;
    this.refreshingValue.set(false);
    this.refreshFailedValue.set(!confirmed);
    this.confirmationValue.set(confirmed ? 'confirmed' : 'failed');
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
