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

export type CheckboxInputNode = Extract<InputNode, { readonly kind: 'checkbox' }>;

const NO_DRAFTS: Readonly<Record<string, SurfaceDataValue>> = {};
const NO_PENDING_VALUES: ReadonlyMap<string, SurfaceDataValue> = new Map();
const NO_ISSUES: ReadonlyMap<string, readonly string[]> = new Map();
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
  public readonly displayedValue = computed<SurfaceDataValue>(() => {
    const node = this.node();
    const draft = this.drafts()[node.id];
    if (draft !== undefined) return draft;
    const pending = this.pendingValues().get(node.path);
    return pending !== undefined ? pending : node.hostValue;
  });
  public readonly checked = computed(() => this.displayedValue() === true);
  public readonly required = computed(() => this.node().hints?.required === true);
  public readonly issueTexts = computed((): readonly string[] => {
    const issues: unknown = this.issues().get(this.node().id);
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue: unknown) => typeof issue === 'string' ? [issue] : []);
  });
  public readonly errorText = computed(() => {
    const node = this.node();
    if (this.drafts()[node.id] === undefined && node.draftError !== undefined) return node.draftError;
    const check = checkDraftValue(node, this.displayedValue());
    return check.ok ? undefined : check.reason;
  });
  public readonly hasError = computed(() => this.errorText() !== undefined || this.issueTexts().length > 0);
  public readonly describedBy = computed(() => {
    const ids: string[] = [];
    if (this.errorText() !== undefined) ids.push(this.errorId);
    this.issueTexts().forEach((_, index) => ids.push(this.issueId(index)));
    return ids.length > 0 ? ids.join(' ') : null;
  });

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public issueId(index: number): string { return `${this.controlId}-issue-${index}`; }

  public toggle(control: HTMLInputElement): void {
    const value = control.checked;
    const node = this.node();
    if (checkDraftValue(node, value).ok && value !== this.displayedValue()) {
      this.inputCommit.emit({ componentId: node.id, value });
    }
    control.checked = this.checked();
  }
}
