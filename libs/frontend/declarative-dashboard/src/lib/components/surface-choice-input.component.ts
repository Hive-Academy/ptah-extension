import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import {
  checkDraftValue,
  type SurfaceDataValue,
  type SurfaceInputOption,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceInputCommit } from '../surface-interaction';
import type { InputNode } from '../view-model/view-model.types';

export type ChoiceInputNode = Extract<InputNode, { readonly kind: 'select' | 'radio-group' }>;

const NO_DRAFTS: Readonly<Record<string, SurfaceDataValue>> = {};
const NO_PENDING_VALUES: ReadonlyMap<string, SurfaceDataValue> = new Map();
const NO_ISSUES: ReadonlyMap<string, readonly string[]> = new Map();
let nextChoiceInputInstance = 0;

function isOption(value: unknown): value is SurfaceInputOption {
  return value !== null && typeof value === 'object'
    && typeof (value as { readonly value?: unknown }).value === 'string'
    && typeof (value as { readonly label?: unknown }).label === 'string';
}

/**
 * `select` (with an empty "—" option that maps to `null`) or `radio-group`
 * (`fieldset` + `legend`). Commits on change, only a value that passes
 * `checkDraftValue` and differs from the displayed value. The DOM is put back
 * to the displayed value after each change, so it only moves when the parent
 * applies the commit (pending overlay or host echo).
 */
@Component({
  selector: 'ptah-surface-choice-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (node().kind === 'select') {
      <div class="flex flex-col gap-1 text-base-content">
        <label [for]="controlId" class="block text-xs font-medium">{{ node().label }}@if (required()) {
          <span aria-hidden="true"> *</span>
        }</label>
        <select #selectControl [id]="controlId" class="select select-bordered select-sm w-full text-sm"
          [attr.aria-required]="required() ? 'true' : null" [attr.aria-invalid]="hasError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()" [attr.data-apps-focus-key]="focusKey('input')"
          (change)="chooseIndex(selectControl.selectedIndex)">
          <option value="" [selected]="displayedIndex() === -1">—</option>
          @for (option of options(); track $index) {
            <option [value]="option.value" [selected]="displayedIndex() === $index">{{ option.label }}</option>
          }
        </select>
        <ng-container [ngTemplateOutlet]="messages" />
      </div>
    } @else {
      <fieldset role="radiogroup" class="flex flex-col gap-1 text-base-content"
        [attr.aria-required]="required() ? 'true' : null" [attr.aria-invalid]="hasError() ? 'true' : null"
        [attr.aria-describedby]="describedBy()">
        <legend class="mb-1 text-xs font-medium">{{ node().label }}@if (required()) {
          <span aria-hidden="true"> *</span>
        }</legend>
        <div class="flex flex-col gap-1.5">
          @for (option of options(); track $index) {
            <label [for]="optionId($index)" class="flex items-center gap-2 text-sm">
              <input #radioControl [id]="optionId($index)" type="radio" class="radio radio-sm" [name]="controlId"
                [value]="option.value" [checked]="displayedIndex() === $index"
                [attr.data-apps-focus-key]="focusKey('option-' + $index)" (change)="chooseIndex($index + 1)" />
              {{ option.label }}
            </label>
          }
        </div>
        <ng-container [ngTemplateOutlet]="messages" />
      </fieldset>
    }
    <ng-template #messages>
      @if (errorText(); as error) { <p [id]="errorId" class="text-xs font-medium text-base-content">{{ error }}</p> }
      @for (issue of issueTexts(); track $index) {
        <p [id]="issueId($index)" class="text-xs font-medium text-base-content">{{ issue }}</p>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class SurfaceChoiceInputComponent {
  public readonly controlId = `ptah-surface-choice-${nextChoiceInputInstance++}`;
  public readonly errorId = `${this.controlId}-error`;
  public readonly node = input.required<ChoiceInputNode>();
  public readonly surfaceId = input('');
  public readonly drafts = input<Readonly<Record<string, SurfaceDataValue>>>(NO_DRAFTS);
  public readonly pendingValues = input<ReadonlyMap<string, SurfaceDataValue>>(NO_PENDING_VALUES);
  public readonly issues = input<ReadonlyMap<string, readonly string[]>>(NO_ISSUES);
  public readonly inputCommit = output<SurfaceInputCommit>();
  private readonly selectControl = viewChild<ElementRef<HTMLSelectElement>>('selectControl');
  private readonly radioControls = viewChildren<ElementRef<HTMLInputElement>>('radioControl');

  /** Well-formed options only: a malformed entry is skipped, never a crash. */
  public readonly options = computed((): readonly SurfaceInputOption[] => {
    const options: unknown = this.node().options;
    return Array.isArray(options) ? options.filter(isOption) : [];
  });
  /** The node validation sees: the same well-formed options that render, so `checkDraftValue` cannot throw. */
  private readonly checkedNode = computed((): ChoiceInputNode => ({ ...this.node(), options: this.options() }));
  /** Rule 4 order: the draft over the pending overlay over the host value. */
  public readonly displayedValue = computed<SurfaceDataValue>(() => {
    const node = this.node();
    const draft = this.drafts()[node.id];
    if (draft !== undefined) return draft;
    const pending = this.pendingValues().get(node.path);
    return pending !== undefined ? pending : node.hostValue;
  });
  /** Index into `options()`, or -1 for `null` (the "—" option / no radio checked). */
  public readonly displayedIndex = computed(() => {
    const value = this.displayedValue();
    return typeof value === 'string' ? this.options().findIndex(option => option.value === value) : -1;
  });
  public readonly required = computed(() => this.node().hints?.required === true);
  public readonly issueTexts = computed((): readonly string[] => {
    const issues: unknown = this.issues().get(this.node().id);
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue: unknown) => typeof issue === 'string' ? [issue] : []);
  });
  public readonly errorText = computed(() => {
    const node = this.node();
    if (this.drafts()[node.id] === undefined && node.draftError !== undefined) return node.draftError;
    const check = checkDraftValue(this.checkedNode(), this.displayedValue());
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
  public optionId(index: number): string { return `${this.controlId}-option-${index}`; }
  public issueId(index: number): string { return `${this.controlId}-issue-${index}`; }

  /**
   * `choiceIndex` 0 is the "—" option (`null`); `n` is `options()[n - 1]`.
   * Mapping by index keeps "—" unambiguous whatever the option values are.
   */
  public chooseIndex(choiceIndex: number): void {
    const option = choiceIndex > 0 ? this.options()[choiceIndex - 1] : undefined;
    const value: SurfaceDataValue = option === undefined ? null : option.value;
    const node = this.checkedNode();
    if (checkDraftValue(node, value).ok && value !== this.displayedValue()) {
      this.inputCommit.emit({ componentId: node.id, value });
    }
    this.restoreDom();
  }

  /** Controlled input: the DOM shows the displayed value until the parent applies the commit. */
  private restoreDom(): void {
    const index = this.displayedIndex();
    const select = this.selectControl()?.nativeElement;
    if (select !== undefined) select.selectedIndex = index + 1;
    this.radioControls().forEach((radio, radioIndex) => { radio.nativeElement.checked = radioIndex === index; });
  }
}
