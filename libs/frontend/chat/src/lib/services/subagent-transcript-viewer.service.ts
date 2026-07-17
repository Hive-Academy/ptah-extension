import { Injectable, inject, signal } from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { SubagentTranscriptMessage } from '@ptah-extension/shared';

/**
 * SubagentTranscriptViewerService — tiny root signal store that drives the
 * on-demand subagent transcript overlay.
 *
 * Both places a user sees an agent (the inline execution bubble and the
 * background-agent tray) inject this and call {@link openFor}. A single overlay
 * host (mounted once in `AppShellComponent`) reads these signals and renders the
 * presentational `SubagentTranscriptViewerComponent`. Keeping the open-state in
 * one root service — rather than duplicating it in every host — means the two
 * triggers share exactly one modal.
 *
 * The service owns the RPC round-trip via
 * {@link AgentMonitorStore.getSubagentTranscript}. Because that method already
 * swallows RPC failures into `[]` (empty = "no transcript yet" per the backend
 * contract), the `error` signal here only ever surfaces an unexpected thrown
 * exception; the normal not-found path renders the viewer's empty state.
 */
@Injectable({ providedIn: 'root' })
export class SubagentTranscriptViewerService {
  private readonly store = inject(AgentMonitorStore);

  private readonly _open = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _messages = signal<readonly SubagentTranscriptMessage[]>([]);
  private readonly _agentName = signal('');

  /** The agent currently being viewed (session + SDK agentId). */
  private current: { sessionId: string; agentId: string } | null = null;

  /**
   * Monotonic token guarding against out-of-order responses when the user
   * opens/refreshes rapidly: a load only commits its result if its token still
   * matches the latest one.
   */
  private loadToken = 0;

  readonly open = this._open.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly agentName = this._agentName.asReadonly();

  /**
   * Open the overlay for a specific subagent and fetch its transcript.
   *
   * @param agentName Human-readable display name (agent type / description).
   * @param sessionId Owning parent session id (`parentSessionId`).
   * @param agentId SDK short-hex agent id (`SubagentRecord.agentId`).
   */
  async openFor(
    agentName: string,
    sessionId: string,
    agentId: string,
  ): Promise<void> {
    this._agentName.set(agentName || 'Subagent');
    this.current = { sessionId, agentId };
    this._messages.set([]);
    this._open.set(true);
    await this.load();
  }

  /** Re-fetch the current agent's transcript (no-op when nothing is open). */
  async refresh(): Promise<void> {
    if (!this.current) return;
    await this.load();
  }

  /** Close the overlay and clear its transient state. */
  close(): void {
    this._open.set(false);
    this._messages.set([]);
    this._error.set(null);
    this.current = null;
    // Invalidate any in-flight load so a late response can't reopen content.
    this.loadToken++;
  }

  private async load(): Promise<void> {
    const target = this.current;
    if (!target) return;
    const token = ++this.loadToken;
    this._loading.set(true);
    this._error.set(null);
    try {
      const messages = await this.store.getSubagentTranscript(
        target.sessionId,
        target.agentId,
      );
      if (token !== this.loadToken) return; // superseded by a newer load/close
      this._messages.set(messages);
    } catch (err: unknown) {
      if (token !== this.loadToken) return;
      this._error.set(
        err instanceof Error ? err.message : 'Failed to load transcript',
      );
    } finally {
      if (token === this.loadToken) this._loading.set(false);
    }
  }
}
