import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  Component,
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
  viewChildren,
} from '@angular/core';
import type { ProviderAccountActionKind } from '@ptah-extension/core';
import {
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  isSafeProviderAccountLabel,
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
  type ProviderAccountSignInFallback,
  type ProviderAccountState,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import { NativeDrawerComponent } from '@ptah-extension/ui';

/** A local-label change for one profile. */
export interface AccountRenameIntent {
  readonly profileId: string;
  readonly label: string;
}

export type AccountDrawerTab = 'overview' | 'access' | 'profile';

/** Design §3.6, exact. Shown once the parent reports the committed default. */
export const ACCOUNT_DEFAULT_TOAST =
  'Default changed for future unbound starts. Existing runs are unchanged.';
/** Design §3.6, exact. Metadata only: no file, credential or conversation is claimed deleted. */
export const ACCOUNT_REMOVE_CONFIRMATION =
  'This removes only local profile metadata. It does not switch, transfer, or delete a running conversation. A run bound to this profile cannot resume until its binding is available.';
/** Design §3.4, exact. */
export const ACCOUNT_RENAME_HINT =
  'Changes the local label only. Existing runs keep the profile ID they started with.';
/** U2: a pending sign-in whose Claude login window opened. */
export const ACCOUNT_PENDING_COPY = 'Finish sign-in in the Claude window.';
/** U3: a pending sign-in for which no login window could be opened. */
export const ACCOUNT_FALLBACK_COPY = 'Run it in a new terminal window.';
/** U3: replaces the U2 copy when the host reports that no login window opened. */
export const ACCOUNT_NO_WINDOW_COPY = 'No Claude window could be opened for this sign-in.';
/** D-D neutral copy for a `release-held` result whose own sentence is not safe to show. */
export const ACCOUNT_HELD_FALLBACK = 'Named accounts are not available on this host.';

const TABS: readonly { readonly id: AccountDrawerTab; readonly label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'access', label: 'Access' },
  { id: 'profile', label: 'Profile' },
];

/** Design §3.5 heading and prototype detail per state. Only `signed-in` is ever shown as signed in. */
const STATE_COPY: Readonly<
  Record<ProviderAccountState, { readonly heading: string; readonly detail: string }>
> = {
  'not-signed-in': { heading: 'Not signed in', detail: 'Sign in before using this profile.' },
  pending: { heading: 'Signing in', detail: ACCOUNT_PENDING_COPY },
  cancelled: { heading: 'Sign-in cancelled', detail: 'No changes were made to this profile.' },
  failed: { heading: 'Sign-in failed', detail: 'Couldn’t complete sign-in.' },
  disconnected: { heading: 'Disconnected', detail: 'This profile needs sign-in again.' },
  'signed-in': {
    heading: 'Signed in',
    detail:
      'This status is safe to show. No credential, account email, token, or directory is displayed.',
  },
  'signed-out': { heading: 'Signed out', detail: 'This profile was signed out.' },
};

/** Design §3.5 control for every state except `signed-in` (Sign out) and `pending` (Cancel). */
const SIGN_IN_LABEL: Readonly<Record<ProviderAccountState, string>> = {
  'not-signed-in': 'Sign in',
  pending: 'Sign in',
  cancelled: 'Sign in again',
  failed: 'Try again',
  disconnected: 'Sign in again',
  'signed-in': 'Sign in',
  'signed-out': 'Sign in again',
};

const PENDING_TEXT: Readonly<Record<ProviderAccountActionKind, string>> = {
  add: 'Adding profile…',
  rename: 'Saving local label…',
  remove: 'Removing local profile…',
  'sign-in': 'Starting sign-in…',
  'cancel-sign-in': 'Cancelling sign-in…',
  'sign-out': 'Signing out…',
  select: 'Saving selection…',
  default: 'Setting default…',
};

const FALLBACK_ERROR = 'This action did not complete. Refresh and try again.';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Account details drawer (design §3.4–§3.6, plan :251-255) on the shared `NativeDrawerComponent`, which owns the
 * focus trap, Escape/backdrop close request, opener focus return and the reduced-motion slide.
 *
 * Presentational: it renders one authoritative `ProviderAccountSummary` and emits intents (status, sign-in, cancel,
 * sign-out, rename, default, remove). It holds no account state and makes no RPC; the parent writes each intent
 * through the account state owner. Closing only emits `closed` — it never cancels a sign-in; Cancel is explicit.
 *
 * Only the active tab panel is rendered, so a hidden panel's controls can never join the drawer's Tab cycle.
 * Actions are not hidden after a `release-held` result: it is explained in place and the profile is unchanged.
 * A pending sign-in without a login window shows the host's manual script as plain text (never HTML, never logged). Only the safe profile ID, label, state and owner marker are shown — never a path, email,
 * organization or token.
 */
