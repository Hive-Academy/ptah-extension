import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { ReviewRpcSchemas, ReviewStateSchema, type OperatorSettings, type RepositorySettings, type ReviewRun } from '@ptah-extension/review-contracts';
import type { z } from 'zod';

export type ReviewListState = 'loading' | 'ready' | 'offline' | 'error' | 'no-lanes';
export type ReviewStateFilter = 'all' | z.infer<typeof ReviewStateSchema>;

@Injectable({ providedIn: 'root' })
export class ReviewRunsStore {
  private readonly rpc = inject(ClaudeRpcService);
  readonly runs = signal<ReviewRun[]>([]);
  readonly repositories = signal<RepositorySettings[]>([]);
  readonly state = signal<ReviewListState>('loading');
  readonly repoFilter = signal<string>('all');
  readonly stateFilter = signal<ReviewStateFilter>('all');
  readonly lastRefreshedAt = signal<Date | null>(null);
  readonly selectedAttemptId = signal<string | null>(null);
  readonly selectedRun = signal<ReviewRun | null>(null);
  readonly detailState = signal<'loading' | 'ready' | 'error'>('ready');
  readonly settings = signal<OperatorSettings | null>(null);
  readonly settingsState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly isRefreshing = signal(false);
  readonly hasCache = computed(() => this.lastRefreshedAt() !== null);
  readonly filteredRuns = computed(() => this.runs().filter((run) =>
    (this.repoFilter() === 'all' || `${run.repo.owner}/${run.repo.name}` === this.repoFilter()) &&
    (this.stateFilter() === 'all' || run.status === this.stateFilter()),
  ));
  readonly queuedCount = computed(() => this.runs().filter((run) => run.status === 'queued').length);

  async load(): Promise<void> {
    this.isRefreshing.set(true);
    if (!this.hasCache()) this.state.set('loading');
    try {
      const [repositories, runs] = await Promise.all([
        this.request('review:listRepositories', ReviewRpcSchemas['review:listRepositories'].params.parse({}), ReviewRpcSchemas['review:listRepositories'].result),
        this.request('review:listRuns', ReviewRpcSchemas['review:listRuns'].params.parse({ limit: 100 }), ReviewRpcSchemas['review:listRuns'].result),
      ]);
      this.repositories.set(repositories);
      this.runs.set(runs.runs);
      this.lastRefreshedAt.set(new Date());
      this.state.set('ready');
    } catch {
      this.state.set(this.hasCache() ? 'offline' : 'error');
    } finally {
      this.isRefreshing.set(false);
    }
  }

  setRepoFilter(repo: string): void { this.repoFilter.set(repo); }
  setStateFilter(state: ReviewStateFilter): void { this.stateFilter.set(state); }
  clearFilters(): void { this.repoFilter.set('all'); this.stateFilter.set('all'); }
  selectRun(attemptId: string): void {
    this.selectedAttemptId.set(attemptId);
    this.selectedRun.set(this.runs().find(run => run.attemptId === attemptId) ?? null);
    void this.loadRun(attemptId);
  }
  closeRun(): void { this.selectedAttemptId.set(null); this.selectedRun.set(null); }
  async loadRun(attemptId: string): Promise<void> {
    this.detailState.set('loading');
    try {
      const run = await this.request('review:getRun', ReviewRpcSchemas['review:getRun'].params.parse({ attemptId }), ReviewRpcSchemas['review:getRun'].result);
      if (this.selectedAttemptId() !== attemptId) return;
      if (run === null) { this.detailState.set('error'); return; }
      this.selectedRun.set(run); this.detailState.set('ready');
    } catch { if (this.selectedAttemptId() === attemptId) this.detailState.set('error'); }
  }
  async loadSettings(): Promise<void> {
    this.settingsState.set('loading');
    try {
      const response = await this.request('review:getSettings', ReviewRpcSchemas['review:getSettings'].params.parse({}), ReviewRpcSchemas['review:getSettings'].result);
      this.settings.set(response.settings);
      this.settingsState.set('ready');
    } catch { this.settingsState.set('error'); }
  }
  /** Integration may report lane availability independently of the list RPC. */
  setNoLanesAvailable(): void { this.state.set('no-lanes'); }

  private async request<T>(method: 'review:listRepositories' | 'review:listRuns' | 'review:getRun' | 'review:getSettings', params: object, schema: z.ZodType<T>): Promise<T> {
    // P1-16 adds review methods to the shared RPC method union. Parse results meanwhile.
    const call = this.rpc.call as (method: string, params: object, options: { timeout: number }) => Promise<{ isSuccess(): boolean; data: unknown }>;
    const response = await call.call(this.rpc, method, params, { timeout: 5_000 });
    if (!response.isSuccess()) throw new Error('Review data is unavailable');
    return schema.parse(response.data);
  }
}
