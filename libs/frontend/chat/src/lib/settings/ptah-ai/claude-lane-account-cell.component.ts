import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { Check, ChevronDown, LucideAngularModule, X } from 'lucide-angular';
import {
  ClaudeAmbientStatusService,
  ProviderAccountsStateService,
  VSCodeService,
  type ProviderAccountChoice,
} from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import {
  ACCOUNT_COPY,
  accountChoiceOf,
  accountSelectorModel,
  selectionFeedback,
  type AccountSelectorModel,
  type AccountSelectorOption,
} from '../providers/accounts/account-presentation';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
/** The matrix's `CELL` classes (`cli-orchestration-matrix.component.ts`), so the cell reads like the Model cell. */
const CELL = `link link-hover inline-flex max-w-[13rem] items-center gap-1 rounded px-1 text-left font-mono text-xs text-base-content no-underline hover:bg-base-200 disabled:cursor-not-allowed ${FOCUS}`;
const ITEM = `flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-base-300 ${FOCUS}`;

let nextId = 0;

/**
 * The Claude lane's Account cell (P6 plan component 5, design-spec-p6 Surface 2, State contract 5-8). It sits under
 * the installed Claude row's name line of the CLI matrix and writes the `lane` scope only.
 * - Electron only (D34): elsewhere the account services are never injected, nothing renders and no RPC runs.
 * - Absent unless `accountSelectorModel(..., 'lane')` is visible (P6-1).
 * - The menu is `role="menu"` of `menuitemradio` buttons (P6-5): arrows, Home and End move focus only; Enter, Space
 *   or click on an enabled, different item saves; disabled items stay focusable; Escape and Tab close (P6-A7).
 * - B-1: the cell text is always the stored value of the last snapshot; nothing changes locally on a choice.
 * - B-2: focus goes to the trigger when the menu closes on a choice, before the write; the result never moves focus.
 */
