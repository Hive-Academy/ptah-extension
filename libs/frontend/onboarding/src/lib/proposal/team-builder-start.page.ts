import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HarnessBuilderLeaveDialogComponent } from '@ptah-extension/harness-builder';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import {
  OnboardingStepperComponent,
  type OnboardingStep,
} from '../shared/onboarding-stepper.component';
import { ProposalFlowStore } from './proposal-flow.store';

@Component({
  selector: 'ptah-team-builder-start-page',
  standalone: true,
  imports: [
    HarnessBuilderLeaveDialogComponent,
    OnboardingStepperComponent,
    FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto max-w-[760px] space-y-5 p-4"
      aria-labelledby="team-builder-start-title"
      data-testid="team-builder-start"
    >
      <header>
        <h1
          id="team-builder-start-title"
          class="text-2xl font-semibold"
          tabindex="-1"
        >
          AI team builder
        </h1>
        <p class="text-sm text-base-content-muted">
          Describe the team you want.
        </p>
      </header>
      <ptah-onboarding-stepper [steps]="steps" />
      <form
        class="space-y-5 rounded-[22px] border border-base-300 p-5"
        data-glass-surface="content"
        (ngSubmit)="submit($event)"
        novalidate
      >
        <p class="text-sm text-base-content-muted">
          Workspace: {{ store.workspaceRoot() || 'Open a workspace' }}
        </p>
        <div>
          <label for="team-intent" class="block font-medium"
            >Describe the team you want</label
          ><textarea
            id="team-intent"
            name="intent"
            class="textarea textarea-bordered mt-2 min-h-32 w-full"
            [ngModel]="intent()"
            (ngModelChange)="intent.set($event)"
            (blur)="touched.set(true)"
            [attr.aria-invalid]="invalid() ? true : null"
            [attr.aria-describedby]="invalid() ? 'team-intent-error' : null"
          ></textarea>
          @if (invalid()) {
            <p id="team-intent-error" class="text-sm text-state-err">
              Describe the team you want.
            </p>
          }
        </div>
        <details class="rounded-[10px] border border-base-300 p-3">
          <summary class="cursor-pointer">
            Advanced · provider and model
          </summary>
          <p class="mt-2 text-sm text-base-content-muted">
            The session uses your current provider and model.
          </p>
        </details>
        @if (draftTab()) {
          <button type="button" class="btn btn-sm" (click)="continueDraft()">
            Load saved draft
          </button>
        }
        @if (store.actionError(); as error) {
          <p role="alert" class="text-sm text-state-err">{{ error }}</p>
        }
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary" [disabled]="starting()">
            {{ starting() ? 'Starting…' : 'Start team builder' }}</button
          ><button type="button" class="btn" (click)="back()">Back</button>
        </div>
      </form>
      @if (store.leaveOpen()) {
        <ptah-harness-builder-leave-dialog
          [context]="store.conflictMode() ? 'switch' : 'start-over'"
          [mode]="store.conflictMode() ?? store.mode"
          [saving]="store.leaveSaving()"
          [saveFailed]="store.leaveFailed()"
          [stopUncertain]="store.stopUncertain()"
          (choice)="resolve($event)"
          (stopChoice)="stopChoice($event)"
        />
      }
    </section>
  `,
})
export class TeamBuilderStartPage {
  protected readonly store = inject(ProposalFlowStore);
  protected readonly steps: readonly OnboardingStep[] = [
    { id: 'brief', label: 'Brief', state: 'current' },
    { id: 'proposal', label: 'Proposal', state: 'upcoming' },
    { id: 'review', label: 'Review', state: 'upcoming' },
  ];
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly intent = signal('');
  readonly touched = signal(false);
  readonly submitted = signal(false);
  readonly starting = signal(false);
  readonly draftTab = () =>
    this.store.records.readDraft(
      this.store.workspaceRoot(),
      'configure-harness',
    )?.tabId ?? null;
  readonly invalid = () =>
    (this.submitted() || this.touched()) && !this.intent().trim();
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.invalid() || this.starting()) return;
    this.starting.set(true);
    try {
      const tab = await this.store.start({
        mode: 'configure-harness',
        workspaceRoot: this.store.workspaceRoot(),
        intent: this.intent().trim(),
      });
      if (!this.destroyRef.destroyed && tab)
        await this.open(tab, this.store.lastStartCreated());
    } finally {
      if (!this.destroyRef.destroyed) this.starting.set(false);
    }
  }
  async open(tab: string, freshlyStarted = false): Promise<void> {
    const link = onboardingStepLink('team-builder', 'team-builder-workspace', {
      tab,
    });
    let navigated = false;
    try {
      navigated = await this.router.navigate([...link.commands], {
        queryParams: link.queryParams,
      });
    } catch {
      if (!this.destroyRef.destroyed)
        this.store.actionError.set('Could not open the proposal. Try again.');
    } finally {
      if (!navigated && freshlyStarted)
        await this.store.discardCancelledStart();
    }
  }
  async continueDraft(): Promise<void> {
    const tab = this.draftTab();
    if (tab) await this.open(tab);
  }
  async resolve(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
    const tab = await this.store.resolveConflict(choice);
    if (!this.destroyRef.destroyed && tab)
      await this.open(tab, this.store.lastStartCreated());
  }
  async stopChoice(choice: 'retry-stop' | 'keep-current'): Promise<void> {
    if (choice === 'keep-current') await this.store.resolveConflict('cancel');
    else await this.resolve(this.store.lastStopChoice());
  }
  async back(): Promise<void> {
    await this.router.navigate(['/onboarding']);
  }
}
