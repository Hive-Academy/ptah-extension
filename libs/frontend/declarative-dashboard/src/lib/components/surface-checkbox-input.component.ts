import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  checkDraftValue,
  type SurfaceDataValue,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceInputCommit } from '../surface-interaction';
import type { InputNode } from '../view-model/view-model.types';
import {
  describedByOf,
  displayedInputValue,
  inputErrorText,
  issueIdOf,
  issueTextsOf,
  NO_DRAFTS,
  NO_ISSUES,
  NO_PENDING_VALUES,
} from './surface-input-messages';

export type CheckboxInputNode = Extract<InputNode, { readonly kind: 'checkbox' }>;

let nextCheckboxInputInstance = 0;

/**
 * Checkbox bound to a boolean path. Commits on change, only a value that
 * passes `checkDraftValue` and differs from the displayed value. The DOM is
 * put back to the displayed value after each change, so it only moves when
 * the parent applies the commit (pending overlay or host echo).
 */
@Component({
  selector: 'ptah-surface-checkbox-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1 text-base-content">
      <label [for]="controlId" class="flex items-center gap-2 text-sm">
        <input #checkboxControl [id]="controlId" type="checkbox" class="checkbox checkbox-sm" [checked]="checked()"
          [attr.aria-required]="required() ? 'true' : null" [attr.aria-invalid]="hasError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()" [attr.data-apps-focus-key]="focusKey('input')"
          (change)="toggle(checkboxControl)" />
        <span>{{ node().label }}@if (required()) {
          <span aria-hidden="true"> *</span>
        }</span>
      </label>
      @if (errorText(); as error) { <p [id]="errorId" class="text-xs font-medium text-base-content">{{ error }}</p> }
      @for (issue of issueTexts(); track $index) {
        <p [id]="issueId($index)" class="text-xs font-medium text-base-content">{{ issue }}</p>
      }
    </div>
  `,
})
export class SurfaceCheckboxInputComponent {
  public readonly controlId = `ptah-surface-checkbox-${nextCheckboxInputInstance++}`;
  public readonly errorId = `${this.controlId}-error`;
  public readonly node = input.required<CheckboxInputNode>();
  public readonly surfaceId = input('');
  public readonly drafts = input<Readonly<Record<string, SurfaceDataValue>>>(NO_DRAFTS);
  public readonly pendingValues = input<ReadonlyMap<string, SurfaceDataValue>>(NO_PENDING_VALUES);
  public readonly issues = input<ReadonlyMap<string, readonly string[]>>(NO_ISSUES);
  public readonly inputCommit = output<SurfaceInputCommit>();

  /** Rule 4 order: the draft over the pending overlay over the host value. */
  public readonly displayedValue = computed<SurfaceDataValue>(() =>
    displayedInputValue(this.node(), this.drafts(), this.pendingValues()));
  public readonly checked = computed(() => this.displayedValue() === true);
  public readonly required = computed(() => this.node().hints?.required === true);
  public readonly issueTexts = computed(() => issueTextsOf(this.issues(), this.node().id));
  public readonly errorText = computed(() => inputErrorText(this.node(), this.drafts(), this.displayedValue()));
  public readonly hasError = computed(() => this.errorText() !== undefined || this.issueTexts().length > 0);
  public readonly describedBy = computed(() => describedByOf(this.controlId, {
    errorId: this.errorText() !== undefined ? this.errorId : undefined,
    issueCount: this.issueTexts().length,
  }));

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public issueId(index: number): string { return issueIdOf(this.controlId, index); }

  public toggle(control: HTMLInputElement): void {
    const value = control.checked;
    const node = this.node();
    if (checkDraftValue(node, value).ok && value !== this.displayedValue()) {
      this.inputCommit.emit({ componentId: node.id, value });
    }
    control.checked = this.checked();
  }
}
