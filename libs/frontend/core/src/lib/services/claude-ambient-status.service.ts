import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  PROVIDER_AMBIENT_CLAUDE_REASONS,
  PROVIDER_AMBIENT_CLAUDE_STATES,
  type ProviderAmbientClaudeStatus,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';

/**
 * Strictly above the host's queue-inclusive 25 s per-read deadline (P5-D16), so the host's
 * own `unknown/timeout` answer arrives before `ClaudeRpcService` drops the pending call.
 */
const AMBIENT_RPC_TIMEOUT_MS = 30_000;

/**
 * The webview's view of the ambient (unnamed) Claude login.
 *
 * - `inert`: this host does not serve account methods; no RPC is ever made.
 * - `checking`: the latest read is in flight. Consumers show no Connected, count or age.
 * - `ready` with `localFailure: false`: `result` is the host's answer, unchanged.
 * - `ready` with `localFailure: true`: transport failure or refusal. `result` is `null`, so an
 *   earlier `connected` is never kept visible and no host-shaped `checkedAt` exists (P5-D15).
 */
export interface ClaudeAmbientStatusView {
  readonly status: 'inert' | 'idle' | 'checking' | 'ready';
  readonly result: ProviderAmbientClaudeStatus | null;
  readonly localFailure: boolean;
}

const IDLE: ClaudeAmbientStatusView = {
  status: 'idle',
  result: null,
  localFailure: false,
};
const INERT: ClaudeAmbientStatusView = { ...IDLE, status: 'inert' };
const FAILED: ClaudeAmbientStatusView = {
  status: 'ready',
  result: null,
  localFailure: true,
};

/**
 * Single owner of the `provider:getAmbientClaudeStatus` read (TASK_2026_719 P5).
 * Inert unless the host is Electron, the only host profile with `providerAccounts`.
 * Only the reply to the latest `read()` is applied; older replies are dropped.
 * No constructor I/O, polling or timers: consumers call `read()`.
 */
@Injectable({ providedIn: 'root' })
export class ClaudeAmbientStatusService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly enabled = inject(VSCodeService).isElectron;
  private readonly viewState = signal<ClaudeAmbientStatusView>(
    this.enabled ? IDLE : INERT,
  );
  private seq = 0;
  private disposed = false;

  readonly view = this.viewState.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
    });
  }

  /**
   * `refresh: false` lets the host answer from its cache (it may probe once when the cache is
   * empty or old, P5-D10); `refresh: true` asks for a new probe. Never throws.
   */
  async read(refresh: boolean): Promise<void> {
    if (!this.enabled || this.disposed) return;
    const seq = ++this.seq;
    this.viewState.update((view) => ({ ...view, status: 'checking' }));
    const status = await this.fetch(refresh);
    if (this.disposed || seq !== this.seq) return;
    this.viewState.set(
      status ? { status: 'ready', result: status, localFailure: false } : FAILED,
    );
  }

  /** The host's status, or `null` for a transport failure, refusal or malformed reply. */
  private async fetch(
    refresh: boolean,
  ): Promise<ProviderAmbientClaudeStatus | null> {
    try {
      const response = await this.rpc.call(
        'provider:getAmbientClaudeStatus',
        { provider: 'claude', refresh },
        { timeout: AMBIENT_RPC_TIMEOUT_MS },
      );
      if (!response.isSuccess() || !response.data.ok) return null;
      const status: unknown = response.data.status;
      if (!isAmbientStatus(status)) return null;
      // Copy the three contract fields only, so nothing else a host sends reaches the view.
      return status.reason === undefined
        ? { state: status.state, checkedAt: status.checkedAt }
        : {
            state: status.state,
            checkedAt: status.checkedAt,
            reason: status.reason,
          };
    } catch {
      // degradation-audit: reported - the view shows the local failure as "Could not check".
      // A rejected transport promise is a local failure like any other; the caller
      // contract is "never throws", and the view already says "Could not check".
      return null;
    }
  }
}

const STATES: ReadonlySet<string> = new Set(PROVIDER_AMBIENT_CLAUDE_STATES);
const REASONS: ReadonlySet<string> = new Set(PROVIDER_AMBIENT_CLAUDE_REASONS);

/** Boundary check on the host reply: the three known fields with known values only. */
function isAmbientStatus(value: unknown): value is ProviderAmbientClaudeStatus {
  if (typeof value !== 'object' || value === null) return false;
  const { state, checkedAt, reason } = value as Record<string, unknown>;
  return (
    typeof state === 'string' &&
    STATES.has(state) &&
    (checkedAt === null || typeof checkedAt === 'string') &&
    (reason === undefined || (typeof reason === 'string' && REASONS.has(reason)))
  );
}
