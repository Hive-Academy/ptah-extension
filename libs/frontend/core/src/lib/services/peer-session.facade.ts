import { Injectable, inject, signal, computed } from '@angular/core';
import type {
  PeerSessionListParams,
  PeerSessionListResult,
  PeerSessionRow,
  PeerSessionCrossWorkspacePolicy,
  PeerSessionSendParams,
  PeerSessionSendResult,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';

export interface FetchSessionsOptions {
  readonly force?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PeerSessionFacade {
  private readonly rpc = inject(ClaudeRpcService);

  private readonly _isLoading = signal(false);
  private readonly _sessions = signal<readonly PeerSessionRow[]>([]);
  private readonly _currentWorkspace = signal<string | null>(null);
  private readonly _crossWorkspacePolicy =
    signal<PeerSessionCrossWorkspacePolicy | null>(null);
  private readonly _livenessVerifiable = signal(true);
  private readonly _error = signal<string | null>(null);
  private readonly _isSending = signal(false);
  private readonly _lastSendResult = signal<PeerSessionSendResult | null>(null);

  readonly isLoading = computed(() => this._isLoading());
  readonly sessions = computed(() => this._sessions());
  readonly currentWorkspace = computed(() => this._currentWorkspace());
  readonly crossWorkspacePolicy = computed(() =>
    this._crossWorkspacePolicy(),
  );
  readonly livenessVerifiable = computed(() => this._livenessVerifiable());
  readonly error = computed(() => this._error());
  readonly isSending = computed(() => this._isSending());
  readonly lastSendResult = computed(() => this._lastSendResult());

  /**
   * Monotonic request generation counter.
   * Ensures stale in-flight responses settle safely and do not overwrite
   * state after a newer request or clear.
   */
  private _generation = 0;

  /**
   * Fetch peer sessions from the backend RPC service (`peerSession:list`).
   *
   * The facade faithfully returns the backend results without re-deriving
   * reachability or re-applying any workspace filter.
   *
   * @param params Optional filtering options (e.g. excludeSessionId).
   * @param options Optional options (e.g. force to bypass in-flight guard).
   * @returns The PeerSessionListResult or null on failure / superseded response.
   */
  async fetchSessions(
    params?: PeerSessionListParams,
    options?: FetchSessionsOptions,
  ): Promise<PeerSessionListResult | null> {
    if (this._isLoading() && !options?.force) {
      return null;
    }

    this._isLoading.set(true);
    this._error.set(null);
    const generation = ++this._generation;

    try {
      const result = await this.rpc.call('peerSession:list', params ?? {});

      if (generation !== this._generation) {
        return null;
      }

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._currentWorkspace.set(result.data.currentWorkspace);
        this._crossWorkspacePolicy.set(result.data.crossWorkspacePolicy);
        this._livenessVerifiable.set(result.data.livenessVerifiable);
        return result.data;
      } else {
        const message = result.error ?? 'Failed to list peer sessions';
        console.warn('[PeerSessionFacade] Failed to list peer sessions:', message);
        this._error.set(message);
        this._sessions.set([]);
        return null;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch peer sessions';
      console.error('[PeerSessionFacade] Failed to fetch peer sessions:', error);
      if (generation === this._generation) {
        this._error.set(message);
        this._sessions.set([]);
      }
      return null;
    } finally {
      if (generation === this._generation) {
        this._isLoading.set(false);
      }
    }
  }

  /**
   * Refresh the list of peer sessions unconditionally (`force: true`).
   * Criterion 6: Refreshed on open, not cached across openings.
   */
  async refreshSessions(
    params?: PeerSessionListParams,
  ): Promise<PeerSessionListResult | null> {
    return this.fetchSessions(params, { force: true });
  }

  /**
   * Search cached sessions by query string (case-insensitive substring match
   * against name, workspaceLabel, and workspace).
   *
   * Preserves reachability and cross-workspace status exactly as returned by
   * the backend — only filters by the text query.
   */
  searchSessions(query: string): readonly PeerSessionRow[] {
    const allSessions = this._sessions();
    if (!query) {
      return allSessions;
    }
    const lowerQuery = query.toLowerCase();
    return allSessions.filter(
      (s) =>
        s.name.toLowerCase().includes(lowerQuery) ||
        s.workspaceLabel.toLowerCase().includes(lowerQuery) ||
        s.workspace.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Send a message to a peer session via backend RPC (`peerSession:send`).
   *
   * Returns the outcome as reported by the backend ('accepted' | 'refused')
   * with the unmodified acceptanceCaveat.
   */
  async send(params: PeerSessionSendParams): Promise<PeerSessionSendResult> {
    this._isSending.set(true);
    this._error.set(null);

    try {
      const result = await this.rpc.call('peerSession:send', params);
      if (result.success && result.data) {
        this._lastSendResult.set(result.data);
        return result.data;
      } else {
        const message = result.error ?? 'Failed to send peer message';
        this._error.set(message);
        throw new Error(message);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to send peer message';
      console.error('[PeerSessionFacade] Failed to send peer message:', error);
      this._error.set(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      this._isSending.set(false);
    }
  }

  /**
   * Alias for send() to provide natural method naming for callers.
   */
  async sendMessage(
    params: PeerSessionSendParams,
  ): Promise<PeerSessionSendResult> {
    return this.send(params);
  }

  /**
   * Clear session state and cancel pending in-flight updates.
   */
  clear(): void {
    this._generation++;
    this._sessions.set([]);
    this._currentWorkspace.set(null);
    this._crossWorkspacePolicy.set(null);
    this._error.set(null);
    this._isLoading.set(false);
  }
}
