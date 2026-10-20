import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { WizardPreviewGenerationResponse } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-agent-preview-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-neutral/60 p-3">
        <section
          #dialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-title"
          aria-describedby="preview-description"
          tabindex="-1"
          class="max-h-full w-full max-w-xl overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-4 shadow-xl"
          (keydown)="onKeydown($event)"
        >
          <h2 id="preview-title" class="text-lg font-bold">
            Review generation targets
          </h2>
          <p id="preview-description" class="text-sm text-base-content-muted">
            Definite targets will hold generated content. Conditional targets
            depend on the stated condition.
          </p>
          @if (model() && model() !== 'unknown') {
            <p class="text-sm">Model: {{ model() }}</p>
          }
          @if (changed()) {
            <p role="alert" class="alert alert-warning my-2">
              Targets changed. Review the new list and confirm again.
            </p>
          }
          @if (loading()) {
            <p role="status">Checking targets...</p>
          }
          @if (error()) {
            <p role="alert" class="alert alert-warning my-2">
              Targets could not be checked. Review the agents folder after
              generation.
            </p>
          }
          @if (preview(); as current) {
            @if (current.warning) {
              <p class="alert alert-warning my-2">{{ current.warning }}</p>
            }
            @for (agent of current.agents; track agent.agentId) {
              <h3 class="mt-3 font-semibold">{{ agent.agentId }}</h3>
              <ul class="space-y-1 text-sm">
                @for (file of agent.files; track file.target + file.relPath) {
                  <li class="break-all">
                    <span class="badge badge-sm">{{ file.certainty }}</span>
                    {{ file.relPath }}
                    @if (file.willOverwrite) {
                      <span class="text-warning">Replaces existing file</span>
                    }
                    @if (file.condition) {
                      <span>({{ file.condition }})</span>
                    }
                  </li>
                }
              </ul>
            }
          }
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="dismissed.emit()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              [disabled]="loading()"
              (click)="confirm.emit()"
            >
              Confirm and generate
            </button>
          </div>
        </section>
      </div>
    }
  `,
})
export class AgentPreviewDialogComponent {
  readonly open = input(false);
  readonly loading = input(false);
  readonly changed = input(false);
  readonly error = input(false);
  readonly model = input<string | null>(null);
  readonly preview = input<WizardPreviewGenerationResponse | null>(null);
  readonly dismissed = output<void>();
  readonly confirm = output<void>();
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        queueMicrotask(() => this.dialog()?.nativeElement.focus());
      } else if (this.opener) {
        this.opener.focus();
        this.opener = null;
      }
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismissed.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons =
      this.dialog()?.nativeElement.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      );
    if (!buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
