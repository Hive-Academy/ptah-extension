import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Check, LucideAngularModule } from 'lucide-angular';
import type { FileDecision } from '@ptah-extension/shared';
import {
  KEEP_LABEL,
  groupAriaLabel,
  keepAriaLabel,
  replaceAriaLabel,
  replaceLabel,
  type DecisionKind,
} from './preview-decisions.state';

/**
 * C1 KeepReplaceControl: a radiogroup of two `<button role="radio">`.
 *
 * Roving tabindex (the checked radio is the one tab stop), arrow keys move
 * and select, Space/Enter select. A forced-keep Replace is announced with
 * `aria-disabled="true"`, skipped by arrows and ignored by click. The buttons
 * are real buttons so dialog focus traps that query `button:not(:disabled)`
 * include them. Focus ring: 2px `base-content` outline, 2px offset, on every
 * segment including the selected Keep.
 */
@Component({
  selector: 'ptah-keep-replace-control',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="radiogroup"
      class="inline-flex rounded-md border border-[var(--surface-border-strong)]"
      [attr.aria-label]="groupLabel()"
      [attr.aria-describedby]="describedBy()"
      (keydown)="onKeydown($event)"
    >
      <button
        #keepButton
        type="button"
        role="radio"
        data-testid="keep-segment"
        class="relative inline-flex h-[26px] items-center gap-1 rounded-l-[5px] px-2.5 text-xs font-semibold focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:cursor-not-allowed disabled:opacity-50"
        [class.text-base-content]="decision() !== 'keep'"
        [class.bg-base-content]="decision() === 'keep'"
        [class.text-base-100]="decision() === 'keep'"
        [attr.aria-checked]="decision() === 'keep'"
        [attr.aria-label]="keepLabel()"
        [tabindex]="keepTabIndex()"
        [disabled]="disabled()"
        (click)="choose('keep')"
      >
        @if (decision() === 'keep') {
          <lucide-angular
            [img]="CheckIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
        }
        {{ keepText }}
      </button>
      <button
        #replaceButton
        type="button"
        role="radio"
        data-testid="replace-segment"
        class="relative inline-flex h-[26px] items-center gap-1 rounded-r-[5px] border-l border-[var(--surface-border-strong)] px-2.5 text-xs font-semibold focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-[.55]"
        [class.text-base-content]="decision() !== 'replace'"
        [class.bg-warning]="decision() === 'replace'"
        [class.text-warning-content]="decision() === 'replace'"
        [attr.aria-checked]="decision() === 'replace'"
        [attr.aria-disabled]="forcedKeep() ? 'true' : null"
        [attr.aria-label]="replaceAria()"
        [tabindex]="keepTabIndex() === 0 ? -1 : 0"
        [disabled]="disabled()"
        (click)="choose('replace')"
      >
        @if (decision() === 'replace') {
          <lucide-angular
            [img]="CheckIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
        }
        {{ replaceText() }}
      </button>
    </div>
  `,
})
export class KeepReplaceControlComponent {
  /** Workspace-relative path; part of every accessible name. */
  public readonly path = input.required<string>();
  /** Selects the Replace wording. */
  public readonly kind = input.required<DecisionKind>();
  public readonly decision = input<FileDecision>('keep');
  /** Unreadable or unknown file: Replace is not available. */
  public readonly forcedKeep = input(false);
  /** Disabled while the comparison reloads. */
  public readonly disabled = input(false);
  /** Id of the note that explains a forced Keep. */
  public readonly describedBy = input<string | null>(null);

  public readonly decisionChange = output<FileDecision>();

  protected readonly CheckIcon = Check;
  protected readonly keepText = KEEP_LABEL;

  protected readonly groupLabel = computed(() => groupAriaLabel(this.path()));
  protected readonly keepLabel = computed(() => keepAriaLabel(this.path()));
  protected readonly replaceText = computed(() => replaceLabel(this.kind()));
  protected readonly replaceAria = computed(() =>
    replaceAriaLabel(this.path(), this.kind(), this.forcedKeep()),
  );

  /** Roving tab stop: Keep unless a controllable Replace is checked. */
  protected readonly keepTabIndex = computed(() =>
    this.decision() === 'replace' && !this.forcedKeep() ? -1 : 0,
  );

  private readonly keepButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('keepButton');
  private readonly replaceButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('replaceButton');

  protected choose(decision: FileDecision): void {
    if (this.disabled()) return;
    if (decision === 'replace' && this.forcedKeep()) return;
    if (decision === this.decision()) return;
    this.decisionChange.emit(decision);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        // Two radios: every arrow moves to the other one. A forced-keep
        // Replace is skipped, so focus stays on Keep.
        const next: FileDecision =
          this.decision() === 'keep' ? 'replace' : 'keep';
        if (next === 'replace' && this.forcedKeep()) return;
        this.choose(next);
        this.buttonFor(next).focus();
        return;
      }
      case ' ':
      case 'Enter': {
        const target = event.target;
        if (target === this.keepButton().nativeElement) {
          event.preventDefault();
          this.choose('keep');
        } else if (target === this.replaceButton().nativeElement) {
          event.preventDefault();
          this.choose('replace');
        }
        return;
      }
      default:
        return;
    }
  }

  private buttonFor(decision: FileDecision): HTMLButtonElement {
    return decision === 'keep'
      ? this.keepButton().nativeElement
      : this.replaceButton().nativeElement;
  }
}
