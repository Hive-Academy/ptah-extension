import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  AuthStateService,
  ClaudeAmbientStatusService,
  CodexReadinessService,
  ProvidersSettingsStateService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  deriveChosen,
  deriveClaudeReadiness,
  deriveCodexReadiness,
  deriveSelection,
  type ProviderKind,
} from './provider-readiness.derive';

const FOLLOW_UP_DELAY_MS = 5_000;
const MAX_FOLLOW_UPS = 2;

@Injectable({ providedIn: 'root' })
export class ProviderReadinessStore {
  private readonly providers = inject(ProvidersSettingsStateService);
  private readonly ambient = inject(ClaudeAmbientStatusService);
  private readonly codexService = inject(CodexReadinessService);
  private readonly auth = inject(AuthStateService);
  readonly available = inject(VSCodeService).isElectron;
  private readonly claudeRetrying = signal(false);
  private readonly codexRetrying = signal(false);
  private readonly activeRechecks = signal(0);
  private readonly notConfirmed = signal(false);
  private readonly _slowStarted = signal<{ provider: ProviderKind; mountId: number } | null>(null);
  private mountId = 0;
  private destroyed = false;
  private readonly pendingTimers = new Map<ProviderKind, { id: ReturnType<typeof setTimeout>; cancel: () => void }>();
  private readonly cycles = new Map<ProviderKind, Promise<void>>();
  private readonly epochs = new Map<ProviderKind, number>();
  private mountPromise: Promise<void> | null = null;

  readonly claude = computed(() => deriveClaudeReadiness({
    detection: this.providers.cliDetection(),
    ambient: this.ambient.view(),
    retrying: this.claudeRetrying(),
  }));
  readonly codex = computed(() => deriveCodexReadiness(this.codexService.view(), this.codexRetrying()));
  readonly selection = computed(() => this.notConfirmed() ? { kind: 'not-confirmed' as const } :
    deriveSelection({
      isLoading: this.auth.isLoading(),
      isLoaded: this.auth.isLoaded(),
      authMethod: this.auth.persistedAuthMethod(),
      providerId: this.auth.persistedProviderId(),
      availableProviders: this.auth.availableProviders(),
    }));
  readonly chosen = computed(() => deriveChosen(this.selection(), this.claude(), this.codex()));
  readonly rechecking = computed(() => this.activeRechecks() > 0);
  readonly slowStarted = this._slowStarted.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      for (const timer of this.pendingTimers.values()) timer.cancel();
      this.pendingTimers.clear();
    });
  }

  markSelectionNotConfirmed(): void {
    this.notConfirmed.set(true);
  }

  async retrySelection(): Promise<boolean> {
    if (!this.available || this.destroyed) return false;
    try {
      await this.auth.refreshAuthStatus();
      if (!this.auth.isLoaded()) return false;
      this.notConfirmed.set(false);
      return true;
    } catch {
      return false;
    }
  }

  refresh(kind: 'mount' | 'recheck'): Promise<void> {
    if (!this.available || this.destroyed) return Promise.resolve();
    if (kind === 'mount') {
      if (this.mountPromise) return this.mountPromise;
      const id = ++this.mountId;
      this.mountPromise = Promise.all([
        this.start('claude-cli', 'mount', id),
        this.start('openai-codex', 'mount', id),
      ]).then(() => undefined);
      return this.mountPromise;
    }
    return this.recheckBoth();
  }

  recheckCodex(): Promise<void> {
    if (!this.available || this.destroyed) return Promise.resolve();
    return this.start('openai-codex', 'recheck', ++this.mountId);
  }

  private async recheckBoth(): Promise<void> {
    if (this.selection().kind === 'unreadable' || this.selection().kind === 'not-confirmed') {
      await this.retrySelection();
    }
    await Promise.all([
      this.start('claude-cli', 'recheck', ++this.mountId),
      this.start('openai-codex', 'recheck', ++this.mountId),
    ]);
  }

  private start(provider: ProviderKind, kind: 'mount' | 'recheck', mountId: number): Promise<void> {
    const active = this.cycles.get(provider);
    if (kind === 'mount' && active) return active;
    this.pendingTimers.get(provider)?.cancel();
    const retrying = provider === 'claude-cli' ? this.claudeRetrying : this.codexRetrying;
    const epoch = (this.epochs.get(provider) ?? 0) + 1;
    this.epochs.set(provider, epoch);
    retrying.set(false);
    if (kind === 'recheck') this.activeRechecks.update((count) => count + 1);
    const cycle = this.run(provider, kind, mountId, epoch).catch(() => {
      // Core services normally absorb failures. A rejected read affects only this provider.
    }).finally(() => {
      retrying.set(false);
      if (kind === 'recheck') this.activeRechecks.update((count) => count - 1);
      if (this.cycles.get(provider) === cycle) this.cycles.delete(provider);
    });
    this.cycles.set(provider, cycle);
    return cycle;
  }

  private async run(provider: ProviderKind, kind: 'mount' | 'recheck', mountId: number, epoch: number): Promise<void> {
    const retrying = provider === 'claude-cli' ? this.claudeRetrying : this.codexRetrying;
    for (let attempt = 0; attempt <= (kind === 'mount' ? MAX_FOLLOW_UPS : 0); attempt++) {
      if (this.destroyed || this.epochs.get(provider) !== epoch) return;
      if (attempt === 0 && provider === 'claude-cli') {
        await Promise.all([
          this.providers.redetectClis(),
          this.ambient.read(kind === 'recheck', kind),
        ]);
      } else if (provider === 'claude-cli') {
        await this.ambient.read(true, 'follow-up');
      } else {
        await this.codexService.read(kind === 'recheck' || attempt > 0,
          attempt > 0 ? 'follow-up' : kind);
      }
      if (this.destroyed || this.epochs.get(provider) !== epoch) return;
      const state = provider === 'claude-cli' ? this.claude() : this.codex();
      if (kind === 'recheck' || state.errorCause !== 'timeout' || attempt === MAX_FOLLOW_UPS) return;
      retrying.set(true);
      if (attempt === 0) this._slowStarted.set({ provider, mountId });
      const continued = await this.delay(provider);
      if (!continued || this.epochs.get(provider) !== epoch) return;
      retrying.set(false);
    }
  }

  private delay(provider: ProviderKind): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const cancel = () => { clearTimeout(id); this.pendingTimers.delete(provider); resolve(false); };
      const id = setTimeout(() => { this.pendingTimers.delete(provider); resolve(true); }, FOLLOW_UP_DELAY_MS);
      this.pendingTimers.set(provider, { id, cancel });
    });
  }
}
