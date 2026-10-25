import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import type { ProviderAccountChoice } from '@ptah-extension/core';
import {
  isSafeProviderAccountSummary,
  type ProviderAccountScope,
  type ProviderAccountSelection,
  type ProviderAccountState,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import { NativeModalComponent } from '@ptah-extension/ui';

/** What the chooser asks for: one choice, for the one scope it was opened for. */
export interface AccountChoiceIntent {
  readonly scope: ProviderAccountScope;
  readonly choice: ProviderAccountChoice;
}

interface ChooserRow {
  readonly profileId: string;
  readonly label: string;
  readonly status: string;
  readonly suffix: string;
  readonly signedIn: boolean;
  readonly current: boolean;
}

/** Design §3.5 status text. Only the `signed-in` input state is ever shown as signed in. */
const STATE_LABEL: Readonly<Record<ProviderAccountState, string>> = {
  'not-signed-in': 'Not signed in',
  pending: 'Signing in…',
  cancelled: 'Sign-in cancelled',
  failed: 'Sign-in failed',
  disconnected: 'Disconnected',
  'signed-in': 'Signed in',
  'signed-out': 'Signed out',
};
const TITLE: Readonly<Record<ProviderAccountScope, string>> = {
  main: 'Choose account for next main session',
  lane: 'Choose account for next Claude lane',
};
const SIGN_IN_FIRST = 'Sign in before using this profile.';
const PENDING = 'Saving selection…';
const FALLBACK_ERROR = 'This action did not complete. Refresh and try again.';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Controlled account chooser for one future route (design §3.2, plan :250).
 * The parent owns visibility (`open`), the authoritative profiles and the scope's stored selection; the chooser only
 * emits what was picked. **Use existing default** is always the first, enabled option and never implies a profile.
 * Signed-in profiles come first, then every other named profile with its state; a named profile that is not signed in
 * can be chosen for a future run, and says it must sign in before use. Nothing here signs in, writes, or reads.
 * On the shared `NativeModalComponent`; the opener gets focus back when the parent closes the chooser.
 */
@Component({
  selector: 'ptah-account-chooser',
  standalone: true,
  imports: [NativeModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-modal
      data-glass-surface="overlay"
      [isOpen]="open()"
      ariaLabelledby="account-chooser-title"
      size="md"
      (closed)="closed.emit()"
    >
      <div
        modal-header
        class="surface-3 -mx-6 -mt-6 mb-4 space-y-1 border-b px-5 py-3"
        data-testid="account-chooser"
      >
        <h2
          id="account-chooser-title"
          class="text-sm font-bold text-base-content"
        >
          {{ title() }}
        </h2>
        <p class="text-xs text-base-content-muted">
          This changes only the selected future route.
        </p>
      </div>

      <div class="space-y-2 text-xs" role="group" aria-labelledby="account-chooser-title">
        <button
          type="button"
          [class]="option"
          [disabled]="pending()"
          [attr.aria-current]="ambientCurrent() ? 'true' : null"
          (click)="choose({ kind: 'ambient' })"
          data-testid="account-chooser-ambient"
        >
          <span class="flex min-w-0 flex-col items-start gap-0.5">
            <strong class="text-base-content">Use existing default</strong>
            <span class="font-normal text-base-content-muted"
              >Existing runner resolution</span
            >
          </span>
          @if (ambientCurrent()) {
            <span class="badge badge-outline badge-xs ml-auto">Current</span>
          }
        </button>

        @for (row of rows(); track row.profileId) {
          <button
            type="button"
            [class]="option"
            [disabled]="pending()"
            [attr.aria-current]="row.current ? 'true' : null"
            (click)="choose({ kind: 'named', profileId: row.profileId })"
            [attr.data-testid]="'account-chooser-option-' + row.profileId"
          >
            <span class="flex min-w-0 flex-col items-start gap-0.5">
              <strong class="truncate text-base-content">{{ row.label }}</strong>
              <span class="font-normal text-base-content-muted"
                >{{ row.status }} · {{ row.suffix }}</span
              >
              @if (!row.signedIn) {
                <span class="font-normal text-base-content-muted">{{
                  signInFirst
                }}</span>
              }
            </span>
            @if (row.current) {
              <span class="badge badge-outline badge-xs ml-auto">Current</span>
            }
          </button>
        } @empty {
          <p
            class="text-base-content-muted"
            data-testid="account-chooser-empty"
          >
            No named Claude accounts yet.
          </p>
        }

        <p
          class="text-base-content"
          aria-live="polite"
          role="status"
          data-testid="account-chooser-status"
        >
          {{ pending() ? pendingText : '' }}
        </p>
        @if (errorText(); as message) {
          <p
            role="alert"
            class="text-base-content"
            data-testid="account-chooser-error"
          >
            {{ message }}
          </p>
        }
      </div>

      <div modal-footer class="modal-action">
        <button
          type="button"
          [class]="'btn btn-outline btn-sm ' + focusRing"
          (click)="closed.emit()"
          data-testid="account-chooser-cancel"
        >
          Cancel
        </button>
      </div>
    </ptah-native-modal>
  `,
})
export class AccountChooserComponent {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Parent-owned visibility. */
  readonly open = input.required<boolean>();
  /** Which future route this chooser writes: next main session or next Claude lane. */
  readonly scope = input.required<ProviderAccountScope>();
  /** Authoritative profiles from the host snapshot, in host order. */
  readonly accounts = input.required<readonly ProviderAccountSummary[]>();
  /** The scope's stored selection; `omitted` and `ambient` both mean Use existing default. */
  readonly selection = input.required<ProviderAccountSelection>();
  /** A selection write for this scope is in flight. */
  readonly pending = input(false);
  /** Safe result sentence of a failed selection write; unsafe text is replaced by fixed copy. */
  readonly error = input<string | null>(null);

  /** The user picked a choice for this scope. The parent writes it and closes the chooser. */
  readonly chose = output<AccountChoiceIntent>();
  /** Cancel, Escape or backdrop. */
  readonly closed = output<void>();

  protected readonly option = `btn btn-outline btn-sm h-auto min-h-10 w-full flex-nowrap justify-start gap-2 py-2 text-left normal-case ${FOCUS}`;
  protected readonly focusRing = FOCUS;
  protected readonly signInFirst = SIGN_IN_FIRST;
  protected readonly pendingText = PENDING;

  protected readonly title = computed(() => TITLE[this.scope()]);
  protected readonly ambientCurrent = computed(
    () => this.selection().kind !== 'named',
  );
  protected readonly rows = computed<readonly ChooserRow[]>(() => {
    const selection = this.selection();
    const selectedId = selection.kind === 'named' ? selection.profileId : null;
    const toRow = (account: ProviderAccountSummary): ChooserRow => ({
      profileId: account.profileId,
      label: account.label,
      status: STATE_LABEL[account.state],
      suffix: account.profileId.slice(-4),
      signedIn: account.state === 'signed-in',
      current: account.profileId === selectedId,
    });
    const accounts = this.accounts();
    return [
      ...accounts.filter((a) => a.state === 'signed-in'),
      ...accounts.filter((a) => a.state !== 'signed-in'),
    ].map(toRow);
  });
  protected readonly errorText = computed(() => {
    const error = this.error();
    if (error === null || this.pending()) return null;
    return isSafeProviderAccountSummary(error) ? error : FALLBACK_ERROR;
  });

  private opener: HTMLElement | null = null;
  private wasOpen = false;

  constructor() {
    // Opener restore: captured when the parent opens the chooser, refocused when it closes it (cancel or success).
    effect(() => {
      const open = this.open();
      untracked(() => {
        if (open && !this.wasOpen) this.opener = this.focusedOutside();
        if (!open && this.wasOpen) {
          const opener = this.opener;
          this.opener = null;
          if (opener?.isConnected) opener.focus();
        }
        this.wasOpen = open;
      });
    });
  }

  protected choose(choice: ProviderAccountChoice): void {
    if (this.pending()) return;
    this.chose.emit({ scope: this.scope(), choice });
  }

  private focusedOutside(): HTMLElement | null {
    const active = this.document.activeElement;
    if (!(active instanceof HTMLElement) || active === this.document.body)
      return null;
    return this.host.nativeElement.contains(active) ? null : active;
  }
}
