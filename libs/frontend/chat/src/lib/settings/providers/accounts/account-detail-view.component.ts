import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { ProviderAccountActionKind } from '@ptah-extension/core';
import {
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
  type ProviderAccountOperation,
  type ProviderAccountSignInFallback,
  type ProviderAccountState,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import { NativeModalComponent } from '@ptah-extension/ui';
import { STATE_LABEL, validateAccountName } from './account-presentation';

export type AccountDetailTab = 'overview' | 'access' | 'profile';

/** A name change for one account. */
export interface AccountRenameRequest {
  readonly profileId: string;
  readonly label: string;
}

/** Design §3.5: the rename result in the live status. */
export const ACCOUNT_NAME_SAVED = 'Name saved.';
/** Design §3.7: the existing unconfirmed-write warning (state-service wording), for the parent to pass as feedback. */
export const ACCOUNT_UNCONFIRMED_WARNING = 'This action may not have completed. Accounts were reloaded.';
/** Design §3.6 neutral unavailable result (a `release-held` refusal). */
export const ACCOUNT_STATUS_UNAVAILABLE = 'The status is not available right now.';

const WORKING = 'Working…';
const FALLBACK_ERROR = 'This action did not complete. Refresh and try again.';

const TABS: readonly { readonly id: AccountDetailTab; readonly label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'access', label: 'Access' },
  { id: 'profile', label: 'Profile' },
];

/** Dot ink per state (design §3.3); status is always dot + text. */
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

/**
 * In-drawer account detail (design §3.6, plan §11), reworked from `account-details-drawer` without its drawer
 * wrapper. Presentational: it renders one authoritative `ProviderAccountSummary` and emits intents; the parent
 * writes them through the account state owner. No profile id, owner or identity is shown, and "Set as default"
 * is not offered (D39.4, D40.2, D40.3). Names and scripts are text bindings only.
 *
 * Busy rule §3.7 (b) and binding rule B-2: while `busy` is set every action of this account is disabled. Before
 * a clicked action is disabled, focus moves to the live status (`tabindex=-1`, "Working…"). When `busy` clears,
 * focus returns to the originating control (or, when the new state replaced it, the first enabled action of the
 * panel) only if focus is still on the live status and the view is still attached; otherwise focus stays and the
 * live status announces the result.
 */
