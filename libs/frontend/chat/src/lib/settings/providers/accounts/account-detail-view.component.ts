import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { ProviderAccountActionKind } from '@ptah-extension/core';
import {
  PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountOperation,
  type ProviderAccountSignInFallback,
  type ProviderAccountState,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import { NativeModalComponent } from '@ptah-extension/ui';
import { AlertTriangle, Copy, Lock, LucideAngularModule } from 'lucide-angular';
import { SettingsBusyDisabledDirective } from '../../feedback/busy-disabled.directive';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';
import {
  ACCOUNT_COPY,
  ATTENTION_STATES,
  STATE_LABEL,
  accountInitial,
  validateAccountName,
} from './account-presentation';

/** A name change for one account. */
export interface AccountRenameRequest {
  readonly profileId: string;
  readonly label: string;
}

/** Design capability map "Pending completion instruction": the state word of a pending sign-in. */
const PENDING_WORD = 'Waiting for Claude window';

/** Dot ink per state; status is always dot + word. */
const STATE_DOT: Readonly<Record<ProviderAccountState, string>> = {
  'not-signed-in': 'bg-state-idle',
  pending: 'bg-state-run',
  cancelled: 'bg-state-idle',
  failed: 'bg-state-err',
  disconnected: 'bg-state-err',
  'signed-in': 'bg-state-done',
  'signed-out': 'bg-state-idle',
};

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

const LOCK_REASON_ID = 'account-detail-lock-reason';

/**
 * Account detail, one flat panel (TASK_2026_719 plan P6 component 7, design-spec-p6 "Detail").
 *
 * Presentational: it renders one authoritative `ProviderAccountSummary` and emits intents; the parent (Accounts tab)
 * writes them, announces every host outcome and owns B-2 focus after a write. This panel announces only its own
 * synchronous results (copy, rename validation) through `SettingsSaveFeedbackService.announce` (P6-A9). It has no
 * live line and no helper sentences: the state word, badges, `title` and `sr-only` text carry the meaning (D52-D54).
 * Busy controls use `ptahBusyDisabled`, so focus never drops to `body`. Names and scripts are text bindings only.
 */
@Component({
  selector: 'ptah-account-detail-view',
  standalone: true,
  imports: [NativeModalComponent, LucideAngularModule, SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6 text-sm text-base-content" data-testid="account-detail" (focusin)="noteFocus($event)">
      <div class="space-y-3">
        <button
          type="button"
          [class]="'btn btn-ghost btn-sm min-h-8 px-2 ' + focusRing"
          (click)="back.emit()"
          data-testid="account-detail-back"
        >
          <span aria-hidden="true">←</span> Accounts
        </button>
        <div
          class="flex min-w-0 items-start gap-3"
          [class.border-l-4]="attention()"
          [class.border-l-state-err]="attention()"
          [class.pl-3]="attention()"
        >
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-300 font-bold"
            aria-hidden="true"
          >{{ initial() }}</span>
          <div class="min-w-0 flex-1 space-y-1">
            <h3
              #heading
              tabindex="-1"
              class="truncate text-[15px] font-semibold outline-none"
              [attr.title]="account().label"
              data-testid="account-detail-heading"
            >{{ account().label }}</h3>
            <div class="flex flex-wrap items-center gap-2">
              <span class="flex items-center" data-testid="account-detail-state">
                @if (account().state === 'pending') {
                  <span
                    class="mr-1.5 inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-base-content-muted border-t-base-content motion-reduce:animate-none"
                    aria-hidden="true"
                  ></span>
                } @else {
                  <span [class]="'mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full ' + stateDot()" aria-hidden="true"></span>
                }
                <span>{{ stateWord() }}</span>
              </span>
              @if (account().activeRunCount > 0) {
                <span class="badge badge-ghost badge-sm" data-testid="account-detail-runs">{{ account().activeRunCount }} running</span>
              }
              @if (resumeUnavailable()) {
                <span
                  class="badge badge-ghost badge-sm gap-1"
                  [attr.title]="copy.resumeUnavailable"
                  data-testid="account-detail-resume-unavailable"
                >
                  <lucide-angular [img]="AlertTriangleIcon" class="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
                  <span aria-hidden="true">Cannot resume</span>
                  <span class="sr-only">{{ copy.resumeUnavailable }}</span>
                </span>
              }
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex flex-wrap gap-2">
          @switch (account().state) {
            @case ('signed-in') {
              <button type="button" [class]="'btn btn-outline btn-error btn-sm min-h-8 ' + focusRing" [ptahBusyDisabled]="busyNow()" (click)="act('sign-out')" data-testid="account-detail-sign-out">Sign out</button>
            }
            @case ('pending') {
              <button type="button" [class]="'btn btn-outline btn-sm min-h-8 ' + focusRing" [ptahBusyDisabled]="busyNow()" (click)="act('cancel-sign-in')" data-pending-control data-testid="account-detail-cancel-sign-in">Cancel sign-in</button>
            }
            @default {
              <button type="button" [class]="'btn btn-primary btn-sm min-h-8 ' + focusRing" [ptahBusyDisabled]="busyNow()" (click)="act('sign-in')" data-testid="account-detail-sign-in">{{ account().state === 'failed' ? 'Try again' : 'Sign in' }}</button>
            }
          }
          <button type="button" [class]="'btn btn-ghost btn-sm min-h-8 ' + focusRing" [ptahBusyDisabled]="busyNow()" (click)="act('check-status')" data-testid="account-detail-check-status">Check status</button>
          @if (fallbackShown()) {
            <button
              type="button"
              [class]="'btn btn-ghost btn-sm min-h-8 ' + focusRing"
              [attr.aria-expanded]="terminalOpen()"
              aria-controls="account-detail-terminal"
              (click)="terminalOpen.set(!terminalOpen())"
              data-pending-control
              data-testid="account-detail-terminal-toggle"
            >Use terminal</button>
          }
        </div>
        @if (fallbackShown(); as f) {
          @if (terminalOpen()) {
            <div id="account-detail-terminal" class="flex items-start gap-2" data-testid="account-detail-fallback">
              <pre
                tabindex="0"
                aria-label="Sign-in script"
                data-pending-control
                [class]="'max-h-40 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-box border border-base-300 bg-base-100 p-2 font-mono text-xs text-base-content ' + focusRing"
                data-testid="account-detail-fallback-script"
              >{{ f.script }}</pre>
              <button
                type="button"
                [class]="'btn btn-ghost btn-sm h-8 min-h-8 w-8 shrink-0 p-0 ' + focusRing"
                aria-label="Copy script"
                title="Copy script"
                (click)="copyScript(f.script)"
                data-pending-control
                data-testid="account-detail-copy-script"
              >
                <lucide-angular [img]="CopyIcon" class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          }
        }
      </div>

      <form class="space-y-2" (submit)="$event.preventDefault(); submitRename()">
        <label for="account-detail-name" class="flex items-center gap-1 font-semibold">
          Name
          @if (pending()) {
            <span class="inline-flex" [attr.title]="copy.signInLocked" data-testid="account-detail-locked">
              <lucide-angular [img]="LockIcon" class="h-3.5 w-3.5 text-base-content-muted" aria-hidden="true" />
            </span>
          }
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <input
            #nameInput
            id="account-detail-name"
            type="text"
            [class]="'input input-bordered input-sm min-h-8 min-w-0 flex-1 text-sm text-base-content ' + focusRing"
            [value]="draftLabel()"
            (input)="onDraft($event)"
            autocomplete="off"
            [attr.maxlength]="maxLength"
            [ptahBusyDisabled]="locked()"
            [attr.aria-describedby]="pending() ? lockReasonId : null"
            data-testid="account-detail-rename-input"
          />
          @if (edited()) {
            <button type="submit" [class]="'btn btn-primary btn-sm min-h-8 ' + focusRing" [ptahBusyDisabled]="locked()" data-testid="account-detail-rename-submit">Save</button>
          }
        </div>
      </form>

      <div>
        <button
          #removeButton
          type="button"
          [class]="'btn btn-outline btn-error btn-sm min-h-8 ' + focusRing"
          [ptahBusyDisabled]="locked()"
          [attr.aria-describedby]="pending() ? lockReasonId : null"
          (click)="askRemove()"
          data-testid="account-detail-remove"
        >Remove account</button>
      </div>

      @if (pending()) {
        <span [id]="lockReasonId" class="sr-only">{{ copy.signInLocked }}</span>
      }

      <ptah-native-modal
        [isOpen]="confirmingRemove()"
        ariaLabelledby="account-detail-remove-title"
        size="sm"
        (closed)="cancelRemove()"
      >
        <h3 modal-header id="account-detail-remove-title" class="text-sm font-bold text-base-content">Remove {{ account().label }}?</h3>
        <div modal-footer class="mt-4 flex justify-end gap-2">
          <button #removeCancel type="button" [class]="'btn btn-sm min-h-8 ' + focusRing" (click)="cancelRemove()" data-testid="account-detail-remove-cancel">Cancel</button>
          <button type="button" [class]="'btn btn-error btn-sm min-h-8 ' + focusRing" [ptahBusyDisabled]="locked()" (click)="confirmRemove()" data-testid="account-detail-remove-confirm">Remove</button>
        </div>
      </ptah-native-modal>
    </div>
  `,
})
export class AccountDetailViewComponent {
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly clipboard = inject(Clipboard);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  /** The authoritative summary from the latest host snapshot. */
  readonly account = input.required<ProviderAccountSummary>();
  /** Every named account, for the rename uniqueness rule. */
  readonly accounts = input<readonly ProviderAccountSummary[]>([]);
  /** This account's sign-in/out handle; the fallback script belongs to its `sign-in` operation only. */
  readonly operation = input<ProviderAccountOperation | null>(null);
  /** The host's manual sign-in script for this account's pending sign-in. */
  readonly fallback = input<ProviderAccountSignInFallback | null>(null);
  /** The action of this account in flight, if any. */
  readonly busy = input<ProviderAccountActionKind | null>(null);

  readonly back = output<void>();
  readonly signIn = output<string>();
  /** Explicit Cancel only; leaving the view never emits it. */
  readonly cancelSignIn = output<string>();
  readonly signOut = output<string>();
  readonly checkStatus = output<string>();
  readonly rename = output<AccountRenameRequest>();
  /** Emitted only after the confirmation dialog. Nothing is reassigned locally (B-1). */
  readonly remove = output<string>();

  protected readonly copy = ACCOUNT_COPY;
  protected readonly focusRing = FOCUS;
  protected readonly maxLength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH;
  protected readonly lockReasonId = LOCK_REASON_ID;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly CopyIcon = Copy;
  protected readonly LockIcon = Lock;

  protected readonly draftLabel = signal('');
  protected readonly confirmingRemove = signal(false);
  protected readonly terminalOpen = signal(false);

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly removeButton = viewChild<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly removeCancel = viewChild<ElementRef<HTMLButtonElement>>('removeCancel');

  private readonly committedLabel = computed(() => this.account().label);
  protected readonly busyNow = computed(() => this.busy() !== null);
  protected readonly pending = computed(() => this.account().state === 'pending');
  /** A pending sign-in holds name and removal; any action in flight holds everything. */
  protected readonly locked = computed(() => this.busyNow() || this.pending());
  protected readonly initial = computed(() => accountInitial(this.account().label));
  protected readonly attention = computed(() => ATTENTION_STATES.has(this.account().state));
  protected readonly stateDot = computed(() => STATE_DOT[this.account().state]);
  protected readonly stateWord = computed(() =>
    this.pending() ? PENDING_WORD : STATE_LABEL[this.account().state],
  );
  protected readonly resumeUnavailable = computed(
    () => this.account().activeRunCount > 0 && this.account().state !== 'signed-in',
  );
  /** The script exists only for this account's pending `sign-in` operation (the service drops it otherwise). */
  protected readonly fallbackShown = computed(() => {
    const fallback = this.fallback();
    return this.pending() &&
      this.operation()?.kind === 'sign-in' &&
      fallback !== null &&
      fallback.script.trim().length > 0
      ? fallback
      : null;
  });
  /** `Save` appears only once the name differs from the committed one (a case-only change counts). */
  protected readonly edited = computed(() => {
    const draft = this.draftLabel().trim();
    return draft.length > 0 && draft !== this.account().label;
  });

  private shownProfileId: string | null = null;
  /** The account and pending flag of the last render, to see a pending sign-in end. */
  private pendingSeen: { readonly profileId: string; readonly pending: boolean } | null = null;
  /** The last element inside this panel that took focus. */
  private lastFocus: Element | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // B-2: a push that ends the pending sign-in removes Cancel and the fallback controls. If one of them held focus
    // and focus fell to the body, the heading takes it; focus the user moved elsewhere is left alone.
    effect(() => {
      const profileId = this.account().profileId;
      const pending = this.pending();
      untracked(() => {
        const before = this.pendingSeen;
        this.pendingSeen = { profileId, pending };
        if (before?.profileId === profileId && before.pending && !pending) this.repairPendingFocus();
      });
    });
    // A different account starts closed and with its committed name; focus goes to the heading.
    effect(() => {
      const account = this.account();
      untracked(() => {
        if (account.profileId === this.shownProfileId) return;
        this.shownProfileId = account.profileId;
        this.draftLabel.set(account.label);
        this.confirmingRemove.set(false);
        this.terminalOpen.set(false);
        afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
      });
    });
    // A committed rename resets the field; an unrelated snapshot does not touch the draft.
    effect(() => {
      const label = this.committedLabel();
      untracked(() => this.draftLabel.set(label));
    });
    // The disclosure closes with its script (sign-in finished, cancelled or failed).
    effect(() => {
      if (this.fallbackShown() === null) untracked(() => this.terminalOpen.set(false));
    });
  }

  protected act(action: 'sign-in' | 'cancel-sign-in' | 'sign-out' | 'check-status'): void {
    if (this.busyNow()) return;
    const profileId = this.account().profileId;
    switch (action) {
      case 'sign-in':
        this.signIn.emit(profileId);
        break;
      case 'cancel-sign-in':
        this.cancelSignIn.emit(profileId);
        break;
      case 'sign-out':
        this.signOut.emit(profileId);
        break;
      case 'check-status':
        this.checkStatus.emit(profileId);
        break;
    }
  }

  protected onDraft(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.draftLabel.set(event.target.value);
  }

  /** The value is re-read and re-validated at submit; an invalid name is announced as an alert (P6-A9, D60). */
  protected submitRename(): void {
    if (this.locked() || !this.edited()) return;
    const check = validateAccountName(this.draftLabel(), this.accounts(), this.account().profileId);
    if (!check.ok) {
      if (check.message !== null) {
        const message =
          check.message === PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY ? ACCOUNT_COPY.nameTaken : check.message;
        this.feedback.announce(message, 'alert');
      }
      return;
    }
    this.rename.emit({ profileId: this.account().profileId, label: check.label });
  }

  protected askRemove(): void {
    if (this.locked()) return;
    this.confirmingRemove.set(true);
    afterNextRender(() => this.removeCancel()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Cancel, Escape or the backdrop: only the dialog closes; focus returns to "Remove account". */
  protected cancelRemove(): void {
    if (!this.confirmingRemove()) return;
    this.confirmingRemove.set(false);
    afterNextRender(() => this.removeButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Focus after the write belongs to the parent (B-2: `Accounts` heading when this view goes). */
  protected confirmRemove(): void {
    if (this.locked()) return;
    this.confirmingRemove.set(false);
    this.remove.emit(this.account().profileId);
  }

  protected noteFocus(event: FocusEvent): void {
    this.lastFocus = event.target instanceof Element ? event.target : null;
  }

  /**
   * Runs when this account's sign-in stops being pending. Only a pending control (Cancel, Use terminal, the script or
   * Copy) that still held focus counts; after the next render, if it is gone and focus is on the body, the heading
   * takes focus. Destroyed (navigated away) or focus moved elsewhere: nothing happens.
   */
  private repairPendingFocus(): void {
    const held = this.lastFocus;
    if (!held?.hasAttribute('data-pending-control')) return;
    // The render that removes the control may not have happened yet: then focus must still be on it.
    if (held.isConnected && this.document.activeElement !== held) return;
    afterNextRender(
      () => {
        if (this.destroyed || held.isConnected) return;
        const active = this.document.activeElement;
        if (active !== null && active !== this.document.body) return;
        this.heading().nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  /** Copies the script text only; the script is never logged. */
  protected copyScript(script: string): void {
    if (this.clipboard.copy(script)) this.feedback.announce(ACCOUNT_COPY.copied, 'status');
    else this.feedback.announce(ACCOUNT_COPY.copyFailed, 'alert');
  }
}
