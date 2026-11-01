import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  HarnessBuilderLeaveDialogComponent,
  NEW_PROJECT_AUDIENCE_OPTIONS,
  NEW_PROJECT_PLATFORM_OPTIONS,
} from '@ptah-extension/harness-builder';
import {
  isNewProjectStack,
  stackOptionsForPlatform,
  type NewProjectAudience,
  type NewProjectIntake,
  type NewProjectPlatform,
  type NewProjectStack,
} from '@ptah-extension/shared';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import {
  OnboardingStepperComponent,
  type OnboardingStep,
} from '../shared/onboarding-stepper.component';
import { ProposalFlowStore } from './proposal-flow.store';

@Component({
  selector: 'ptah-new-project-intake-page',
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
      aria-labelledby="new-project-intake-title"
      data-testid="new-project-intake"
    >
      <header>
        <h1
          id="new-project-intake-title"
          class="text-2xl font-semibold"
          tabindex="-1"
        >
          New project
        </h1>
        <p class="text-sm text-base-content-muted">
          Tell the agent what you want to build.
        </p>
      </header>
      <ptah-onboarding-stepper [steps]="steps" />
      @if (draftTab()) {
        <div
          class="rounded-[14px] border border-base-300 p-4"
          data-glass-surface="tile"
        >
          <p>Continue your draft</p>
          <button
            class="btn btn-sm mt-2"
            type="button"
            (click)="continueDraft()"
          >
            Continue
          </button>
        </div>
      }
      <form
        class="space-y-5 rounded-[22px] border border-base-300 p-5"
        data-glass-surface="content"
        (ngSubmit)="submit($event)"
        novalidate
      >
        @if (submitted() && errors().length) {
          <div
            role="alert"
            class="rounded-[10px] border border-state-err p-3 text-sm"
          >
            <p>Check your answers:</p>
            <ul>
              @for (error of errors(); track error) {
                <li>{{ error }}</li>
              }
            </ul>
          </div>
        }
        <div>
          <label for="project-what" class="block font-medium"
            >What are you building? <span aria-hidden="true">*</span></label
          ><textarea
            id="project-what"
            name="what"
            class="textarea textarea-bordered mt-2 min-h-28 w-full"
            [ngModel]="what()"
            (ngModelChange)="what.set($event)"
            (blur)="whatTouched.set(true)"
            [attr.aria-invalid]="whatInvalid() ? true : null"
            [attr.aria-describedby]="
              whatInvalid() ? 'project-what-error' : null
            "
          ></textarea>
          @if (whatInvalid()) {
            <p id="project-what-error" class="text-sm text-state-err">
              Describe what you want to build.
            </p>
          }
        </div>
        <fieldset>
          <legend class="font-medium">Who is it for?</legend>
          <div class="mt-2 flex flex-wrap gap-2">
            @for (option of audienceOptions; track option.value) {
              <button
                type="button"
                class="btn btn-sm min-h-9"
                [class.btn-primary]="audience() === option.value"
                [attr.aria-pressed]="audience() === option.value"
                (click)="audience.set(option.value)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        </fieldset>
        <fieldset>
          <legend class="font-medium">Platform</legend>
          <div class="mt-2 flex flex-wrap gap-2">
            @for (option of platformOptions; track option.value) {
              <button
                type="button"
                class="btn btn-sm min-h-9"
                [class.btn-primary]="platform() === option.value"
                [attr.aria-pressed]="platform() === option.value"
                (click)="setPlatform(option.value)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        </fieldset>
        <fieldset>
          <legend class="font-medium">Stack</legend>
          <div class="mt-2 flex flex-wrap gap-2">
            @for (option of stackOptions(); track option.value) {
              <button
                type="button"
                class="btn btn-sm min-h-9"
                [class.btn-primary]="stack() === option.value"
                [attr.aria-pressed]="stack() === option.value"
                (click)="setStack(option.value)"
              >
                {{ option.label }}
              </button>
            }
          </div>
          @if (stack() === 'other') {
            <label for="project-stack-other" class="mt-3 block text-sm"
              >Describe your stack</label
            ><input
              id="project-stack-other"
              name="stackOther"
              class="input input-bordered mt-1 w-full"
              [ngModel]="stackOther()"
              (ngModelChange)="stackOther.set($event)"
              (blur)="otherTouched.set(true)"
              [attr.aria-invalid]="otherInvalid() ? true : null"
              [attr.aria-describedby]="
                otherInvalid() ? 'project-stack-other-error' : null
              "
            />
            @if (otherInvalid()) {
              <p id="project-stack-other-error" class="text-sm text-state-err">
                Enter your stack.
              </p>
            }
          }
        </fieldset>
        <div>
          <label for="project-constraints" class="block font-medium"
            >Must-haves or constraints
            <span class="font-normal text-base-content-muted"
              >(optional)</span
            ></label
          ><textarea
            id="project-constraints"
            name="constraints"
            class="textarea textarea-bordered mt-2 w-full"
            [ngModel]="constraints()"
            (ngModelChange)="constraints.set($event)"
          ></textarea>
        </div>
        <details class="rounded-[10px] border border-base-300 p-3">
          <summary class="cursor-pointer">
            Advanced · provider and model
          </summary>
          <p class="mt-2 text-sm text-base-content-muted">
            The session uses your current provider and model. You can change
            them in the session settings.
          </p>
        </details>
        @if (store.actionError(); as error) {
          <p role="alert" class="text-sm text-state-err">{{ error }}</p>
        }
        <div class="flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary" [disabled]="starting()">
            {{ starting() ? 'Starting…' : 'Continue' }}</button
          ><button type="button" class="btn" (click)="back()">Back</button>
        </div>
      </form>
      @if (store.leaveOpen()) {
        <ptah-harness-builder-leave-dialog
          [context]="store.conflictMode() ? 'new-project' : 'start-over'"
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
export class NewProjectIntakePage {
  protected readonly store = inject(ProposalFlowStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly audienceOptions = NEW_PROJECT_AUDIENCE_OPTIONS;
  protected readonly platformOptions = NEW_PROJECT_PLATFORM_OPTIONS;
  protected readonly steps: readonly OnboardingStep[] = [
    { id: 'brief', label: 'Brief', state: 'current' },
    { id: 'proposal', label: 'Proposal', state: 'upcoming' },
    { id: 'review', label: 'Review', state: 'upcoming' },
  ];
  readonly what = signal('');
  readonly audience = signal<NewProjectAudience>('unsure');
  readonly platform = signal<NewProjectPlatform>('node-ts');
  readonly stack = signal<NewProjectStack>('recommend');
  readonly stackOther = signal('');
  readonly constraints = signal('');
  readonly submitted = signal(false);
  readonly whatTouched = signal(false);
  readonly otherTouched = signal(false);
  readonly starting = signal(false);
  readonly draftTab = () =>
    this.store.records.readDraft(this.store.workspaceRoot(), 'new-project')
      ?.tabId ?? null;
  readonly stackOptions = () => stackOptionsForPlatform(this.platform());
  readonly whatInvalid = () =>
    (this.submitted() || this.whatTouched()) && !this.what().trim();
  readonly otherInvalid = () =>
    (this.submitted() || this.otherTouched()) &&
    this.stack() === 'other' &&
    !this.stackOther().trim();
  readonly errors = () =>
    [
      !this.what().trim() ? 'What are you building is required.' : null,
      this.stack() === 'other' && !this.stackOther().trim()
        ? 'Enter your stack.'
        : null,
    ].filter((value): value is string => !!value);
  setPlatform(value: NewProjectPlatform): void {
    if (value !== this.platform()) {
      this.platform.set(value);
      this.stack.set('recommend');
      this.stackOther.set('');
      this.otherTouched.set(false);
    }
  }
  setStack(value: string): void {
    if (isNewProjectStack(value)) this.stack.set(value);
  }
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.errors().length || this.starting()) return;
    const intake: NewProjectIntake = {
      what: this.what().trim(),
      audience: this.audience(),
      platform: this.platform(),
      stack: this.stack(),
      ...(this.stack() === 'other'
        ? { stackOther: this.stackOther().trim() }
        : {}),
      ...(this.constraints().trim()
        ? { constraints: this.constraints().trim() }
        : {}),
    };
    this.starting.set(true);
    try {
      const tab = await this.store.start({
        mode: 'new-project',
        workspaceRoot: this.store.workspaceRoot(),
        intake,
      });
      if (!this.destroyRef.destroyed && tab)
        await this.open(tab, this.store.lastStartCreated());
    } finally {
      if (!this.destroyRef.destroyed) this.starting.set(false);
    }
  }
  async open(tab: string, freshlyStarted = false): Promise<void> {
    const link = onboardingStepLink('new-project', 'new-project-workspace', {
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