@Component({
  selector: 'ptah-claude-lane-account-cell',
  standalone: true,
  imports: [
    NativePopoverComponent,
    LucideAngularModule,
    SettingsBusyDisabledDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (model(); as m) {
      <div
        class="mt-0.5 flex flex-wrap items-center gap-1 font-normal"
        data-testid="cli-matrix-account"
      >
        <span class="text-[11px] text-base-content-muted">Account</span>
        <ptah-native-popover
          [isOpen]="open()"
          placement="bottom-start"
          [hasBackdrop]="true"
          backdropClass="transparent"
          (closed)="open.set(false)"
          (opened)="focusChecked()"
        >
          <button
            #trigger
            trigger
            type="button"
            [class]="cell"
            [ptahBusyDisabled]="saving()"
            aria-haspopup="menu"
            [attr.aria-expanded]="open()"
            [attr.aria-label]="'Claude account: ' + m.selectedText + '. Change'"
            [title]="m.selectedText"
            (click)="toggle()"
            data-testid="cli-matrix-account-trigger"
          >
            <span class="min-w-0 truncate">{{
              saving() ? 'Saving…' : m.selectedText
            }}</span>
            <lucide-angular
              [img]="ChevronIcon"
              class="h-2.5 w-2.5 shrink-0 text-base-content-muted"
              aria-hidden="true"
            />
          </button>
          @if (open()) {
            <div
              content
              class="surface-3 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl p-3 text-left text-xs"
              [style.width.rem]="17"
              data-testid="cli-matrix-account-menu"
              (keydown)="onMenuKey($event)"
            >
              <div
                class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5"
              >
                <h3 [id]="titleId" class="text-xs font-bold text-base-content">
                  Account
                </h3>
                <button
                  type="button"
                  [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing"
                  aria-label="Close"
                  (click)="closeToTrigger()"
                  data-testid="cli-matrix-account-close"
                >
                  <lucide-angular
                    [img]="CloseIcon"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div role="menu" [attr.aria-labelledby]="titleId">
                @for (option of m.options; track option.value) {
                  <button
                    type="button"
                    role="menuitemradio"
                    [class]="item"
                    [class.text-base-content-muted]="option.disabled"
                    [class.cursor-not-allowed]="option.disabled"
                    [attr.aria-checked]="option.value === m.value"
                    [attr.aria-disabled]="option.disabled ? 'true' : null"
                    [tabIndex]="option.value === m.value ? 0 : -1"
                    [attr.data-value]="option.value"
                    (click)="choose(option)"
                  >
                    <span
                      class="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                      aria-hidden="true"
                    >
                      @if (option.value === m.value) {
                        <lucide-angular [img]="CheckIcon" class="h-3.5 w-3.5" />
                      }
                    </span>
                    <span class="min-w-0 break-words">{{ option.label }}</span>
                    @if (option.value === 'stored' && m.stored.kind === 'removed') {
                      <span class="sr-only">{{ removedSentence }}</span>
                    }
                  </button>
                }
              </div>
            </div>
          }
        </ptah-native-popover>
      </div>
    }
  `,
})
export class ClaudeLaneAccountCellComponent {
  /** Accounts are Electron only (D34), the same gate as `providers-settings.component.ts`. */
  private readonly available = inject(VSCodeService).isElectron;
  private readonly accounts = this.available
    ? inject(ProviderAccountsStateService)
    : null;
  private readonly ambient = this.available
    ? inject(ClaudeAmbientStatusService)
    : null;
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly cell = CELL;
  protected readonly item = ITEM;
  protected readonly focusRing = FOCUS;
  protected readonly ChevronIcon = ChevronDown;
  protected readonly CloseIcon = X;
  protected readonly CheckIcon = Check;
  protected readonly removedSentence = ACCOUNT_COPY.removedAccount;
  protected readonly titleId = `ptah-lane-account-title-${nextId++}`;

  /** The lane selector model, or `null` while the cell is absent (not Electron, not ready, or P6-1 false). */
  protected readonly model = computed<AccountSelectorModel | null>(() => {
    if (!this.accounts || !this.ambient) return null;
    const model = accountSelectorModel(
      this.accounts.state('claude')(),
      this.ambient.view(),
      'lane',
    );
    return model?.visible ? model : null;
  });
  private readonly shown = computed(() => this.model() !== null);
  /** Menu state; resets when the cell hides, so it never reopens on its own when the cell comes back. */
  protected readonly open = linkedSignal<boolean, boolean>({
    source: this.shown,
    computation: () => false,
  });
  /** Set before the first await; a repeat activation is ignored while true. */
  protected readonly saving = signal(false);

  constructor() {
    // State contract 1: one list read and one cached ambient read per mount.
    void this.accounts?.open('claude');
    void this.ambient?.read(false);
  }

  protected toggle(): void {
    if (this.saving()) return;
    this.open.update((open) => !open);
  }

  /** Roving tabindex: the checked item takes focus when the menu opens. */
  protected focusChecked(): void {
    const items = this.items();
    (items.find((item) => item.tabIndex === 0) ?? items[0])?.focus();
  }

  protected closeToTrigger(): void {
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }

  protected onMenuKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        // P6-A7: Tab and Shift+Tab close too; the panel sits in the top layer, where native Tab order is undefined.
        event.preventDefault();
        event.stopPropagation();
        this.closeToTrigger();
        return;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        event.preventDefault();
        this.moveFocus(event.key);
        return;
      case 'Enter':
      case ' ': {
        const option = this.optionOf(event.target);
        if (!option) return;
        event.preventDefault();
        this.choose(option);
        return;
      }
    }
  }

  /** Commits an enabled item other than the stored value; anything else does nothing (P6-5). */
  protected choose(option: AccountSelectorOption): void {
    const model = this.model();
    if (!model || this.saving() || option.disabled) return;
    if (option.value === model.value) return;
    const choice = accountChoiceOf(option.value);
    if (!choice) return;
    void this.commit(choice);
  }

  private async commit(choice: ProviderAccountChoice): Promise<void> {
    if (!this.accounts) return;
    this.saving.set(true);
    // The trigger is the waiting target (B-2): focus it before the write; the result never moves focus.
    this.closeToTrigger();
    try {
      const outcome = await this.accounts.setSelection('claude', 'lane', choice);
      // D60: a `null` (a saved snapshot naming an unlisted profile) has nothing honest to say, so no toast.
      const message = selectionFeedback(outcome, 'lane', {
        providerSaved: false,
      });
      if (message) this.feedback.announce(message.message, message.tone);
    } finally {
      this.saving.set(false);
    }
  }

  private items(): HTMLButtonElement[] {
    return Array.from(
      // The top-layer panel stays a DOM descendant of this host (showPopover does not move it).
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[role="menu"] [role="menuitemradio"]',
      ),
    );
  }

  private optionOf(target: EventTarget | null): AccountSelectorOption | null {
    if (!(target instanceof HTMLElement)) return null;
    if (target.getAttribute('role') !== 'menuitemradio') return null;
    const value = target.getAttribute('data-value');
    return this.model()?.options.find((option) => option.value === value) ?? null;
  }

  private moveFocus(key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): void {
    const items = this.items();
    if (items.length === 0) return;
    const current = items.indexOf(
      this.host.nativeElement.ownerDocument.activeElement as HTMLButtonElement,
    );
    const last = items.length - 1;
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? last
          : key === 'ArrowDown'
            ? current < 0 || current === last
              ? 0
              : current + 1
            : current <= 0
              ? last
              : current - 1;
    items[next].focus();
  }
}
