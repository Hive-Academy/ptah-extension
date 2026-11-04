import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import { OperatorSettingsSchema, ReviewRpcSchemas, ReviewStateSchema, type OperatorSettings, type RepositorySettings, type ReviewRun } from '@ptah-extension/review-contracts';
import { z } from 'zod';
import type { RpcMethodParams } from '@ptah-extension/shared';

export type ReviewListState = 'loading' | 'ready' | 'offline' | 'error' | 'no-lanes';
export type ReviewStateFilter = 'all' | z.infer<typeof ReviewStateSchema>;
/** Allows several 15-second GitHub GET attempts plus per-pull base-config reads. */
const REVIEW_REFRESH_TIMEOUT_MS = 120_000;
const botIdentitySchema = z.object({ login: z.string(), scopes: z.array(z.string()), connectedAt: z.string(), verifiedAt: z.string().nullable(), tokenStorage: z.enum(['encrypted', 'plaintext']) }).nullable();
export type ReviewBotIdentity = z.infer<typeof botIdentitySchema>;
const defaultSettings: OperatorSettings = {
  repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: false, dryRun: true, publicationPaused: false }],
  maintainerLogins: [], pollMinutes: 10, globalPublicationPaused: false, laneCapPerPr: 6,
  confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [],
};

@Injectable({ providedIn: 'root' })
export class ReviewRunsStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  readonly runs = signal<ReviewRun[]>([]);
  readonly poll = signal<{ status: 'succeeded' | 'failed' | null; error: string | null;
    lastSuccessAt: string | null; lastErrorAt: string | null } | null>(null);
  readonly repositories = signal<RepositorySettings[]>([]);
  readonly state = signal<ReviewListState>('loading');
  readonly repoFilter = signal<string>('all');
  readonly stateFilter = signal<ReviewStateFilter>('all');
  readonly lastRefreshedAt = signal<Date | null>(null);
  readonly selectedAttemptId = signal<string | null>(null);
  readonly selectedRun = signal<ReviewRun | null>(null);
  readonly detailState = signal<'loading' | 'ready' | 'error'>('ready');
  readonly settings = signal<OperatorSettings | null>(null);
  readonly draftSettings = signal<OperatorSettings>(defaultSettings);
  readonly hasToken = signal(false);
  readonly tokenStorage = signal<'encrypted' | 'plaintext'>('encrypted');
  readonly liveAttested = signal(false);
  readonly attestorLogin = signal('');
  readonly botIdentity = signal<ReviewBotIdentity>(null);
  readonly credentialState = signal<'idle' | 'saving' | 'error'>('idle');
  readonly rerunState = signal<'idle' | 'running' | 'error'>('idle');
  readonly settingsSaving = signal(false);
  readonly settingsSaveError = signal<string | null>(null);
  readonly settingsState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly pauseSaving = signal(false);
  readonly pauseError = signal(false);
  readonly refreshError = signal(false);
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
      this.poll.set(runs.poll);
      this.lastRefreshedAt.set(new Date());
      this.state.set('ready');
    } catch {
      this.state.set(this.hasCache() ? 'offline' : 'error');
    } finally {
      this.isRefreshing.set(false);
    }
  }

  async refresh(): Promise<void> {
    if (this.isRefreshing()) return;
    this.isRefreshing.set(true);
    this.refreshError.set(false);
    try {
      const repo = this.repositories()[0] ?? this.settings()?.repositories[0] ?? defaultSettings.repositories[0];
      const result = await this.request('review:refresh',
        ReviewRpcSchemas['review:refresh'].params.parse({ repo: { owner: repo.owner, name: repo.name } }),
        ReviewRpcSchemas['review:refresh'].result);
      if (!result.ok) throw new Error('Review poll failed');
      await this.load();
    } catch {
      // The host may finish after the RPC timeout. Reload its latest poll state.
      this.refreshError.set(true);
      await this.load();
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
      this.draftSettings.set(response.settings ?? defaultSettings);
      this.hasToken.set(response.hasToken);
      this.tokenStorage.set(response.tokenStorage);
      this.settingsState.set('ready');
      await this.loadBotIdentity();
    } catch { this.settingsState.set('error'); }
  }
  async loadBotIdentity(): Promise<void> {
    try { this.botIdentity.set(await this.request('review:getBotIdentity', {}, botIdentitySchema)); }
    catch { this.botIdentity.set(null); }
  }
  async setBotToken(token: string): Promise<boolean> {
    if (!token.trim() || this.credentialState() === 'saving') return false;
    this.credentialState.set('saving');
    try {
      await this.request('review:setBotToken', { token }, z.object({ ok: z.literal(true) }));
      this.hasToken.set(true);
      this.liveAttested.set(false);
      await this.loadBotIdentity();
      this.credentialState.set('idle');
      return true;
    } catch {
      // degradation-audit: reported — credentialState 'error' shows the failure in the drawer.
      this.credentialState.set('error');
      return false;
    }
  }
  async clearBotToken(): Promise<void> {
    this.credentialState.set('saving');
    try {
      await this.request('review:clearBotToken', {}, z.object({ ok: z.literal(true) }));
      this.hasToken.set(false); this.botIdentity.set(null); this.credentialState.set('idle');
      this.liveAttested.set(false);
    } catch { this.credentialState.set('error'); }
  }
  async rerun(attemptId: string, dryRun: boolean): Promise<void> {
    this.rerunState.set('running');
    try {
      await this.request('review:rerun', { attemptId, dryRun }, z.object({ attemptId: z.string() }));
      await this.load();
      this.rerunState.set('idle');
    } catch { this.rerunState.set('error'); }
  }
  updateDraft(patch: Partial<OperatorSettings>): void {
    this.draftSettings.update((current) => ({ ...current, ...patch }));
  }
  setRepositoryEnabled(enabled: boolean): void {
    this.draftSettings.update((current) => ({ ...current, repositories: current.repositories.map((repo) => ({ ...repo, enabled })) }));
  }
  async saveSettings(): Promise<void> {
    if (this.settingsSaving()) return;
    const parsed = OperatorSettingsSchema.safeParse(this.draftSettings());
    if (!parsed.success) { this.settingsSaveError.set('Enter a maintainer login and valid review limits.'); return; }
    this.settingsSaving.set(true);
    this.settingsSaveError.set(null);
    try {
      const saved = await this.request('review:updateSettings',
        ReviewRpcSchemas['review:updateSettings'].params.parse({ settings: parsed.data,
          attestation: this.liveAttested() && this.botIdentity() ? { who: (this.attestorLogin().trim() || parsed.data.maintainerLogins[0] || ''),
            permissions: ['Pull requests: Read and write', 'Contents: Read', 'Metadata: Read'] } : undefined }),
        ReviewRpcSchemas['review:updateSettings'].result);
      this.settings.set(saved);
      this.draftSettings.set(saved);
      this.repositories.set(saved.repositories);
      this.liveAttested.set(false);
    } catch { this.settingsSaveError.set('Review settings could not be saved.'); }
    finally { this.settingsSaving.set(false); }
  }
  async setPublicationPause(paused: boolean, confirmed = false): Promise<void> {
    if (!paused && !confirmed) return;
    if (!this.settings() || this.pauseSaving()) return;
    this.pauseSaving.set(true);
    this.pauseError.set(false);
    try {
      const result = await this.request('review:setPublicationPause',
        ReviewRpcSchemas['review:setPublicationPause'].params.parse({ paused }),
        ReviewRpcSchemas['review:setPublicationPause'].result);
      if (!result.ok) throw new Error('Publication pause update failed');
      this.settings.update((current) => current ? { ...current, globalPublicationPaused: paused } : current);
    } catch (error: unknown) {
      this.logger.error('ReviewRunsStore', 'Publication pause update failed', error);
      this.pauseError.set(true);
    }
    finally { this.pauseSaving.set(false); }
  }
  /** Integration may report lane availability independently of the list RPC. */
  setNoLanesAvailable(): void { this.state.set('no-lanes'); }

  private async request<M extends 'review:listRepositories' | 'review:listRuns' | 'review:getRun' | 'review:getSettings' | 'review:updateSettings' | 'review:setPublicationPause' | 'review:refresh' | 'review:getBotIdentity' | 'review:setBotToken' | 'review:clearBotToken' | 'review:rerun', T = unknown>(method: M, params: RpcMethodParams<M>, schema: z.ZodType<T>): Promise<T> {
    const response = await this.rpc.call(method, params,
      { timeout: method === 'review:refresh' ? REVIEW_REFRESH_TIMEOUT_MS : 5_000 });
    if (!response.isSuccess()) throw new Error('Review data is unavailable');
    return schema.parse(response.data);
  }
}

