import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthStateService, ClaudeRpcService } from '@ptah-extension/core';
import type { ProviderGetAccountUsageResult } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class ProviderAccountStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly auth = inject(AuthStateService);
  private readonly _result = signal<ProviderGetAccountUsageResult | null>(null);
  private readonly _loading = signal(false);
  private loadGeneration = 0;
  private activeProviderId: string | null = null;
  readonly result = this._result.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly providerId = computed(() => this.auth.persistedProviderId());
  readonly isCodex = computed(() => this.providerId() === 'openai-codex');

  activateProvider(providerId: string): void {
    if (providerId === this.activeProviderId) return;
    this.activeProviderId = providerId;
    ++this.loadGeneration;
    this._result.set(null);
    this._loading.set(false);
    if (providerId === 'openai-codex') void this.load();
  }

  async load(refresh = false): Promise<void> {
    if (this._loading()) return;
    const generation = ++this.loadGeneration;
    const providerId = this.auth.persistedProviderId();
    this._loading.set(true);
    try {
      const response = await this.rpc.call('provider:getAccountUsage', {
        providerId, refresh,
      });
      if (generation !== this.loadGeneration || providerId !== this.auth.persistedProviderId()) return;
      this._result.set(response.isSuccess() && response.data
        ? response.data
        : { status: 'service-unavailable', providerId });
    } finally {
      if (generation === this.loadGeneration) this._loading.set(false);
    }
  }
}
