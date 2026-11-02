import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  BuilderAiHelpersSectionComponent,
  BuilderPresetsSectionComponent,
  HarnessBuilderLeaveDialogComponent,
  formatIntakeSummary,
} from '@ptah-extension/harness-builder';
import { DetailsLogComponent } from '../shared/details-log.component';
import {
  OnboardingStepperComponent,
  type OnboardingStep,
} from '../shared/onboarding-stepper.component';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import { AnswerDockComponent } from './answer-dock.component';
import { ProposalFlowStore } from './proposal-flow.store';
import { ProposalPanelComponent } from './proposal-panel.component';
import { RevisionHistoryComponent } from './revision-history.component';

@Component({
  selector: 'ptah-proposal-workspace-page',
  standalone: true,
  imports: [
    ProposalPanelComponent,
    AnswerDockComponent,
    RevisionHistoryComponent,
    BuilderAiHelpersSectionComponent,
    BuilderPresetsSectionComponent,
    HarnessBuilderLeaveDialogComponent,
    DetailsLogComponent,
    OnboardingStepperComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto max-w-[1120px] space-y-5 p-4 pb-24 min-[721px]:pb-4"
      aria-labelledby="proposal-workspace-title"
      data-testid="proposal-workspace"
    >
      <header
        #pageHeader
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <h1
            id="proposal-workspace-title"
            class="text-2xl font-semibold"
            tabindex="-1"
          >
            {{
              store.mode === 'new-project'
                ? 'New project proposal'
                : 'AI team proposal'
            }}
          </h1>
          <p class="text-sm text-base-content-muted">
            Review the agent's configuration as it develops.
          </p>
        </div>
        <button type="button" class="btn btn-sm" (click)="beginLeave()">
          Leave
        </button>
      </header>
      <div #stepperRegion><ptah-onboarding-stepper [steps]="steps" /></div>
      <div class="grid gap-5 min-[861px]:grid-cols-[minmax(0,1fr)_300px]">
        <div
          #main
          class="min-w-0 space-y-5 min-[861px]:col-start-1 min-[861px]:row-start-1"
        >
          @if (store.restoreState() === 'loading') {
            <p role="status">Loading proposal…</p>
          } @else if (store.restoreState() !== 'ready') {
            <section
              class="rounded-[22px] border border-base-300 p-5"
              data-glass-surface="content"
            >
              <h2 class="font-semibold">Proposal unavailable</h2>
              <p class="mt-2 text-sm">{{ recoveryCopy() }}</p>
              <div class="mt-3 flex gap-2">
                @if (store.restoreState() === 'restore-draft') {
                  <button
                    type="button"
                    class="btn btn-sm"
                    (click)="restoreDraft()"
                  >
                    Restore from draft
                  </button>
                }
                @if (
                  store.restoreState() === 'proposal-unavailable' &&
                  store.session.record()
                ) {
                  <button
                    type="button"
                    class="btn btn-sm"
                    (click)="proposeAgain()"
                  >
                    Propose again
                  </button>
                }
                <button type="button" class="btn btn-sm" (click)="startOver()">
                  Start over
                </button>
              </div>
            </section>
          } @else {
            <ptah-proposal-panel
              [config]="store.hydration.config()"
              [tags]="store.changeTags()"
              [ordinal]="store.current()?.ordinal ?? 0"
              [complete]="store.hydration.isConfigComplete()"
              [mode]="store.mode"
              [tabId]="store.session.record()?.tabId ?? ''"
              [workspaceRoot]="store.workspaceRoot()"
              [showIntakeFacts]="showIntakeFacts()"
              [document]="store.generatedDocument()"
              (copyDocument)="copy($event)"
            />
            <ptah-revision-history
              [revisions]="store.revisions()"
              [currentRevisionId]="store.current()?.id ?? null"
              (restore)="askRestore($event)"
            />
            @if (restoreId()) {
              <div
                role="group"
                aria-label="Confirm revision restore"
                class="rounded-[14px] border border-state-need p-4"
              >
                <p>Restore this revision as your choices?</p>
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    (click)="confirmRestore()"
                  >
                    Restore</button
                  ><button
                    type="button"
                    class="btn btn-sm"
                    (click)="restoreId.set(null)"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            }
            <details
              class="rounded-[14px] border border-base-300 p-4"
              data-glass-surface="content"
            >
              <summary class="cursor-pointer font-medium">
                Ask the agent to…
              </summary>
              <ptah-builder-ai-helpers-section
                [initialized]="true"
                [tabId]="store.session.record()?.tabId ?? ''"
                [workspaceRoot]="store.workspaceRoot()"
                [document]="store.generatedDocument()"
                (documentAdded)="store.generatedDocument.set($event)"
              />
            </details>
            <details
              #presetsDetails
              class="rounded-[14px] border border-base-300 p-4"
              data-glass-surface="content"
            >
              <summary class="cursor-pointer font-medium">Presets</summary>
              <ptah-builder-presets-section
                [initialized]="true"
                [tabId]="store.session.record()?.tabId ?? ''"
                [workspaceRoot]="store.workspaceRoot()"
                [document]="store.generatedDocument()"
              />
            </details>
            <section #detailsRegion aria-label="Details log" class="space-y-2">
              <details
                class="rounded-[14px] border border-base-300 p-4"
                data-glass-surface="content"
              >
                <summary class="cursor-pointer font-medium">Your brief</summary>
                <pre class="mt-2 whitespace-pre-wrap text-sm">{{
                  brief()
                }}</pre>
              </details>
              <ptah-details-log
                mode="tab"
                [tabId]="store.session.record()?.tabId ?? null"
                [sessionInitialized]="!!store.session.record()?.sessionId"
                [statsSnapshot]="tab()?.sessionStats ?? null"
                [liveModelStats]="tab()?.liveModelStats ?? null"
              />
              @if (expandedMessage()) {
                @if (store.session.latestAssistantMessage(); as message) {
                  <div
                    #latestMessage
                    tabindex="-1"
                    class="rounded-[10px] border border-base-300 p-4"
                    data-glass-surface="tile"
                  >
                    <h3 class="font-medium">Latest agent message</h3>
                    <pre class="mt-2 whitespace-pre-wrap break-words text-sm">{{
                      message.text
                    }}</pre>
                  </div>
                }
              }
            </section>
          }
          @if (store.session.error(); as error) {
            <p role="alert" class="text-sm text-state-err">{{ error }}</p>
          }
          @if (
            store.session.record() &&
            !store.session.record()?.sendAttempt?.ackedAt &&
            store.session.phase() === 'failed'
          ) {
            <button type="button" class="btn btn-sm" (click)="retryBrief()">
              Retry sending brief
            </button>
          }
          @if (store.actionError(); as error) {
            <p role="alert" class="text-sm text-state-err">{{ error }}</p>
          }
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn btn-sm" (click)="saveDraft()">
              Save draft</button
            ><button type="button" class="btn btn-sm" (click)="openPresets()">
              Save as preset</button
            ><button
              type="button"
              class="btn btn-primary btn-sm disabled:!bg-base-200 disabled:!text-base-content-muted disabled:!opacity-100"
              [disabled]="!store.reviewEligible()"
              [attr.aria-describedby]="
                !store.reviewEligible() ? 'review-unavailable-reason' : null
              "
              (click)="review()"
            >
              Review
            </button>
            @if (!store.reviewEligible()) {
              <span
                id="review-unavailable-reason"
                class="text-sm text-base-content-muted"
              >
                Review is available after a proposal is ready.
              </span>
            }
          </div>
        </div>
        <ptah-answer-dock
          #answerDock
          class="max-[860px]:order-first min-[861px]:col-start-2 min-[861px]:row-start-1"
          [background]="backgroundElements()"
          (showDetails)="openDetails()"
        />
      </div>
      @if (leaveOpen()) {
        <ptah-harness-builder-leave-dialog
          [mode]="store.mode"
          [agentRunning]="
            store.session.phase() === 'busy' ||
            store.session.phase() === 'sending'
          "
          [saving]="leaving()"
          [saveFailed]="leaveFailed()"
          [stopUncertain]="stopUncertain()"
          (choice)="chooseLeave($event)"
          (stopChoice)="stopChoice($event)"
        />
      }
    </section>
  `,
})
export class ProposalWorkspacePage implements OnInit {
  protected readonly store = inject(ProposalFlowStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tabs = inject(TabManagerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  protected readonly steps: readonly OnboardingStep[] = [
    { id: 'brief', label: 'Brief', state: 'completed' },
    { id: 'proposal', label: 'Proposal', state: 'current' },
    { id: 'review', label: 'Review', state: 'upcoming' },
  ];
  protected readonly mainElement = viewChild<ElementRef<HTMLElement>>('main');
  private readonly pageHeader =
    viewChild<ElementRef<HTMLElement>>('pageHeader');
  private readonly stepperRegion =
    viewChild<ElementRef<HTMLElement>>('stepperRegion');
  protected readonly backgroundElements = computed(() =>
    [
      this.pageHeader()?.nativeElement,
      this.stepperRegion()?.nativeElement,
      this.mainElement()?.nativeElement,
    ].filter((element): element is HTMLElement => !!element),
  );
  private readonly answerDock = viewChild<AnswerDockComponent>('answerDock');
  private readonly detailsRegion =
    viewChild<ElementRef<HTMLElement>>('detailsRegion');
  private readonly latestMessage =
    viewChild<ElementRef<HTMLElement>>('latestMessage');
  private readonly presetsDetails =
    viewChild<ElementRef<HTMLDetailsElement>>('presetsDetails');
  readonly restoreId = signal<string | null>(null);
  readonly expandedMessage = signal(false);
  readonly leaveOpen = signal(false);
  readonly leaving = signal(false);
  readonly leaveFailed = signal(false);
  readonly stopUncertain = signal(false);
  readonly tab = computed(
    () =>
      this.tabs
        .tabs()
        .find((item) => item.id === this.store.session.record()?.tabId) ?? null,
  );
  private releaseView: (() => void) | null = null;
  private loadQueue = Promise.resolve();
  private requestedTab: string | null = null;
  private leaveDestination: 'home' | 'start' = 'home';
  ngOnInit(): void {
    const subscription = this.route.queryParamMap
      .pipe(
        map((params) => params.get('tab')),
        distinctUntilChanged(),
      )
      .subscribe((tab) => {
        this.requestedTab = tab;
        if (tab)
          this.loadQueue = this.loadQueue.then(() =>
            this.requestedTab === tab ? this.load(tab) : undefined,
          );
        else this.store.restoreState.set('missing');
      });
    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      this.releaseView?.();
    });
  }
  private async load(tab: string): Promise<void> {
    try {
      await this.store.restore(tab);
      if (this.destroyRef.destroyed || this.requestedTab !== tab) return;
      this.releaseView?.();
      this.releaseView = this.store.session.attachView();
    } catch {
      if (!this.destroyRef.destroyed) {
        this.store.restoreState.set('proposal-unavailable');
        this.store.actionError.set(
          'Could not restore the proposal. Try again.',
        );
      }
    }
  }
  readonly showIntakeFacts = () =>
    this.store.mode === 'new-project' &&
    !!this.store.session.record() &&
    !!this.store.records.readStackProfile(
      this.store.workspaceRoot(),
      this.store.session.record()?.tabId ?? '',
    );
  readonly brief = () => {
    const record = this.store.session.record();
    return record?.intake
      ? formatIntakeSummary(record.intake)
      : (record?.teamIntent ?? 'Brief unavailable');
  };
  readonly recoveryCopy = () =>
    this.store.restoreState() === 'restore-draft'
      ? 'A saved draft is available.'
      : this.store.restoreState() === 'proposal-unavailable'
        ? 'The session is available, but its proposal could not be loaded.'
        : 'This session could not be restored.';
  openDetails(): void {
    const details = this.detailsRegion()?.nativeElement.querySelector(
      'details[data-testid="details-log"]',
    );
    if (!(details instanceof HTMLDetailsElement)) return;
    this.expandedMessage.set(true);
    details.open = true;
    afterNextRender(
      () => {
        const message = this.latestMessage()?.nativeElement;
        (message ?? details).scrollIntoView({ block: 'nearest' });
        (message ?? details.querySelector<HTMLElement>('summary'))?.focus();
      },
      { injector: this.injector },
    );
  }
  openPresets(): void {
    const details = this.presetsDetails()?.nativeElement;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ block: 'nearest' });
    details.querySelector<HTMLElement>('summary')?.focus();
  }
  async restoreDraft(): Promise<void> {
    const draft = this.store.records.readDraft(
      this.store.workspaceRoot(),
      this.store.mode,
    );
    if (!draft) return;
    const link = onboardingStepLink(
      this.store.mode === 'new-project'
        ? 'new-project-workspace'
        : 'team-builder-workspace',
      this.store.mode === 'new-project'
        ? 'new-project-workspace'
        : 'team-builder-workspace',
      { tab: draft.tabId },
    );
    await this.router.navigate([...link.commands], {
      queryParams: link.queryParams,
    });
  }
  proposeAgain(): void {
    this.answerDock()?.prefill(
      'Please propose the configuration again for my brief.',
    );
  }
  private startPath(): string {
    return this.store.mode === 'new-project'
      ? '/onboarding/new-project'
      : '/onboarding/team-builder';
  }
  async startOver(): Promise<void> {
    if (this.store.session.record()) {
      this.leaveDestination = 'start';
      this.leaveOpen.set(true);
      return;
    }
    await this.router.navigate([this.startPath()]);
  }
  beginLeave(): void {
    this.leaveDestination = 'home';
    this.leaveOpen.set(true);
  }
  async retryBrief(): Promise<void> {
    await this.store.session.retrySend();
  }
  askRestore(id: string): void {
    this.restoreId.set(id);
  }
  confirmRestore(): void {
    const id = this.restoreId();
    if (id && this.store.restoreRevision(id)) this.restoreId.set(null);
  }
  async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      this.store.actionError.set('Could not copy the document.');
    }
  }
  async saveDraft(): Promise<void> {
    if (!this.store.session.record() || this.leaving()) return;
    this.leaving.set(true);
    try {
      const result = await this.store.leaveCurrent('save');
      if (result === 'uncertain') {
        this.stopUncertain.set(true);
        this.leaveOpen.set(true);
      } else if (result === 'save-failed')
        this.store.actionError.set('Could not save draft. Try again.');
      else {
        this.store.actionError.set(null);
        if (!this.destroyRef.destroyed)
          await this.router.navigate(['/onboarding']);
      }
    } catch {
      this.store.actionError.set(
        'Could not stop the session to save a draft. Try again.',
      );
    } finally {
      if (!this.destroyRef.destroyed) this.leaving.set(false);
    }
  }
  async review(): Promise<void> {
    const record = this.store.session.record();
    const revision = this.store.current();
    if (!record || !revision || !this.store.reviewEligible()) return;
    const from =
      this.store.mode === 'new-project'
        ? 'new-project-workspace'
        : 'team-builder-workspace';
    const to =
      this.store.mode === 'new-project'
        ? 'new-project-review'
        : 'team-builder-review';
    const link = onboardingStepLink(from, to, {
      tab: record.tabId,
      rev: revision.id,
    });
    await this.router.navigate([...link.commands], {
      queryParams: link.queryParams,
    });
  }
  async chooseLeave(choice: 'cancel' | 'save' | 'discard'): Promise<void> {
    if (choice === 'cancel') {
      this.stopUncertain.set(false);
      this.leaveOpen.set(false);
      this.leaveDestination = 'home';
      return;
    }
    if (!this.store.session.record()) return;
    this.lastLeaveChoice = choice;
    this.leaveFailed.set(false);
    this.leaving.set(true);
    try {
      const result = await this.store.leaveCurrent(choice);
      if (this.destroyRef.destroyed) return;
      if (result === 'uncertain') {
        this.stopUncertain.set(true);
        return;
      }
      if (result === 'save-failed') {
        this.leaveFailed.set(true);
        return;
      }
      this.stopUncertain.set(false);
      this.leaveOpen.set(false);
      const target =
        this.leaveDestination === 'home' ? '/onboarding' : this.startPath();
      await this.router.navigate([target]);
      this.leaveDestination = 'home';
    } catch {
      if (!this.destroyRef.destroyed)
        this.store.actionError.set('Could not leave this session. Try again.');
    } finally {
      if (!this.destroyRef.destroyed) this.leaving.set(false);
    }
  }
  private lastLeaveChoice: 'save' | 'discard' = 'save';
  async stopChoice(choice: 'retry-stop' | 'keep-current'): Promise<void> {
    if (choice === 'keep-current') {
      this.stopUncertain.set(false);
      this.leaveOpen.set(false);
    } else await this.chooseLeave(this.lastLeaveChoice);
  }
}
