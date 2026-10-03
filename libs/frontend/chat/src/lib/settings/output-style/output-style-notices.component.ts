/**
 * OutputStyleNoticesComponent — the notices above the output-style matrix (TASK_2026_555 Batch 55b CS-2, split out of
 * {@link OutputStyleListComponent} unchanged, A23):
 *  - the failed-operation alert, a fixed sentence per operation (Moderate 4; host error text is never shown, D15);
 *  - the missing-active banner (E5/N1), naming both causes unless no file failed to parse, with "Clear the selection";
 *  - the name-collision banner (E4);
 *  - the fallback banner (Req 5.4) with "Copy to this project", confirmed first when a project style of the same name
 *    would be replaced (item 16 / P8: the confirm takes focus on Cancel; Esc or Cancel returns focus to the opener).
 *
 * The list owns the selection: "Clear the selection" asks it (`clearSelection`), so the parity prompt still applies.
 */

import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { LucideAngularModule, AlertCircle, AlertTriangle, RotateCcw } from 'lucide-angular';
import type { OutputStyleEntry } from '@ptah-extension/shared';
import type { OutputStyleFailedOperation } from './output-style.store';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

/** Moderate 4: the banner names the operation the store recorded, never one guessed from host text. */
const FAILURE_MESSAGES: Readonly<Record<OutputStyleFailedOperation, string>> = {
  list: 'Could not read the output styles.',
  activate: 'Could not change the active output style.',
  save: 'Could not save the output style.',
  delete: 'Could not delete the output style.',
  open: 'Could not open that output style.',
  copy: 'Could not copy the output style to the project.',
};

