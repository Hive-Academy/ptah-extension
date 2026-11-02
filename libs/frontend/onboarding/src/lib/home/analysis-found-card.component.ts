import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LoggingService } from '@ptah-extension/core';
import type { AnalysisStatus } from '@ptah-extension/shared';
import { WizardRpcService } from '@ptah-extension/setup-wizard';
import { AnalysisStepStore } from '../analyze/analysis-step.store';
import { OnboardingWorkspaceStore } from '../shell/onboarding-workspace.store';

export type AnalysisAgeBucket = 'success' | 'warning' | 'error';

/** Age is informational; freshness is determined by the backend fingerprint. */
export function analysisAge(analyzedAt: string | null, now = Date.now()): {
  days: number;
  label: string;
  bucket: AnalysisAgeBucket;
} | null {
  if (!analyzedAt) return null;
  const timestamp = Date.parse(analyzedAt);
  if (!Number.isFinite(timestamp)) return null;
  const days = Math.max(0, Math.floor((now - timestamp) / 86_400_000));
  return {
    days,
    label: days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`,
    bucket: days <= 7 ? 'success' : days <= 30 ? 'warning' : 'error',
  };
}

@Component({
  selector: 'ptah-analysis-found-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status(); as result) {
      <section class="mt-5 rounded-xl border border-base-300 bg-base-200 p-4" aria-label="Analysis found" data-testid="analysis-found-card">
        <h2 class="font-semibold">Analysis found · {{ result.state }} ({{ reason() }})</h2>
        @if (age(); as value) {
          <p class="mt-1 text-sm" [class.text-success]="value.bucket === 'success'" [class.text-warning]="value.bucket === 'warning'" [class.text-error]="value.bucket === 'error'">
            Analysed {{ value.label }}@if (value.bucket !== 'success') { · consider re-running }<span class="sr-only">. {{ value.bucket === 'success' ? 'Recent analysis' : 'Older analysis' }}</span>
          </p>
        }
        @if (result.sharing === 'ignored-by-gitignore') {
          <p class="mt-2 text-sm">Your .gitignore ignores .ptah, so this analysis won't be shared through git. To share it, ignore the contents instead of the folder: change <code>.ptah/</code> to <code>.ptah/*</code>, then add <code>!.ptah/analysis/</code>.</p>
        }
        @if (error()) { <p class="mt-2 text-sm text-error" role="alert">{{ error() }}</p> }
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || !result.analysisDir" (click)="useIt()">Use it</button>
          <button type="button" class="btn btn-outline btn-sm" (click)="rerun()">Re-run</button>
        </div>
      </section>
    }
    @if (unavailable()) {
      <div class="mt-5 rounded-xl border border-error bg-base-200 p-4 text-sm" role="alert">
        <p>Could not check for a saved analysis.</p>
        <button type="button" class="btn btn-outline btn-sm mt-2" (click)="retry()">Retry</button>
      </div>
    }
  `,
})
export class AnalysisFoundCardComponent {
  private readonly rpc = inject(WizardRpcService);
  private readonly analysis = inject(AnalysisStepStore);
  private readonly workspace = inject(OnboardingWorkspaceStore);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);
  private readonly statusValue = signal<AnalysisStatus | null>(null);
  protected readonly status = this.statusValue.asReadonly();
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly unavailable = signal(false);
  protected readonly age = computed(() => analysisAge(this.status()?.analyzedAt ?? null));
  protected readonly reason = computed(() => this.status()?.reason.replaceAll('-', ' ') ?? '');
  private request = 0;

  constructor() {
    effect(() => {
      const path = this.workspace.activePath();
      const request = ++this.request;
      this.statusValue.set(null);
      this.error.set(null);
      this.unavailable.set(false);
      this.busy.set(false);
      if (path && this.workspace.readyForActivePath()) void this.refresh(request, path);
    });
  }

  private async refresh(request: number, path: string): Promise<void> {
    try {
      const status = await this.rpc.getAnalysisStatus();
      if (!this.currentRequest(request, path)) return;
      this.statusValue.set(status.state === 'missing' ? null : status);
    } catch (error) {
      // degradation-audit: reported — the card shows a retry button and logs the failure.
      if (!this.currentRequest(request, path)) return;
      this.logger.warn('AnalysisFoundCard', 'Could not check saved analysis', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.unavailable.set(true);
    }
  }

  private currentRequest(request: number, path: string): boolean {
    return request === this.request && this.workspace.activePath() === path && this.workspace.readyForActivePath();
  }

  protected retry(): void {
    const path = this.workspace.activePath();
    if (!path || !this.workspace.readyForActivePath()) return;
    this.unavailable.set(false);
    this.statusValue.set(null);
    void this.refresh(++this.request, path);
  }

  protected async useIt(): Promise<void> {
    const path = this.status()?.analysisDir;
    const slug = path?.split('/').filter(Boolean).at(-1);
    if (!slug || this.busy() || !this.workspace.readyForActivePath()) return;
    const workspacePath = this.workspace.activePath();
    const request = this.request;
    this.busy.set(true);
    const result = await this.analysis.useAnalysis(slug);
    if (!workspacePath || !this.currentRequest(request, workspacePath)) return;
    this.busy.set(false);
    if (result === 'loaded') {
      void this.router.navigate(['/onboarding', 'analyze', 'done']);
    } else {
      this.error.set('Could not load this analysis. Please try again.');
    }
  }

  protected rerun(): void {
    if (!this.workspace.readyForActivePath()) return;
    this.analysis.clearSelection();
    void this.router.navigate(['/onboarding', 'analyze'], { queryParams: { rerun: '1' } });
  }
}
