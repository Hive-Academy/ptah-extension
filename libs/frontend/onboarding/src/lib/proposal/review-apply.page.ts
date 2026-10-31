import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { AppStateManager } from '@ptah-extension/core';
import { BuilderApplySectionComponent } from '@ptah-extension/harness-builder';
import {
  mergeHarnessConfigUpdates,
  type HarnessApplyResponse,
  type HarnessConfig,
} from '@ptah-extension/shared';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import {
  OnboardingStepperComponent,
  type OnboardingStep,
} from '../shared/onboarding-stepper.component';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import { ApplyResultComponent } from './apply-result.component';
import {
  diffHarnessConfig,
  ProposalFlowStore,
  type ChangeTag,
} from './proposal-flow.store';
import { ReviewSummaryComponent } from './review-summary.component';

@Component({
  selector: 'ptah-review-apply-page',
  standalone: true,
  imports: [
    BuilderApplySectionComponent,
    ReviewSummaryComponent,
    ApplyResultComponent,
    OnboardingStepperComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section
    class="mx-auto max-w-[960px] space-y-5 p-4"
    aria-labelledby="review-apply-title"
    data-testid="review-apply"
  >
    <header>
      <h1 id="review-apply-title" class="text-2xl font-semibold" tabindex="-1">
        Review and apply
      </h1>
      <p class="text-sm text-base-content-muted">
        Review the configuration before writing it to your workspace.
      </p>
    </header>
    <ptah-onboarding-stepper [steps]="steps" />
    @if (store.restoreState() === 'loading') {
      <p role="status">Loading review…</p>
    } @else if (reviewed(); as revision) {
      @if (newer(); as later) {
        <div
          class="rounded-[14px] border border-state-need p-4"
          role="status"
          data-testid="newer-revision-banner"
        >
          <p>
            Revision {{ later.ordinal }} is available. You are reviewing
            revision {{ revision.ordinal }}.
          </p>
          <button
            type="button"
            class="btn btn-sm mt-2"
            [disabled]="pendingRevisionId() !== null"
            (click)="updateReview()"
          >
            Update review
          </button>
        </div>
      }
      @if (store.session.record()?.appliedRevisionId; as appliedId) {
        <p class="text-sm">
          Changes since applied revision {{ appliedOrdinal(appliedId) }} · Apply
          again
        </p>
      }
      <ptah-review-summary
        [config]="reviewedConfig()"
        [tags]="tags()"
        [ordinal]="revision.ordinal"
        [previousOrdinal]="revision.ordinal - 1"
        [complete]="revision.isConfigComplete"
        [mode]="store.mode"
        [tabId]="store.session.record()?.tabId ?? ''"
        [workspaceRoot]="store.workspaceRoot()"
        [showIntakeFacts]="showIntakeFacts()"
        [document]="store.generatedDocument()"
        (copyDocument)="copy($event)"
      />
      @if (!revision.isConfigComplete) {
        <p
          class="rounded-[10px] border border-state-need p-3 text-sm"
          data-testid="incomplete-note"
        >
          The agent has not marked this complete. You are applying revision
          {{ revision.ordinal }}.
        </p>
      }
      <div
        class="rounded-[22px] border border-base-300 p-4"
        data-glass-surface="content"
      >
        <ptah-builder-apply-section
          [initialized]="true"
          [workspaceRoot]="store.session.record()?.workspacePath ?? ''"
          [agentBusy]="busy()"
          [config]="reviewedConfig()"
          [document]="store.generatedDocument()"
          (applyStarted)="captureApplyStart()"
          (applied)="onApplied($event)"
          (applyFailed)="onApplyFailed()"
          (openDashboard)="openDashboard()"
        />
      </div>
      @if (visibleReceipt(); as receipt) {
        <ptah-apply-result
          [receipt]="receipt"
          [showDetails]="!appliedThisPage()"
          (openChat)="openChat()"
          (openDashboard)="openDashboard()"
          (done)="done()"
        />
      } @else if (store.session.record()?.applyReceipt; as oldReceipt) {
        <p role="status">
          Applied revision {{ appliedOrdinal(oldReceipt.revisionId) }};
          reviewing revision {{ revision.ordinal }}.
        </p>
      }
      @if (appliedWithoutReceipt()) {
        <button type="button" class="btn btn-primary btn-sm" (click)="done()">
          Done
        </button>
      }
      @if (store.session.error(); as error) {
        <p role="alert" class="text-sm text-state-err">{{ error }}</p>
      }
      @if (store.actionError(); as error) {
        <p role="alert" class="text-sm text-state-err">{{ error }}</p>
      }
      <button type="button" class="btn btn-sm" (click)="back()">
        Back to proposal
      </button>
    } @else {
      <section
        class="rounded-[22px] border border-base-300 p-5"
        data-glass-surface="content"
      >
        <h2 class="font-semibold">Review unavailable</h2>
        <p class="text-sm">The selected revision could not be loaded.</p>
        <button type="button" class="btn btn-sm mt-2" (click)="back()">
          Back to proposal
        </button>
      </section>
    }
  </section>`,
})
export class ReviewApplyPage implements OnInit {
  protected readonly store = inject(ProposalFlowStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly flags = inject(OnboardingFlagService);
  private readonly appState = inject(AppStateManager);
  protected readonly steps: readonly OnboardingStep[] = [
    { id: 'brief', label: 'Brief', state: 'completed' },
    { id: 'proposal', label: 'Proposal', state: 'completed' },
    { id: 'review', label: 'Review', state: 'current' },
  ];
  readonly reviewedId = signal<string | null>(null);
  readonly pendingRevisionId = signal<string | null>(null);
  readonly appliedWithoutReceipt = signal(false);
  readonly appliedThisPage = signal(false);
  private routeTab: string | null = null;
  private routeRequest = 0;
  private restoreQueue = Promise.resolve();
  readonly reviewed = computed(
    () =>
      this.store.revisions().find((item) => item.id === this.reviewedId()) ??
      null,
  );
  readonly visibleReceipt = computed(() => {
    const receipt = this.store.session.record()?.applyReceipt;
    return receipt?.revisionId === this.reviewedId() ? receipt : null;
  });
  readonly reviewedConfig = computed<Partial<HarnessConfig>>(() => {
    const revision = this.reviewed();
    if (!revision) return {};
    const record = this.store.session.record();
    if (!record) return revision.config;
    const snapshot = this.store.records.readSnapshot(
      record.workspacePath,
      record.tabId,
    );
    return snapshot
      ? mergeHarnessConfigUpdates(revision.config, snapshot.configUpdates)
      : revision.config;
  });
  readonly newer = computed(() => {
    const current = this.store.current();
    const viewed = this.reviewed();
    return current && viewed && current.ordinal > viewed.ordinal
      ? current
      : null;
  });
  readonly tags = computed(() => {
    const revision = this.reviewed();
    if (!revision) return new Map<string, ChangeTag>();
    const prior = this.store
      .revisions()
      .find((item) => item.ordinal === revision.ordinal - 1);
    return prior
      ? diffHarnessConfig(prior.config, revision.config)
      : new Map<string, ChangeTag>();
  });
  readonly busy = () =>
    ['busy', 'sending', 'cancelling'].includes(this.store.session.phase());
  ngOnInit(): void {
    const subscription = this.route.queryParamMap
      .pipe(
        map((params) => ({ tab: params.get('tab'), rev: params.get('rev') })),
        distinctUntilChanged((a, b) => a.tab === b.tab && a.rev === b.rev),
      )
      .subscribe(({ tab, rev }) => {
        const request = ++this.routeRequest;
        if (!tab) {
          this.routeTab = null;
          this.reviewedId.set(null);
          this.store.restoreState.set('missing');
          return;
        }
        if (tab === this.routeTab) {
          this.reviewedId.set(rev ?? this.store.current()?.id ?? null);
          return;
        }
        this.routeTab = tab;
        this.appliedThisPage.set(false);
        this.appliedWithoutReceipt.set(false);
        this.pendingRevisionId.set(null);
        this.restoreQueue = this.restoreQueue.then(async () => {
          if (this.routeTab !== tab) return;
          try {
            await this.store.restore(tab);
            if (!this.destroyRef.destroyed && request === this.routeRequest)
              this.reviewedId.set(rev ?? this.store.current()?.id ?? null);
          } catch {
            if (!this.destroyRef.destroyed) {
              this.store.restoreState.set('proposal-unavailable');
              this.store.actionError.set(
                'Could not restore this review. Try again.',
              );
            }
          }
        });
      });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }
  readonly showIntakeFacts = () =>
    this.store.mode === 'new-project' &&
    !!this.store.records.readStackProfile(
      this.store.workspaceRoot(),
      this.store.session.record()?.tabId ?? '',
    );
  appliedOrdinal(id: string): number {
    return this.store.revisions().find((item) => item.id === id)?.ordinal ?? 0;
  }
  async updateReview(): Promise<void> {
    const current = this.store.current();
    if (!current || this.pendingRevisionId()) return;
    this.reviewedId.set(current.id);
    this.appliedWithoutReceipt.set(false);
    const record = this.store.session.record();
    if (record) {
      const link = onboardingStepLink(
        this.store.mode === 'new-project'
          ? 'new-project-review'
          : 'team-builder-review',
        this.store.mode === 'new-project'
          ? 'new-project-review'
          : 'team-builder-review',
        { tab: record.tabId, rev: current.id },
      );
      await this.router.navigate([...link.commands], {
        queryParams: link.queryParams,
        replaceUrl: true,
      });
    }
  }
  captureApplyStart(): void {
    this.pendingRevisionId.set(this.reviewedId());
  }
  onApplyFailed(): void {
    this.pendingRevisionId.set(null);
  }
  onApplied(response: HarnessApplyResponse): void {
    const revisionId = this.pendingRevisionId() ?? this.reviewedId();
    this.pendingRevisionId.set(null);
    if (!revisionId) return;
    this.appliedThisPage.set(true);
    this.store.session.recordApply({
      revisionId,
      appliedPaths: response.appliedPaths,
      warnings: response.warnings,
      appliedAt: new Date().toISOString(),
    });
    this.appliedWithoutReceipt.set(
      !this.store.session.record()?.applyReceipt ||
        !!this.store.session.error(),
    );
  }
  async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      this.store.actionError.set('Could not copy the document.');
    }
  }
  async back(): Promise<void> {
    const record = this.store.session.record();
    const from =
      this.store.mode === 'new-project'
        ? 'new-project-review'
        : 'team-builder-review';
    const to =
      this.store.mode === 'new-project'
        ? 'new-project-workspace'
        : 'team-builder-workspace';
    const link = onboardingStepLink(from, to, { tab: record?.tabId });
    await this.router.navigate([...link.commands], {
      queryParams: link.queryParams,
    });
  }
  openChat(): void {
    this.appState.setCurrentView('chat');
  }
  openDashboard(): void {
    this.appState.setCurrentView('marketplace');
  }
  async done(): Promise<void> {
    this.flags.markCompleted();
    await this.router.navigate(['/onboarding']);
  }
}
