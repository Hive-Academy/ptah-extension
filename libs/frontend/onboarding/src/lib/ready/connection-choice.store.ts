import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthStateService, ProvidersSettingsStateService, defaultMainConnectionTarget, mainConnectionTargetWritable } from '@ptah-extension/core';
import type { ProviderKind, SelectionView } from './provider-readiness.derive';
import { ProviderReadinessStore } from './provider-readiness.store';

export type ChoiceNotice = 6 | 7 | 8 | 9 | 10 | 11 | 12 | null;

// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- The stage 1 page owns this transient choice.
@Injectable()
export class ConnectionChoiceStore {
  private readonly settings = inject(ProvidersSettingsStateService);
  private readonly auth = inject(AuthStateService);
  private readonly readiness = inject(ProviderReadinessStore);
  readonly pending = signal<ProviderKind | null>(null);
  readonly phase = signal<'idle' | 'saving'>('idle');
  readonly notice = signal<ChoiceNotice>(null);
  readonly saved = this.readiness.selection;
  readonly target = computed(() => defaultMainConnectionTarget(this.settings));
  readonly canConfirm = computed(() => this.target() !== null &&
    this.settings.reviewContext() !== null && mainConnectionTargetWritable(this.settings, this.target()));
  readonly changed = computed(() => this.pending() !== null && this.pending() !== this.saved().kind);
  private opened = false;

  choose(provider: ProviderKind): void {
    if (this.phase() === 'saving') return;
    this.pending.set(provider);
    this.notice.set(null);
    if (provider !== this.saved().kind && !this.opened) {
      this.opened = true;
      void this.settings.open();
    }
  }

  cancel(): void { this.pending.set(null); this.notice.set(null); }

  async confirm(): Promise<void> {
    const provider = this.pending();
    const target = this.target();
    const context = this.settings.reviewContext();
    if (!provider || !target || !context || !this.canConfirm() || this.phase() === 'saving') return;
    this.phase.set('saving');
    this.notice.set(null);
    try {
      const id = provider;
      const result = await this.settings.activateConnection(id, target, context);
      // Read the commit only after this invocation has settled, as the Providers drawer does.
      const commit = this.settings.commit();
      if (!result.started) this.notice.set(8);
      else if (commit.status === 'blocked' || commit.status === 'failed' || commit.status === 'partial') this.notice.set(9);
      else if (commit.status === 'unconfirmed') {
        try { await this.auth.refreshAuthStatus(); } catch { /* Persisted selection remains the source of truth. */ }
        this.notice.set(10);
      } else if (commit.status === 'saved' && result.selectionReread === 'failed') {
        this.readiness.markSelectionNotConfirmed();
        this.notice.set(11);
      } else if (commit.status === 'saved') {
        this.notice.set(commit.refreshFailed ? 7 : 6);
      } else this.notice.set(9);
      this.pending.set(null);
    } catch {
      this.notice.set(9);
    } finally {
      this.phase.set('idle');
    }
  }

  async retry(): Promise<void> {
    const confirmed = await this.readiness.retrySelection();
    this.notice.set(confirmed ? null : 12);
  }

  nameForPending(): string {
    return this.pending() === 'openai-codex' ? 'Codex' : 'Claude Code';
  }

  name(selection: SelectionView = this.saved()): string {
    return selection.kind === 'claude-cli' ? 'Claude Code' : selection.kind === 'openai-codex' ? 'Codex'
      : selection.kind === 'other' ? selection.name : 'your previous connection';
  }
}
