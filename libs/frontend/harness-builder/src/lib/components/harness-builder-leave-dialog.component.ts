import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  AfterViewInit,
  inject,
  input,
  output,
  viewChild,
  computed,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import type { HarnessBuilderMode } from '../services/harness-builder-records.service';

export type HarnessLeaveContext =
  'start-over' | 'new-project' | 'switch' | 'resume';
export type HarnessLeaveChoice = 'cancel' | 'discard' | 'save';

@Component({
  selector: 'ptah-harness-builder-leave-dialog',
  standalone: true,
  imports: [CdkTrapFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-base-300/70 p-4"
      (click)="onBackdrop($event)"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="builder-leave-title"
        aria-describedby="builder-leave-description"
        [attr.aria-busy]="saving() ? true : null"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        class="surface-3 rounded-lg p-5 w-full max-w-[420px] max-h-[calc(100vh-2rem)] overflow-y-auto"
        (keydown)="onKeydown($event)"
      >
        <h2 id="builder-leave-title" class="text-base font-semibold">
          {{ title() }}
        </h2>
        <p
          id="builder-leave-description"
          class="mt-2 text-sm text-base-content-muted"
        >
          {{ description() }}
        </p>
        @if (existingDraftAt()) {
          <p
            class="mt-3 rounded-md border border-surface-border-strong bg-surface-2 px-2.5 py-2 text-xs"
          >
            You already have a saved draft from {{ existingDraftAt() }}. Saving
            replaces it. The older session stays in your session history.
          </p>
        }
        @if (!sessionStarted()) {
          <p
            id="builder-save-pending"
            class="mt-3 rounded-md border border-surface-border-strong bg-surface-2 px-2.5 py-2 text-xs"
          >
            Waiting for the chat session to start. Save as draft is available
            once the session exists.
          </p>
        }
        @if (saveFailed()) {
          <p
            role="alert"
            class="mt-3 rounded-md border border-state-err/55 bg-error/10 px-2.5 py-2 text-xs"
          >
            The draft could not be saved, so nothing changed. Try again, or
            discard.
          </p>
        }
        @if (stopUncertain()) {
          <p role="alert" class="mt-3 rounded-md border border-state-err/55 bg-error/10 px-2.5 py-2 text-xs">
            The agent may still be running. Retry stop or keep this session.
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button #cancelButton type="button" class="btn btn-outline btn-sm" (click)="stopChoice.emit('keep-current')">Keep current</button>
            <button type="button" class="btn btn-primary btn-sm" (click)="stopChoice.emit('retry-stop')">Retry stop</button>
          </div>
        } @else {
        <div
          class="mt-5 flex flex-col gap-2 min-[460px]:flex-row min-[460px]:justify-end"
        >
          <button
            #cancelButton
            type="button"
            class="btn btn-outline btn-sm border-base-content/50 min-h-10 min-[460px]:min-h-8"
            [disabled]="saving()"
            (click)="choose('cancel')"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-outline btn-sm border-base-content/50 min-h-10 min-[460px]:min-h-8"
            [disabled]="saving()"
            (click)="choose('discard')"
          >
            <span class="text-state-err" aria-hidden="true">×</span> Discard
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm min-h-10 min-[460px]:min-h-8"
            [disabled]="saving()"
            [attr.aria-disabled]="!sessionStarted() ? true : null"
            [attr.aria-describedby]="
              !sessionStarted() ? 'builder-save-pending' : null
            "
            [attr.tabindex]="!sessionStarted() ? -1 : null"
            (click)="choose('save')"
          >
            {{
              saving()
                ? 'Saving...'
                : saveFailed()
                  ? 'Try again'
                  : 'Save as draft'
            }}
          </button>
        </div>
        }
      </div>
    </div>
  `,
})
export class HarnessBuilderLeaveDialogComponent
  implements AfterViewInit, OnDestroy
{
  readonly context = input<HarnessLeaveContext>('start-over');
  readonly mode = input<HarnessBuilderMode>('configure-harness');
  readonly agentRunning = input(false);
  readonly sessionStarted = input(true);
  readonly saving = input(false);
  readonly saveFailed = input(false);
  readonly stopUncertain = input(false);
  readonly existingDraftAt = input<string | null>(null);
  readonly trigger = input<HTMLElement | null>(null);
  readonly choice = output<HarnessLeaveChoice>();
  readonly stopChoice = output<'retry-stop' | 'keep-current'>();

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly cancelButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');
  private returnFocus: HTMLElement | null = null;
  private inerted: HTMLElement[] = [];

  protected readonly title = computed(() => {
    switch (this.context()) {
      case 'new-project':
        return 'Start the New Project?';
      case 'switch':
        return 'Open the AI Team Builder?';
      case 'resume':
        return 'Resume this draft?';
      case 'start-over':
        return this.mode() === 'new-project'
          ? 'Leave New Project Setup?'
          : 'Leave AI Team Builder?';
    }
  });
  protected readonly description = computed(() => {
    switch (this.context()) {
      case 'new-project':
        return 'An AI Team Builder session is open in this workspace. Save it as a draft to come back to later, or discard it. Starting a new project stops its agent.';
      case 'switch':
        return 'A New Project session is open in this workspace. Save it as a draft to come back to later, or discard it. Opening the builder stops its agent.';
      case 'resume':
        return 'Your current session becomes the draft, and the draft you picked opens in its place. Or discard the current session instead.';
      case 'start-over':
        return this.agentRunning()
          ? 'Save this session as a draft to pick it up later from Setup Hub, or discard it. The agent is running and will be stopped either way.'
          : 'Save this session as a draft to pick it up later from Setup Hub, or discard it.';
    }
  });

  ngAfterViewInit(): void {
    this.returnFocus =
      this.trigger() ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    let current: HTMLElement = this.host.nativeElement;
    while (current.parentElement) {
      const parent = current.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (
          sibling instanceof HTMLElement &&
          sibling !== current &&
          !sibling.hasAttribute('inert')
        ) {
          this.inerted.push(sibling);
          sibling.setAttribute('inert', '');
        }
      }
      if (parent.matches('ptah-harness-builder-view')) break;
      current = parent;
    }
    queueMicrotask(() => this.cancelButton().nativeElement.focus());
  }

  ngOnDestroy(): void {
    for (const sibling of this.inerted) sibling.removeAttribute('inert');
    const target = this.returnFocus;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }

  protected choose(choice: HarnessLeaveChoice): void {
    if (this.stopUncertain()) {
      if (choice === 'cancel') this.stopChoice.emit('keep-current');
      return;
    }
    if (this.saving() || (choice === 'save' && !this.sessionStarted())) return;
    this.choice.emit(choice);
  }
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.choose('cancel');
      return;
    }
    if (event.key !== 'Tab' || this.saving()) return;
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])',
      ),
    ).filter((button) => button.tabIndex >= 0);
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey
      ? at <= 0
        ? buttons.length - 1
        : at - 1
      : at < 0 || at === buttons.length - 1
        ? 0
        : at + 1;
    event.preventDefault();
    buttons[next].focus();
  }
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.choose('cancel');
  }
}