@Component({
  selector: 'ptah-account-detail-view',
  standalone: true,
  imports: [NativeModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3 text-xs text-base-content" data-testid="account-detail">
      <div class="space-y-1">
        <button
          type="button"
          [class]="'btn btn-ghost btn-sm min-h-[30px] px-2 ' + focusRing"
          (click)="back.emit()"
          data-testid="account-detail-back"
        >
          <span aria-hidden="true">←</span> All accounts
        </button>
        <h3
          #heading
          tabindex="-1"
          class="break-words text-base font-bold outline-none"
          data-testid="account-detail-heading"
        >{{ account().label }}</h3>
        <p class="flex items-center" data-testid="account-detail-state">
          <span [class]="'mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full ' + stateDot()" aria-hidden="true"></span>
          <span>{{ stateLabel() }}</span>
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Account sections"
        class="tabs tabs-bordered flex flex-wrap"
        data-testid="account-detail-tablist"
        (keydown)="onTabKeydown($event)"
      >
        @for (tab of tabs; track tab.id) {
          <button
            #tabButton
            type="button"
            role="tab"
            [id]="'account-detail-tab-' + tab.id"
            [class]="'tab min-h-[30px] ' + focusRing"
            [class.tab-active]="activeTab() === tab.id"
            [attr.aria-selected]="activeTab() === tab.id"
            [attr.aria-controls]="'account-detail-panel-' + tab.id"
            [attr.tabindex]="activeTab() === tab.id ? 0 : -1"
            [attr.data-testid]="'account-detail-tab-' + tab.id"
            (click)="selectTab(tab.id)"
          >
            {{ tab.label }}
          </button>
        }
      </div>

      <p
        #live
        class="min-h-4 outline-none"
        role="status"
        aria-live="polite"
        tabindex="-1"
        data-testid="account-detail-live"
      >{{ liveText() }}</p>

      @if (refusalText(); as message) {
        @if (held()) {
          <div class="space-y-1 rounded-box border border-base-300 p-3" role="alert" data-testid="account-detail-held">
            <p class="font-semibold">{{ statusUnavailable }}</p>
            <p>{{ message }}</p>
          </div>
        } @else {
          <p
            class="rounded-box border border-base-300 border-l-4 border-l-state-err p-3"
            role="alert"
            data-testid="account-detail-refusal"
          >{{ message }}</p>
        }
      }

      <section
        #panel
        [id]="'account-detail-panel-' + activeTab()"
        role="tabpanel"
        [attr.aria-labelledby]="'account-detail-tab-' + activeTab()"
        class="space-y-3"
        [attr.data-testid]="'account-detail-panel-' + activeTab()"
      >
        @switch (activeTab()) {
          @case ('overview') {
            <dl>
              <dt class="text-base-content-muted">State</dt>
              <dd data-testid="account-detail-overview-state">{{ stateLabel() }}</dd>
            </dl>
            <div class="space-y-1">
              <h4 class="font-semibold">Running now</h4>
              @if (account().activeRunCount > 0) {
                <p data-testid="account-detail-runs">{{ runsText() }}</p>
              } @else {
                <p class="text-base-content-muted" data-testid="account-detail-no-runs">No runs are bound to this account.</p>
              }
            </div>
            @if (account().activeRunCount > 0 && account().state !== 'signed-in') {
              <div class="space-y-1 rounded-box border border-base-300 p-3" data-testid="account-detail-resume-unavailable">
                <p class="font-semibold">Resume unavailable</p>
                <p>Runs bound to this account cannot resume until it is signed in again.</p>
              </div>
            }
          }
          @case ('access') {
            @switch (account().state) {
              @case ('signed-in') {
                <p data-testid="account-detail-access-copy">Signed in. Credentials stay on this computer and are never shown here.</p>
              }
              @case ('pending') {
                @if (fallbackShown(); as f) {
                  <div
                    role="group"
                    aria-labelledby="account-detail-fallback-title"
                    class="space-y-2 rounded-box border border-base-300 p-3"
                    data-testid="account-detail-fallback"
                  >
                    <p id="account-detail-fallback-title" class="font-semibold">Sign in from a terminal</p>
                    <p class="text-base-content-muted">
                      The Claude window could not open. Run this in a new terminal window, finish sign-in there, then check status.
                    </p>
                    <pre
                      tabindex="0"
                      role="region"
                      aria-label="Sign-in script"
                      [class]="'max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-box border border-base-300 bg-base-100 p-2 font-mono text-xs text-base-content ' + focusRing"
                      data-testid="account-detail-fallback-script"
                    >{{ f.script }}</pre>
                    <button
                      type="button"
                      [class]="'btn btn-outline btn-sm min-h-[30px] ' + focusRing"
                      (click)="copyScript(f.script)"
                      data-testid="account-detail-copy-script"
                    >{{ copyLabel() }}</button>
                    <p class="min-h-4 text-base-content-muted" role="status" aria-live="polite" data-testid="account-detail-copy-status">{{ copyStatus() }}</p>
                  </div>
                } @else {
                  <div class="flex items-start rounded-box border border-base-300 p-3" role="status" data-testid="account-detail-pending">
                    <span
                      class="mr-2 mt-0.5 inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-base-content-muted border-t-base-content motion-reduce:animate-none"
                      aria-hidden="true"
                    ></span>
                    <div>
                      <p class="font-semibold">Finish sign-in in the Claude window</p>
                      <p class="text-base-content-muted">Waiting for you. This page updates when you are done.</p>
                    </div>
                  </div>
                }
              }
              @case ('failed') {
                <div class="space-y-1 rounded-box border border-base-300 border-l-4 border-l-state-err p-3" role="alert" data-testid="account-detail-access-copy">
                  <p class="font-semibold">Sign-in did not finish</p>
                  <p>The host did not complete the sign-in.</p>
                </div>
              }
              @case ('cancelled') {
                <p data-testid="account-detail-access-copy">Sign-in was cancelled. The account is still saved but not signed in.</p>
              }
              @case ('disconnected') {
                <p class="rounded-box border border-base-300 border-l-4 border-l-state-err p-3" role="alert" data-testid="account-detail-access-copy">
                  This account was disconnected. Sign in again to use it.
                </p>
              }
              @default {
                <p data-testid="account-detail-access-copy">This account is not signed in yet.</p>
              }
            }
            <div class="flex flex-wrap gap-2">
              @switch (account().state) {
                @case ('signed-in') {
                  <button type="button" data-action="sign-out" [class]="'btn btn-error btn-outline btn-sm min-h-[30px] ' + focusRing" [disabled]="busyNow()" (click)="act('sign-out')" data-testid="account-detail-sign-out">Sign out</button>
                }
                @case ('pending') {
                  <button type="button" data-action="cancel-sign-in" [class]="'btn btn-outline btn-sm min-h-[30px] ' + focusRing" [disabled]="busyNow()" (click)="act('cancel-sign-in')" data-testid="account-detail-cancel-sign-in">Cancel sign-in</button>
                }
                @default {
                  <button type="button" data-action="sign-in" [class]="'btn btn-primary btn-sm min-h-[30px] ' + focusRing" [disabled]="busyNow()" (click)="act('sign-in')" data-testid="account-detail-sign-in">{{ account().state === 'failed' ? 'Try again' : 'Sign in' }}</button>
                }
              }
              <button type="button" data-action="check-status" [class]="'btn btn-ghost btn-sm min-h-[30px] ' + focusRing" [disabled]="busyNow()" (click)="act('check-status')" data-testid="account-detail-check-status">Check status</button>
            </div>
          }
          @case ('profile') {
            @if (account().state === 'pending') {
              <p class="text-base-content-muted" data-testid="account-detail-locked">
                Sign-in is in progress. Name and removal are locked until it finishes or is cancelled.
              </p>
            }
            <form class="space-y-2" (submit)="$event.preventDefault(); submitRename()" data-testid="account-detail-rename-form">
              <label for="account-detail-name" class="block font-semibold">Account name</label>
              <input
                id="account-detail-name"
                type="text"
                data-action="rename-input"
                [class]="'input input-bordered input-sm w-full text-xs text-base-content ' + focusRing"
                [value]="draftLabel()"
                (input)="onDraft($event)"
                autocomplete="off"
                [attr.maxlength]="maxLength"
                [disabled]="locked()"
                [attr.aria-invalid]="renameError() !== null"
                [attr.aria-describedby]="renameError() !== null ? 'account-detail-name-hint account-detail-name-error' : 'account-detail-name-hint'"
                data-testid="account-detail-rename-input"
              />
              <p id="account-detail-name-hint" class="text-base-content-muted">Only you see this name. Each name must be different.</p>
              @if (renameError(); as error) {
                <p id="account-detail-name-error" role="alert" data-testid="account-detail-rename-error">{{ error }}</p>
              }
              <button type="submit" data-action="rename" [class]="'btn btn-primary btn-sm min-h-[30px] ' + focusRing" [disabled]="!canRename()" data-testid="account-detail-rename-submit">Save name</button>
            </form>
            <div class="space-y-1">
              <h4 class="font-semibold">Remove account</h4>
              <p class="text-base-content-muted">Removes this account from Ptah. Running work is not changed.</p>
              <button
                #removeButton
                type="button"
                data-action="remove"
                [class]="'btn btn-error btn-outline btn-sm min-h-[30px] ' + focusRing"
                [disabled]="locked()"
                (click)="askRemove()"
                data-testid="account-detail-remove"
              >Remove account</button>
            </div>
          }
        }
      </section>

      <ptah-native-modal
        [isOpen]="confirmingRemove()"
        ariaLabelledby="account-detail-remove-title"
        size="sm"
        (closed)="cancelRemove()"
      >
        <h3 modal-header id="account-detail-remove-title" class="text-sm font-bold text-base-content">Remove {{ account().label }}?</h3>
        <p class="mt-2 text-xs text-base-content" data-testid="account-detail-remove-copy">
          This removes the account from Ptah. Running work is not changed. You can add it again later and sign in again.
        </p>
        <div modal-footer class="mt-4 flex justify-end gap-2">
          <button #removeCancel type="button" [class]="'btn btn-sm min-h-[30px] ' + focusRing" (click)="cancelRemove()" data-testid="account-detail-remove-cancel">Cancel</button>
          <button type="button" [class]="'btn btn-error btn-sm min-h-[30px] ' + focusRing" [disabled]="locked()" (click)="confirmRemove()" data-testid="account-detail-remove-confirm">Remove</button>
        </div>
      </ptah-native-modal>
    </div>
  `,
})
export class AccountDetailViewComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(Clipboard);

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
  /** Refusal of this account's last action; only its safe sentence is shown. */
  readonly refusal = input<ProviderAccountActionResult | null>(null);
  /** Polite outcome text from the parent (for example `ACCOUNT_NAME_SAVED`). */
  readonly feedback = input<string | null>(null);
  /** Tab to open on; `null` = Access unless the account is signed in (D39.3). */
  readonly initialTab = input<AccountDetailTab | null>(null);

  readonly back = output<void>();
  readonly signIn = output<string>();
  /** Explicit Cancel only; leaving the view never emits it. */
  readonly cancelSignIn = output<string>();
  readonly signOut = output<string>();
  readonly checkStatus = output<string>();
  readonly rename = output<AccountRenameRequest>();
  /** Emitted only after the confirmation dialog. Nothing is reassigned locally (B-1). */
  readonly remove = output<string>();

  protected readonly tabs = TABS;
  protected readonly focusRing = FOCUS;
  protected readonly maxLength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH;
  protected readonly statusUnavailable = ACCOUNT_STATUS_UNAVAILABLE;

  protected readonly activeTab = signal<AccountDetailTab>('access');
  protected readonly draftLabel = signal('');
  protected readonly confirmingRemove = signal(false);
  private readonly copied = signal<{ readonly script: string; readonly ok: boolean } | null>(null);
  /** `data-action` of the control whose action is awaited (B-2 waiting target), or null. */
  private readonly waitingFor = signal<string | null>(null);

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly live = viewChild.required<ElementRef<HTMLElement>>('live');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');
  private readonly removeButton = viewChild<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly removeCancel = viewChild<ElementRef<HTMLButtonElement>>('removeCancel');

  private readonly committedLabel = computed(() => this.account().label);
  protected readonly busyNow = computed(() => this.busy() !== null);
  /** A pending sign-in holds name and removal; any action in flight holds everything. */
  protected readonly locked = computed(() => this.busyNow() || this.account().state === 'pending');
  protected readonly stateLabel = computed(() => STATE_LABEL[this.account().state]);
  protected readonly stateDot = computed(() => STATE_DOT[this.account().state]);
  protected readonly runsText = computed(() => {
    const count = this.account().activeRunCount;
    const runs = count === 1 ? '1 active run uses' : `${count} active runs use`;
    return `${runs} this account. Signing out or removing it does not change running work. Resuming those runs may be unavailable.`;
  });
  protected readonly fallbackShown = computed(() => {
    const fallback = this.fallback();
    return this.account().state === 'pending' &&
      this.operation()?.kind === 'sign-in' &&
      fallback !== null &&
      fallback.script.trim().length > 0
      ? fallback
      : null;
  });
  private readonly copyOutcome = computed(() => {
    const copied = this.copied();
    return copied !== null && copied.script === this.fallbackShown()?.script ? copied : null;
  });
  protected readonly copyLabel = computed(() => (this.copyOutcome()?.ok ? 'Copied' : 'Copy script'));
  protected readonly copyStatus = computed(() => {
    const outcome = this.copyOutcome();
    if (outcome === null) return '';
    return outcome.ok ? 'Copied' : 'Could not copy. Select the script and copy it manually.';
  });
  protected readonly held = computed(() => this.refusal()?.code === 'release-held');
  protected readonly refusalText = computed(() => {
    const refusal = this.refusal();
    if (refusal === null || this.busyNow()) return null;
    if (isSafeProviderAccountSummary(refusal.summary)) return refusal.summary;
    return refusal.code === 'release-held' ? 'Named accounts are not available on this host.' : FALLBACK_ERROR;
  });
  protected readonly liveText = computed(() => (this.busyNow() ? WORKING : (this.feedback() ?? '')));
  private readonly nameCheck = computed(() =>
    validateAccountName(this.draftLabel(), this.accounts(), this.account().profileId),
  );
  protected readonly renameError = computed(() => {
    const check = this.nameCheck();
    return check.ok ? null : check.message;
  });
  protected readonly canRename = computed(() => {
    const check = this.nameCheck();
    return !this.locked() && check.ok && check.label !== this.account().label;
  });

  private shownProfileId: string | null = null;

  constructor() {
    // A different account starts on its initial tab with the committed name; focus goes to the heading.
    effect(() => {
      const account = this.account();
      const initial = this.initialTab();
      untracked(() => {
        if (account.profileId === this.shownProfileId) return;
        this.shownProfileId = account.profileId;
        this.activeTab.set(initial ?? (account.state === 'signed-in' ? 'overview' : 'access'));
        this.draftLabel.set(account.label);
        this.confirmingRemove.set(false);
        this.waitingFor.set(null);
        afterNextRender(() => this.heading().nativeElement.focus(), { injector: this.injector });
      });
    });
    // A committed rename resets the field; an unrelated snapshot does not touch the draft.
    effect(() => {
      const label = this.committedLabel();
      untracked(() => this.draftLabel.set(label));
    });
    // Busy rule (b) + B-2, after render so the returning control is already enabled.
    afterRenderEffect(() => {
      const busy = this.busyNow();
      const origin = this.waitingFor();
      const live = this.live().nativeElement;
      const active = this.document.activeElement;
      if (busy) {
        // An action started elsewhere while one of this account's actions held focus.
        if (active instanceof HTMLElement && active.dataset['action'] && this.isOwnDisabled(active)) {
          live.focus();
          if (origin === null) this.waitingFor.set(active.dataset['action'] ?? null);
        }
        return;
      }
      if (origin === null) return;
      this.waitingFor.set(null);
      if (active !== live || !live.isConnected) return;
      this.returnTarget(origin)?.focus();
    });
  }

  protected selectTab(tab: AccountDetailTab): void {
    this.activeTab.set(tab);
  }

  /** WAI-ARIA tabs: arrows wrap, Home and End; automatic activation. */
  protected onTabKeydown(event: KeyboardEvent): void {
    const current = TABS.findIndex((tab) => tab.id === this.activeTab());
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % TABS.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + TABS.length) % TABS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.selectTab(TABS[next].id);
    this.tabButtons()[next]?.nativeElement.focus();
  }

  protected act(action: 'sign-in' | 'cancel-sign-in' | 'sign-out' | 'check-status'): void {
    if (this.busyNow()) return;
    const profileId = this.account().profileId;
    this.awaitResult(action);
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

  /** The value is re-read and re-validated at submit. */
  protected submitRename(): void {
    const check = this.nameCheck();
    if (!this.canRename() || !check.ok) return;
    this.awaitResult('rename');
    this.rename.emit({ profileId: this.account().profileId, label: check.label });
  }

  protected askRemove(): void {
    if (this.locked()) return;
    this.confirmingRemove.set(true);
    afterNextRender(() => this.removeCancel()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Cancel, Escape or the backdrop: focus returns to "Remove account". */
  protected cancelRemove(): void {
    if (!this.confirmingRemove()) return;
    this.confirmingRemove.set(false);
    afterNextRender(() => this.removeButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected confirmRemove(): void {
    if (this.locked()) return;
    this.confirmingRemove.set(false);
    this.waitingFor.set('remove');
    // The dialog is inert until it closes, so the live status takes focus after the close render.
    afterNextRender(() => this.live().nativeElement.focus(), { injector: this.injector });
    this.remove.emit(this.account().profileId);
  }

  /** Copies the script text only; the script is never logged. */
  protected copyScript(script: string): void {
    this.copied.set({ script, ok: this.clipboard.copy(script) });
  }

  /** Focus leaves the control before the parent's write disables it (busy rule §3.7 c). */
  private awaitResult(action: string): void {
    this.live().nativeElement.focus();
    this.waitingFor.set(action);
  }

  private isOwnDisabled(element: HTMLElement): boolean {
    return (
      this.panel().nativeElement.contains(element) &&
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
      element.disabled
    );
  }

  /** The originating control, or its replacement: the first enabled action of the open panel. */
  private returnTarget(origin: string): HTMLElement | null {
    const panel = this.panel().nativeElement;
    const enabled = Array.from(panel.querySelectorAll<HTMLElement>('[data-action]')).filter(
      (element) => !(element instanceof HTMLButtonElement || element instanceof HTMLInputElement) || !element.disabled,
    );
    return enabled.find((element) => element.dataset['action'] === origin) ?? enabled[0] ?? null;
  }
}