@Component({
  selector: 'ptah-account-details-drawer',
  standalone: true,
  imports: [NativeDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-drawer
      [isOpen]="isOpen()"
      [ariaLabel]="title()"
      widthClass="w-full max-w-md"
      (closed)="closed.emit()"
    >
      <h2 drawer-header class="truncate text-sm font-bold text-base-content" data-testid="account-drawer-title">
        {{ title() }}
      </h2>

      @if (account(); as a) {
        <div class="space-y-4 text-xs text-base-content" data-testid="account-drawer">
          <div role="tablist" aria-label="Account details sections" class="tabs tabs-bordered" (keydown)="onTabKeydown($event)">
            @for (tab of tabs; track tab.id) {
              <button
                #tabButton
                type="button"
                role="tab"
                [id]="'account-tab-' + tab.id"
                [class]="'tab ' + focusRing"
                [class.tab-active]="activeTab() === tab.id"
                [attr.aria-selected]="activeTab() === tab.id"
                [attr.aria-controls]="'account-panel-' + tab.id"
                [attr.tabindex]="activeTab() === tab.id ? 0 : -1"
                [attr.data-testid]="'account-tab-' + tab.id"
                (click)="selectTab(tab.id)"
              >
                {{ tab.label }}
              </button>
            }
          </div>

          <p class="min-h-4" role="status" aria-live="polite" data-testid="account-drawer-status">{{ statusText() }}</p>

          @if (resultText(); as message) {
            @if (held()) {
              <div class="surface-2 space-y-1 rounded-box border border-base-300 p-3" role="alert" data-testid="account-held">
                <p class="font-semibold">Not available</p>
                <p>{{ message }}</p>
                <p class="text-base-content-muted">
                  Nothing changed on this profile. Existing provider settings stay available.
                </p>
              </div>
            } @else {
              <p class="surface-2 rounded-box border border-base-300 p-3" role="alert" data-testid="account-error">
                {{ message }}
              </p>
            }
          }

          @switch (activeTab()) {
            @case ('overview') {
              <section id="account-panel-overview" role="tabpanel" aria-labelledby="account-tab-overview" class="space-y-3" data-testid="account-panel-overview">
                <dl class="space-y-2">
                  <div>
                    <dt class="text-base-content-muted">Local profile ID</dt>
                    <dd class="font-mono" data-testid="account-profile-id">{{ a.profileId }}</dd>
                  </div>
                  <div>
                    <dt class="text-base-content-muted">State</dt>
                    <dd data-testid="account-state">{{ stateCopy().heading }}</dd>
                  </div>
                </dl>
                <div class="surface-2 space-y-1 rounded-box border border-base-300 p-3">
                  <p class="font-semibold" data-testid="account-owner">Usage owner: {{ a.owner === 'verified' ? 'Verified identity' : 'Unknown owner' }}</p>
                  <p class="text-base-content-muted">
                    Owner evidence is separate from this local profile. No credential, email, organization, or directory is shown.
                  </p>
                </div>
                @if (a.activeRunCount > 0) {
                  <div class="surface-2 space-y-1 rounded-box border border-base-300 p-3" data-testid="account-run-binding">
                    <p class="font-semibold">Run binding — {{ a.activeRunCount }} current {{ a.activeRunCount === 1 ? 'run' : 'runs' }}</p>
                    <p class="text-base-content-muted">
                      Rename, default change, or sign-out does not move started work. An unavailable bound profile fails closed.
                    </p>
                  </div>
                  @if (a.state !== 'signed-in') {
                    <div class="surface-2 space-y-1 rounded-box border border-base-300 p-3" data-testid="account-resume-unavailable">
                      <p class="font-semibold">Can’t resume this run</p>
                      <p>The profile originally used by this run is unavailable or no longer proves the same identity.</p>
                      <p class="text-base-content-muted">
                        Choose neither another profile nor the current default to continue this conversation.
                      </p>
                    </div>
                  }
                } @else {
                  <p class="text-base-content-muted" data-testid="account-no-runs">No current runs are bound to this profile.</p>
                }
              </section>
            }
            @case ('access') {
              <section id="account-panel-access" role="tabpanel" aria-labelledby="account-tab-access" class="space-y-3" data-testid="account-panel-access">
                <div class="space-y-1">
                  <h3 class="text-sm font-semibold" data-testid="account-access-heading">{{ stateCopy().heading }}</h3>
                  <p class="text-base-content-muted" data-testid="account-access-detail">{{ accessDetail() }}</p>
                </div>
                @if (a.state === 'pending' && fallbackShown(); as f) {
                  <div role="group" aria-labelledby="account-fallback-title" class="surface-2 space-y-2 rounded-box border border-base-300 p-3" data-testid="account-fallback">
                    <p id="account-fallback-title" class="font-semibold">Sign in from a terminal</p>
                    <p id="account-fallback-hint" class="text-base-content-muted" data-testid="account-fallback-copy">{{ fallbackCopy }}</p>
                    <pre
                      tabindex="0"
                      aria-label="Sign-in script"
                      aria-describedby="account-fallback-hint"
                      [class]="'max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-box border border-base-300 bg-base-100 p-2 font-mono text-xs text-base-content ' + focusRing"
                      data-testid="account-fallback-script"
                    >{{ f.script }}</pre>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" [class]="'btn btn-outline btn-sm ' + focusRing" (click)="copyScript(f.script)" data-testid="account-fallback-copy-button">
                        {{ copyLabel() }}
                      </button>
                      <button type="button" [class]="'btn btn-ghost btn-sm ' + focusRing" [disabled]="busy()" (click)="refreshStatus.emit(a.profileId)" data-testid="account-fallback-check-status">
                        Check status
                      </button>
                    </div>
                    <p class="min-h-4 text-base-content-muted" role="status" aria-live="polite" data-testid="account-fallback-copy-status">{{ copyStatus() }}</p>
                  </div>
                }
                <div class="flex flex-wrap gap-2">
                  @switch (a.state) {
                    @case ('pending') {
                      <button type="button" [class]="'btn btn-outline btn-sm ' + focusRing" [disabled]="busy()" (click)="cancelSignIn.emit(a.profileId)" data-testid="account-cancel-sign-in">
                        Cancel sign-in
                      </button>
                    }
                    @case ('signed-in') {
                      <button type="button" [class]="'btn btn-error btn-outline btn-sm ' + focusRing" [disabled]="busy()" (click)="signOut.emit(a.profileId)" data-testid="account-sign-out">
                        Sign out
                      </button>
                    }
                    @default {
                      <button type="button" [class]="'btn btn-primary btn-sm ' + focusRing" [disabled]="busy()" (click)="signIn.emit(a.profileId)" data-testid="account-sign-in">
                        {{ signInLabel() }}
                      </button>
                    }
                  }
                  @if (a.state !== 'pending') {
                    <button type="button" [class]="'btn btn-ghost btn-sm ' + focusRing" [disabled]="busy()" (click)="refreshStatus.emit(a.profileId)" data-testid="account-refresh-status">
                      Refresh status
                    </button>
                  }
                </div>
              </section>
            }
            @case ('profile') {
              <section id="account-panel-profile" role="tabpanel" aria-labelledby="account-tab-profile" class="space-y-4" data-testid="account-panel-profile">
                @if (a.state === 'pending') {
                  <p class="text-base-content-muted" data-testid="account-profile-locked">
                    Finish or cancel sign-in before changing this profile.
                  </p>
                }
                <form class="space-y-2" (submit)="$event.preventDefault(); submitRename()" data-testid="account-rename-form">
                  <label for="account-rename-label" class="block font-semibold">Local label</label>
                  <input
                    id="account-rename-label"
                    type="text"
                    [class]="field"
                    [value]="draftLabel()"
                    (input)="draftLabel.set(value($event))"
                    autocomplete="off"
                    [attr.maxlength]="maxLength"
                    [disabled]="locked()"
                    aria-describedby="account-rename-hint"
                    data-testid="account-rename-input"
                  />
                  <p id="account-rename-hint" class="text-base-content-muted">{{ renameHint }}</p>
                  <button type="submit" [class]="'btn btn-primary btn-sm ' + focusRing" [disabled]="!canRename()" data-testid="account-rename-submit">
                    Save local label
                  </button>
                </form>
                <div class="flex flex-wrap gap-2">
                  <button type="button" [class]="'btn btn-outline btn-sm ' + focusRing" [disabled]="locked()" (click)="setDefault.emit(a.profileId)" data-testid="account-set-default">
                    Set as default
                  </button>
                  @if (!confirmingRemove()) {
                    <button #removeButton type="button" [class]="'btn btn-error btn-outline btn-sm ' + focusRing" [disabled]="locked()" (click)="askRemove()" data-testid="account-remove">
                      Remove profile
                    </button>
                  }
                </div>
                @if (confirmingRemove()) {
                  <div role="group" aria-labelledby="account-remove-title" class="surface-2 space-y-2 rounded-box border border-base-300 p-3" data-testid="account-remove-confirm">
                    <p id="account-remove-title" class="font-semibold">Remove local profile?</p>
                    <p data-testid="account-remove-copy">{{ removeConfirmation }}</p>
                    <div class="flex flex-wrap gap-2">
                      <button #removeCancel type="button" [class]="'btn btn-outline btn-sm ' + focusRing" (click)="cancelRemove()" data-testid="account-remove-cancel">
                        Cancel
                      </button>
                      <button type="button" [class]="'btn btn-error btn-outline btn-sm ' + focusRing" [disabled]="locked()" (click)="confirmRemove(a.profileId)" data-testid="account-remove-confirm-button">
                        Remove local profile
                      </button>
                    </div>
                  </div>
                }
              </section>
            }
          }
        </div>
      }
    </ptah-native-drawer>
  `,
})
export class AccountDetailsDrawerComponent {
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(Clipboard);

  /** Parent-owned visibility. The drawer renders only while this is true and an account is set. */
  readonly open = input.required<boolean>();
  /** The authoritative summary from the latest committed snapshot. */
  readonly account = input.required<ProviderAccountSummary | null>();
  /** The action of this profile that is in flight, if any (busy state). */
  readonly pending = input<ProviderAccountActionKind | null>(null);
  /** Refusal of this profile's last action; only its safe sentence is shown. */
  readonly result = input<ProviderAccountActionResult | null>(null);
  /** This profile's last committed action, for the matching confirmation (default toast, label saved). */
  readonly saved = input<ProviderAccountActionKind | null>(null);
  /** The host's manual sign-in script for this profile's pending sign-in, when no login window opened. */
  readonly fallback = input<ProviderAccountSignInFallback | null>(null);

  readonly refreshStatus = output<string>();
  readonly signIn = output<string>();
  /** Explicit Cancel only; closing the drawer never emits it. */
  readonly cancelSignIn = output<string>();
  readonly signOut = output<string>();
  readonly rename = output<AccountRenameIntent>();
  /** Both scopes, future unbound starts only. */
  readonly setDefault = output<string>();
  /** Emitted only after the metadata-only confirmation. */
  readonly remove = output<string>();
  /** Escape, backdrop or the close button. Never implies Cancel sign-in. */
  readonly closed = output<void>();

  protected readonly tabs = TABS;
  protected readonly focusRing = FOCUS;
  protected readonly maxLength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH;
  protected readonly renameHint = ACCOUNT_RENAME_HINT;
  protected readonly removeConfirmation = ACCOUNT_REMOVE_CONFIRMATION;
  protected readonly fallbackCopy = ACCOUNT_FALLBACK_COPY;
  protected readonly field = `input input-bordered input-sm w-full text-xs text-base-content ${FOCUS}`;

  protected readonly activeTab = signal<AccountDrawerTab>('overview');
  protected readonly draftLabel = signal('');
  protected readonly confirmingRemove = signal(false);
  /** Outcome of the last copy, tied to the script it copied so a new script starts clean. */
  private readonly copied = signal<{ readonly script: string; readonly ok: boolean } | null>(null);

  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');
  private readonly removeButton = viewChild<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly removeCancel = viewChild<ElementRef<HTMLButtonElement>>('removeCancel');

  private readonly committedLabel = computed(() => this.account()?.label);
  protected readonly isOpen = computed(() => this.open() && this.account() !== null);
  protected readonly title = computed(
    () => `Account details for ${this.account()?.label ?? ''}`.trim(),
  );
  protected readonly busy = computed(() => this.pending() !== null);
  /** Pending sign-in holds the route: only Cancel (and close) stay available. */
  protected readonly locked = computed(
    () => this.busy() || this.account()?.state === 'pending',
  );
  protected readonly stateCopy = computed(
    () => STATE_COPY[this.account()?.state ?? 'not-signed-in'],
  );
  protected readonly signInLabel = computed(
    () => SIGN_IN_LABEL[this.account()?.state ?? 'not-signed-in'],
  );
  protected readonly fallbackShown = computed(() => {
    const fallback = this.fallback();
    return fallback !== null && fallback.script.trim().length > 0 ? fallback : null;
  });
  /** U2 while the login window is open; without one, the fallback block below carries the instruction. */
  protected readonly accessDetail = computed(() =>
    this.account()?.state === 'pending' && this.fallbackShown() !== null
      ? ACCOUNT_NO_WINDOW_COPY
      : this.stateCopy().detail,
  );
  private readonly copyOutcome = computed(() => {
    const copied = this.copied();
    return copied !== null && copied.script === this.fallbackShown()?.script ? copied : null;
  });
  protected readonly copyLabel = computed(() =>
    this.copyOutcome()?.ok ? 'Copied' : 'Copy script',
  );
  protected readonly copyStatus = computed(() => {
    const outcome = this.copyOutcome();
    if (outcome === null) return '';
    return outcome.ok
      ? 'Script copied.'
      : 'Couldn’t copy. Select the script and copy it manually.';
  });
  protected readonly held = computed(() => this.result()?.code === 'release-held');
  protected readonly resultText = computed(() => {
    const result = this.result();
    if (result === null || this.busy()) return null;
    if (isSafeProviderAccountSummary(result.summary)) return result.summary;
    return result.code === 'release-held' ? ACCOUNT_HELD_FALLBACK : FALLBACK_ERROR;
  });
  protected readonly statusText = computed(() => {
    const pending = this.pending();
    if (pending !== null) return PENDING_TEXT[pending];
    switch (this.saved()) {
      case 'default':
        return ACCOUNT_DEFAULT_TOAST;
      case 'rename':
        return 'Local label saved.';
      default:
        return '';
    }
  });
  protected readonly canRename = computed(() => {
    const label = this.draftLabel().trim();
    return (
      !this.locked() &&
      isSafeProviderAccountLabel(label) &&
      label !== this.account()?.label
    );
  });

  private shownProfileId: string | null = null;

  constructor() {
    // Each open (or a different profile) starts on Overview with the committed label and no pending confirmation.
    effect(() => {
      const open = this.isOpen();
      const account = this.account();
      untracked(() => {
        const profileId = open && account ? account.profileId : null;
        if (profileId !== null && profileId !== this.shownProfileId) {
          this.activeTab.set('overview');
          this.draftLabel.set(account?.label ?? '');
          this.confirmingRemove.set(false);
        }
        this.shownProfileId = profileId;
      });
    });
    // A committed rename (new label in the snapshot) resets the field; an unrelated snapshot does not touch the draft.
    effect(() => {
      const label = this.committedLabel();
      if (label !== undefined) untracked(() => this.draftLabel.set(label));
    });
  }

  protected selectTab(tab: AccountDrawerTab): void {
    this.activeTab.set(tab);
    this.confirmingRemove.set(false);
  }

  /** WAI-ARIA tabs: arrows, Home and End move the selection and focus. */
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

  protected submitRename(): void {
    const account = this.account();
    if (!account || !this.canRename()) return;
    this.rename.emit({ profileId: account.profileId, label: this.draftLabel().trim() });
  }

  protected askRemove(): void {
    this.confirmingRemove.set(true);
    afterNextRender(() => this.removeCancel()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected cancelRemove(): void {
    this.confirmingRemove.set(false);
    afterNextRender(() => this.removeButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected confirmRemove(profileId: string): void {
    if (this.locked()) return;
    this.confirmingRemove.set(false);
    this.remove.emit(profileId);
  }

  /** Copies the script text only; the script is never logged, even when the copy fails. */
  protected copyScript(script: string): void {
    this.copied.set({ script, ok: this.clipboard.copy(script) });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