@Component({
  selector: 'ptah-output-style-notices',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Write / Operation Error Alert -->
    @if (fixedErrorMessage(); as message) {
      <div
        class="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-2 mb-3 text-xs text-base-content"
        role="alert"
        data-testid="output-style-error"
      >
        <lucide-angular
          [img]="AlertCircleIcon"
          class="w-3.5 h-3.5 mt-0.5 shrink-0 text-error"
          aria-hidden="true"
        />
        <span class="flex-1">{{ message }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-base-content"
          (click)="dismissError.emit()"
        >
          Dismiss
        </button>
      </div>
    }

    <!-- Missing-active banner (E5/N1) -->
    @if (activeMissing()) {
      <div
        class="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 mb-3 text-xs text-base-content"
        role="status"
        data-testid="output-style-missing-banner"
      >
        <lucide-angular
          [img]="AlertTriangleIcon"
          class="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div class="flex-1">
          <p class="text-xs">
            The selected style
            <code class="text-base-content-muted">{{ activeName() }}</code>
            {{ missingActiveExplanation() }}
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-xs mt-1 gap-1 text-base-content"
            (click)="clearSelection.emit()"
            [ptahBusyDisabled]="saving()"
            data-testid="output-style-clear-selection"
          >
            <lucide-angular
              [img]="RotateCcwIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            Clear the selection
          </button>
        </div>
      </div>
    }

    <!-- Collision banner (E4) -->
    @if (hasCollision()) {
      <div
        class="rounded border border-warning/40 bg-warning/10 p-2 mb-3 text-xs text-base-content"
        role="status"
        data-testid="output-style-collision-banner"
      >
        <p class="text-xs">
          More than one file uses the name
          {{ collidingNames().join(', ') }}. A style is selected by name, so the
          higher-priority copy wins: a project file beats a user file, and any
          file beats a built-in of the same name. Rename one of them to remove
          the ambiguity.
        </p>
      </div>
    }

    <!-- Fallback injection banner (Req 5.4) -->
    @if (usingFallback()) {
      <div
        class="rounded border border-info/40 bg-info/10 p-2 mb-3 text-xs text-base-content"
        role="status"
        data-testid="output-style-fallback-banner"
      >
        <p class="text-xs">
          This provider does not read style files from your home folder, so Ptah
          adds
          <code class="text-base-content-muted">{{ activeName() }}</code>
          to each new session directly instead. Copying it into this project
          removes the need for that.
        </p>
        @if (activeName(); as name) {
          <button
            #copyButton
            type="button"
            class="btn btn-ghost btn-xs mt-1 text-base-content"
            (click)="requestCopy(name)"
            [ptahBusyDisabled]="saving()"
            data-testid="output-style-copy-to-project"
          >
            Copy to this project
          </button>
          <!-- Item 16 / P8: replacing a project style of the same name is confirmed first; no Undo -->
          @if (confirmingCopy()) {
            <div
              class="flex flex-wrap items-center gap-2 rounded border border-base-300 p-2 mt-1 text-xs text-base-content"
              role="alertdialog"
              aria-label="Confirm replacing the project style"
              data-testid="output-style-copy-confirm"
              (keydown.escape)="cancelCopy(copyButton, $event)"
            >
              <span class="flex-1">This project already has a style with this name. Replace it with your copy?</span>
              <button
                type="button"
                class="btn btn-outline btn-xs border-error text-base-content"
                [ptahBusyDisabled]="saving()"
                (click)="confirmCopy(name)"
                data-testid="output-style-confirm-copy"
              >
                Replace it
              </button>
              <button #copyCancel type="button" class="btn btn-ghost btn-xs text-base-content" (click)="cancelCopy(copyButton)">
                Cancel
              </button>
            </div>
          }
        }
      </div>
    }

  `,
})
export class OutputStyleNoticesComponent {
  readonly failedOperation = input<OutputStyleFailedOperation | null>(null);
  readonly activeName = input<string | null>(null);
  readonly activeMissing = input(false);
  /** How many style files failed to parse: the missing-active banner names them as a cause only when there are some. */
  readonly invalidCount = input(0);
  readonly hasCollision = input(false);
  readonly collidingNames = input<readonly string[]>([]);
  readonly usingFallback = input(false);
  /** The listed styles: a copy to the project is confirmed first when the project already has one of that name. */
  readonly styles = input<readonly OutputStyleEntry[]>([]);
  /** A write runs: the buttons that start one keep focus but refuse (aria-disabled). */
  readonly saving = input(false);

  readonly dismissError = output<void>();
  readonly clearSelection = output<void>();
  /** `overwrite` only after the user confirmed replacing a project style of the same name (item 16). */
  readonly copyToProject = output<{ readonly name: string; readonly overwrite: boolean }>();

  readonly AlertCircleIcon = AlertCircle;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly RotateCcwIcon = RotateCcw;

  /** View state: the copy-to-project confirm is open (a project style of the same name exists). */
  readonly confirmingCopy = signal(false);

  /** The fixed sentence for the failed operation; host error text is never shown (D15). */
  readonly fixedErrorMessage = computed<string | null>(() => {
    const operation = this.failedOperation();
    return operation === null ? null : FAILURE_MESSAGES[operation];
  });

  /** E5/N1 explanation of why the active style stopped resolving. */
  readonly missingActiveExplanation = computed<string>(() =>
    this.invalidCount() === 0
      ? 'is no longer available. Its file was removed or renamed outside Ptah, so new sessions run with the default behaviour.'
      : 'is no longer available. Its file was either removed outside Ptah, or it is one of the files Ptah could not read, listed below — repairing that file brings the style back. Until then, new sessions run with the default behaviour.',
  );

  private readonly copyCancel = viewChild<ElementRef<HTMLButtonElement>>('copyCancel');

  constructor() {
    // P8: an opened copy confirm takes focus on Cancel, so Esc reaches it.
    effect(() => this.copyCancel()?.nativeElement.focus());
  }

  /** Copy to this project: straight away, unless a project style of the same name would be replaced. */
  requestCopy(name: string): void {
    if (this.styles().some((style) => style.tier === 'project' && style.name === name)) {
      this.confirmingCopy.set(true);
    } else {
      this.copyToProject.emit({ name, overwrite: false });
    }
  }

  confirmCopy(name: string): void {
    this.confirmingCopy.set(false);
    this.copyToProject.emit({ name, overwrite: true });
  }

  /** Cancel and Esc close the copy confirm and return focus to "Copy to this project" (P8). */
  cancelCopy(opener: HTMLButtonElement, event?: Event): void {
    event?.stopPropagation();
    this.confirmingCopy.set(false);
    opener.focus();
  }
}
