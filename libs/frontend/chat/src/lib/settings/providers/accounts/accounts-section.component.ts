import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ProviderAccountsStateService,
  type ProviderAccountActionKind,
  type ProviderAccountActionOutcome,
  type ProviderAccountChoice,
} from '@ptah-extension/core';
import {
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
  type ProviderAccountScope,
  type ProviderAccountSelection,
  type ProviderAccountState,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import {
  AccountChooserComponent,
  type AccountChoiceIntent,
} from './account-chooser.component';
import {
  ACCOUNT_DEFAULT_TOAST,
  AccountDetailsDrawerComponent,
  type AccountRenameIntent,
} from './account-details-drawer.component';
import { AddAccountDialogComponent } from './add-account-dialog.component';

/** Claude first (plan :249); Codex joins this same section after its Phase 2 contract. */
const PROVIDER = 'claude' as const;

/** Design §3.5 status text. Only the `signed-in` host state is ever shown as signed in. */
const STATE_LABEL: Readonly<Record<ProviderAccountState, string>> = {
  'not-signed-in': 'Not signed in',
  pending: 'Signing in…',
  cancelled: 'Sign-in cancelled',
  failed: 'Sign-in failed',
  disconnected: 'Disconnected',
  'signed-in': 'Signed in',
  'signed-out': 'Signed out',
};
/** States that need attention get the 4px spine (design §3.3). */
const ATTENTION: ReadonlySet<ProviderAccountState> = new Set([
  'failed',
  'disconnected',
]);

const SCOPE_COPY: Readonly<
  Record<
    ProviderAccountScope,
    { readonly title: string; readonly sentence: string; readonly badge: string }
  >
> = {
  main: {
    title: 'Next main session',
    sentence: 'Applies to a new session only.',
    badge: 'Next main',
  },
  lane: {
    title: 'Next Claude lane',
    sentence: 'Applies when a Claude lane is spawned.',
    badge: 'Next lane',
  },
};
export const ACCOUNT_API_NOTE =
  'Used only when Claude sign-in is the main route. A provider you chose stays in effect, and running sessions keep their account.';
const FALLBACK_ERROR = 'This action did not complete. Refresh and try again.';
const UNCONFIRMED =
  'This action may not have completed. Accounts were reloaded.';

interface RoutingCell {
  readonly scope: ProviderAccountScope;
  readonly title: string;
  readonly sentence: string;
  readonly name: string;
  readonly status: string;
  readonly suffix: string;
  readonly initials: string;
}

interface AccountCard {
  readonly account: ProviderAccountSummary;
  readonly initials: string;
  readonly status: string;
  readonly signedIn: boolean;
  readonly attention: boolean;
  readonly badges: readonly string[];
}

/** The drawer's one in-flight or last-settled action, for the profile it shows. */
interface DrawerAction {
  readonly profileId: string;
  readonly kind: ProviderAccountActionKind;
  readonly status: 'pending' | 'saved' | 'failed';
  readonly result: ProviderAccountActionResult | null;
}

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function suffix(profileId: string): string {
  return `…${profileId.slice(-4)}`;
}

/**
 * Settings → Providers → Accounts (design §2–§3, plan :249-257). Electron only: it renders nothing while the
 * account state owner is inert, so other hosts never see it and no RPC is made.
 *
 * Composition only: every read and write goes through `ProviderAccountsStateService`; rows come from the host
 * snapshot, never from an optimistic copy. The two routing cells write their own scope (`setSelection`) and
 * nothing else; Set as default writes both in one host transaction. The host decides at start time whether a selection applies, so a chosen API provider and an
 * in-flight run are untouched by anything here.
 */
@Component({
  selector: 'ptah-accounts-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChooserComponent,
    AccountDetailsDrawerComponent,
    AddAccountDialogComponent,
  ],
  template: `
    @if (view().status !== 'inert') {
      <section
        aria-labelledby="providers-accounts-heading"
        class="space-y-3"
        data-testid="accounts-section"
        [attr.aria-busy]="view().status === 'loading'"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0 flex-1 space-y-1">
            <h2
              id="providers-accounts-heading"
              class="text-sm font-semibold"
            >
              Accounts
            </h2>
            <p class="break-words text-xs text-base-content-muted">
              Use a named local profile for a future main session or Claude
              lane. Credentials stay local.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-primary btn-sm accounts-focus shrink-0"
            data-testid="add-account"
            [disabled]="!snapshot()"
            (click)="addOpen.set(true)"
          >
            Add Claude account
          </button>
        </div>

        @if (view().status === 'error' && !snapshot()) {
          <div
            role="alert"
            class="flex flex-wrap items-center gap-2 rounded-lg border border-error bg-base-200 px-3 py-2 text-xs text-base-content"
            data-testid="accounts-error"
          >
            <span class="min-w-0 flex-1 break-words">{{ view().error }}</span>
            <button
              type="button"
              class="btn btn-outline btn-xs accounts-focus"
              (click)="retry()"
            >
              Retry
            </button>
          </div>
        } @else if (!snapshot()) {
          <p
            class="text-xs text-base-content-muted"
            data-testid="accounts-loading"
          >
            {{
              view().status === 'idle'
                ? 'Accounts load when a workspace is open.'
                : 'Loading accounts…'
            }}
          </p>
        }

        @if (snapshot()) {
          @if (view().stale) {
            <div
              role="status"
              class="flex flex-wrap items-center gap-2 rounded-lg border border-warning bg-base-200 px-3 py-2 text-xs text-base-content"
              data-testid="accounts-stale"
            >
              <span class="min-w-0 flex-1 break-words"
                >Showing the last loaded accounts. They could not be
                refreshed.</span
              >
              <button
                type="button"
                class="btn btn-outline btn-xs accounts-focus"
                [disabled]="view().status === 'loading'"
                (click)="retry()"
              >
                Retry
              </button>
            </div>
          }

          <!-- Future routing summary: two independent scopes. -->
          <div class="accounts-summary" data-testid="accounts-summary">
            @for (cell of routing(); track cell.scope) {
              <div
                class="flex min-w-0 flex-wrap items-start gap-3 rounded-lg border border-base-300 bg-base-200 p-3"
                [attr.data-testid]="'routing-' + cell.scope"
              >
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-semibold"
                  aria-hidden="true"
                  >{{ cell.initials }}</span
                >
                <div class="min-w-0 flex-1 space-y-0.5 break-words">
                  <p class="text-xs font-semibold text-base-content-muted">
                    {{ cell.title }}
                  </p>
                  <p class="text-sm font-semibold">
                    {{ cell.name }}
                    @if (cell.suffix) {
                      <span class="font-mono text-xs text-base-content-muted">{{
                        cell.suffix
                      }}</span>
                    }
                  </p>
                  <p class="text-xs">{{ cell.status }}</p>
                  <p class="text-xs text-base-content-muted">
                    {{ cell.sentence }}
                  </p>
                  @if (cell.scope === 'main') {
                    <p class="text-xs text-base-content-muted">
                      {{ apiNote }}
                    </p>
                  }
                </div>
                <button
                  type="button"
                  class="btn btn-outline btn-sm accounts-focus shrink-0"
                  [attr.aria-label]="'Change account for ' + cell.title"
                  (click)="chooserScope.set(cell.scope)"
                >
                  Change
                </button>
              </div>
            }
          </div>

          @if (cards().length === 0) {
            <p
              class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-xs text-base-content-muted"
              data-testid="accounts-empty"
            >
              No named Claude accounts yet. The existing Claude login is used
              until you add and choose one.
            </p>
          } @else {
            <ul class="space-y-2" aria-label="Claude account profiles">
              @for (card of cards(); track card.account.profileId) {
                <li>
                  <div
                    role="button"
                    tabindex="0"
                    class="account-card accounts-focus rounded-lg border border-base-300 bg-base-100 p-3 hover:bg-base-200"
                    [class.border-l-4]="card.attention"
                    [class.border-l-error]="card.attention"
                    [attr.aria-label]="
                      'Account details for ' + card.account.label
                    "
                    [attr.data-testid]="'account-' + card.account.profileId"
                    (click)="openDrawer(card.account.profileId)"
                    (keydown)="cardKey($event, card.account.profileId)"
                  >
                    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-semibold"
                        aria-hidden="true"
                        >{{ card.initials }}</span
                      >
                      <div class="min-w-0 flex-1 break-words">
                        <p class="text-sm font-semibold">
                          {{ card.account.label }}
                        </p>
                        <p class="font-mono text-xs text-base-content-muted">
                          {{ card.account.profileId }}
                        </p>
                      </div>
                      <p class="flex items-center gap-1.5 text-xs">
                        <span
                          class="h-2 w-2 shrink-0 rounded-full"
                          [class.bg-success]="card.signedIn"
                          [class.bg-error]="card.attention"
                          [class.bg-base-content-muted]="
                            !card.signedIn && !card.attention
                          "
                          aria-hidden="true"
                        ></span>
                        {{ card.status }}
                      </p>
                    </div>
                    <div
                      class="flex min-w-0 flex-wrap items-center gap-1.5 text-xs"
                    >
                      <span class="badge badge-ghost badge-sm">{{
                        card.account.owner === 'verified'
                          ? 'Verified identity'
                          : 'Unknown owner'
                      }}</span>
                      @for (badge of card.badges; track badge) {
                        <span class="badge badge-outline badge-sm">{{
                          badge
                        }}</span>
                      }
                      @if (card.account.activeRunCount > 0) {
                        <span
                          class="badge badge-outline badge-sm"
                          data-testid="run-binding"
                          >Run binding ·
                          {{ card.account.activeRunCount }} active
                          {{
                            card.account.activeRunCount === 1 ? 'run' : 'runs'
                          }}</span
                        >
                      }
                    </div>
                    <button
                      type="button"
                      class="account-manage btn btn-outline btn-sm accounts-focus"
                      [attr.aria-label]="'Manage ' + card.account.label"
                      (click)="manage($event, card.account.profileId)"
                      (keydown)="$event.stopPropagation()"
                    >
                      Manage
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        }

        @if (toast(); as message) {
          <p
            role="status"
            class="accounts-toast rounded-md bg-neutral px-3 py-2 text-xs text-neutral-content break-words"
            data-testid="accounts-toast"
          >
            {{ message }}
          </p>
        }
      </section>

      <ptah-add-account-dialog
        [open]="addOpen()"
        [pending]="addPending()"
        [error]="addError()"
        (add)="add($event)"
        (closed)="closeAdd()"
      />
      <ptah-account-chooser
        [open]="chooserScope() !== null"
        [scope]="chooserScope() ?? 'main'"
        [accounts]="accountList()"
        [selection]="chooserSelection()"
        [pending]="chooserPending()"
        [error]="chooserError()"
        (chose)="choose($event)"
        (closed)="closeChooser()"
      />
      <ptah-account-details-drawer
        [open]="drawerProfileId() !== null"
        [account]="drawerAccount()"
        [pending]="drawerPending()"
        [result]="drawerResult()"
        [saved]="drawerSaved()"
        [fallback]="drawerFallback()"
        (refreshStatus)="refreshStatus($event)"
        (signIn)="signIn($event)"
        (cancelSignIn)="cancelSignIn($event)"
        (signOut)="signOut($event)"
        (rename)="rename($event)"
        (setDefault)="setDefault($event)"
        (remove)="remove($event)"
        (closed)="closeDrawer()"
      />
    }
  `,
  styles: [
    `
      /* Container queries: the Settings content width decides, including the ~400px Electron sidebar. */
      :host {
        display: block;
        container-type: inline-size;
        /* Dark themes: base-content. Light themes: dark neutral, never light base-content by assumption. */
        --accounts-focus-ring: oklch(var(--bc));
      }
      :host-context([data-theme-mode='light']) {
        --accounts-focus-ring: oklch(var(--n));
      }
      .accounts-focus:focus-visible {
        outline: 2px solid var(--accounts-focus-ring);
        outline-offset: 2px;
      }
      /* Under 960px the routing cells stack; from 960px they are two equal cells. */
      .accounts-summary {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(0, 1fr);
      }
      @container (min-width: 60rem) {
        .accounts-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      /* Under 640px: profile/state, then badges, then Manage, one column. From 640px Manage is a right rail
         and the metadata wraps before it. */
      .account-card {
        display: grid;
        gap: 0.5rem 0.75rem;
        grid-template-columns: minmax(0, 1fr);
        cursor: pointer;
      }
      .account-manage {
        justify-self: start;
      }
      @container (min-width: 40rem) {
        .account-card {
          grid-template-columns: minmax(0, 1fr) auto;
        }
        .account-manage {
          grid-column: 2;
          grid-row: 1 / span 2;
          align-self: center;
        }
      }
    `,
  ],
})
export class AccountsSectionComponent implements OnInit {
  private readonly accounts = inject(ProviderAccountsStateService);

  protected readonly view = this.accounts.state(PROVIDER);
  protected readonly snapshot = computed(() => this.view().snapshot);
  protected readonly accountList = computed(
    () => this.snapshot()?.accounts ?? [],
  );
  protected readonly apiNote = ACCOUNT_API_NOTE;

  protected readonly addOpen = signal(false);
  protected readonly addPending = signal(false);
  protected readonly addError = signal<ProviderAccountActionResult | null>(
    null,
  );
  protected readonly chooserScope = signal<ProviderAccountScope | null>(null);
  protected readonly chooserPending = signal(false);
  protected readonly chooserError = signal<string | null>(null);
  protected readonly drawerProfileId = signal<string | null>(null);
  private readonly drawerAction = signal<DrawerAction | null>(null);
  protected readonly toast = signal<string | null>(null);

  protected readonly routing = computed<readonly RoutingCell[]>(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return [];
    return (['main', 'lane'] as const).map((scope) =>
      this.cell(scope, snapshot.selections[scope].selection),
    );
  });

  protected readonly cards = computed<readonly AccountCard[]>(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return [];
    const named = (scope: ProviderAccountScope): string | null => {
      const selection = snapshot.selections[scope].selection;
      return selection.kind === 'named' ? selection.profileId : null;
    };
    const main = named('main');
    const lane = named('lane');
    return snapshot.accounts.map((account) => ({
      account,
      initials: initials(account.label),
      status: STATE_LABEL[account.state],
      signedIn: account.state === 'signed-in',
      attention: ATTENTION.has(account.state),
      badges: [
        ...(main === account.profileId ? [SCOPE_COPY.main.badge] : []),
        ...(lane === account.profileId ? [SCOPE_COPY.lane.badge] : []),
      ],
    }));
  });

  protected readonly chooserSelection = computed<ProviderAccountSelection>(
    () =>
      this.snapshot()?.selections[this.chooserScope() ?? 'main'].selection ?? {
        kind: 'omitted',
      },
  );

  protected readonly drawerAccount = computed(() => {
    const id = this.drawerProfileId();
    return id === null
      ? null
      : (this.accountList().find((account) => account.profileId === id) ??
          null);
  });
  private readonly fallbacks = this.accounts.fallbacks(PROVIDER);
  /** Manual sign-in script for the open account; the drawer renders it as text only. */
  protected readonly drawerFallback = computed(() => {
    const id = this.drawerProfileId();
    return id === null ? null : (this.fallbacks()[id] ?? null);
  });
  private readonly shownAction = computed(() => {
    const action = this.drawerAction();
    return action && action.profileId === this.drawerProfileId()
      ? action
      : null;
  });
  protected readonly drawerPending = computed(() => {
    const action = this.shownAction();
    return action?.status === 'pending' ? action.kind : null;
  });
  protected readonly drawerResult = computed(() => {
    const action = this.shownAction();
    return action?.status === 'failed' ? action.result : null;
  });
  /** The default toast is the section's; the drawer confirms only its own rename. */
  protected readonly drawerSaved = computed(() => {
    const action = this.shownAction();
    return action?.status === 'saved' && action.kind === 'rename'
      ? action.kind
      : null;
  });

  ngOnInit(): void {
    void this.accounts.open(PROVIDER);
  }

  protected retry(): void {
    void this.accounts.refresh(PROVIDER);
  }

  // --- cards ----------------------------------------------------------------

  protected openDrawer(profileId: string): void {
    if (this.drawerProfileId() !== profileId) this.drawerAction.set(null);
    this.drawerProfileId.set(profileId);
  }

  /** The card is a keyboard button; keys from the nested Manage button never reach here. */
  protected cardKey(event: KeyboardEvent, profileId: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openDrawer(profileId);
  }

  /** Nested Manage: one open, never a second one from the card's click. */
  protected manage(event: Event, profileId: string): void {
    event.stopPropagation();
    this.openDrawer(profileId);
  }

  /** Closing never cancels a sign-in; Cancel is explicit. */
  protected closeDrawer(): void {
    this.drawerProfileId.set(null);
  }

  // --- add ------------------------------------------------------------------

  protected async add(label: string): Promise<void> {
    this.addPending.set(true);
    this.addError.set(null);
    this.toast.set(null);
    const outcome = await this.accounts.addAccount(PROVIDER, label);
    this.addPending.set(false);
    if (outcome.status === 'failed') {
      this.addError.set(outcome.result);
      return;
    }
    this.addOpen.set(false);
    this.toast.set(
      outcome.status === 'saved'
        ? 'Profile added. It is not selected for any route.'
        : this.unsettled(outcome),
    );
  }

  protected closeAdd(): void {
    if (this.addPending()) return;
    this.addOpen.set(false);
    this.addError.set(null);
  }

  // --- routing --------------------------------------------------------------

  /** Writes only the scope the chooser was opened for. */
  protected async choose(intent: AccountChoiceIntent): Promise<void> {
    this.chooserPending.set(true);
    this.chooserError.set(null);
    this.toast.set(null);
    const outcome = await this.accounts.setSelection(
      PROVIDER,
      intent.scope,
      intent.choice,
    );
    this.chooserPending.set(false);
    if (outcome.status === 'failed') {
      this.chooserError.set(this.safe(outcome.result));
      return;
    }
    this.chooserScope.set(null);
    const copy = SCOPE_COPY[intent.scope];
    this.toast.set(
      outcome.status === 'saved'
        ? `${copy.title} account saved. ${copy.sentence}`
        : this.unsettled(outcome),
    );
  }

  protected closeChooser(): void {
    if (this.chooserPending()) return;
    this.chooserScope.set(null);
    this.chooserError.set(null);
  }

  // --- drawer actions -------------------------------------------------------

  protected refreshStatus(profileId: string): void {
    void this.accounts.refreshAccountStatus(PROVIDER, profileId);
  }

  protected signIn(profileId: string): Promise<void> {
    return this.run('sign-in', profileId, () =>
      this.accounts.startSignIn(PROVIDER, profileId),
    );
  }

  protected cancelSignIn(profileId: string): Promise<void> {
    return this.run('cancel-sign-in', profileId, () =>
      this.accounts.cancelSignIn(PROVIDER, profileId),
    );
  }

  protected signOut(profileId: string): Promise<void> {
    return this.run('sign-out', profileId, () =>
      this.accounts.signOut(PROVIDER, profileId),
    );
  }

  protected rename(intent: AccountRenameIntent): Promise<void> {
    return this.run('rename', intent.profileId, () =>
      this.accounts.renameAccount(PROVIDER, intent.profileId, intent.label),
    );
  }

  protected setDefault(profileId: string): Promise<void> {
    const choice: ProviderAccountChoice = { kind: 'named', profileId };
    return this.run(
      'default',
      profileId,
      () => this.accounts.setDefault(PROVIDER, choice),
      ACCOUNT_DEFAULT_TOAST,
    );
  }

  protected remove(profileId: string): Promise<void> {
    return this.run(
      'remove',
      profileId,
      () => this.accounts.removeAccount(PROVIDER, profileId),
      'Local profile metadata removed.',
    );
  }

  private async run(
    kind: ProviderAccountActionKind,
    profileId: string,
    write: () => Promise<ProviderAccountActionOutcome>,
    savedToast: string | null = null,
  ): Promise<void> {
    this.toast.set(null);
    this.drawerAction.set({ profileId, kind, status: 'pending', result: null });
    const outcome = await write();
    if (outcome.status === 'saved' || outcome.status === 'failed') {
      this.drawerAction.set({
        profileId,
        kind,
        status: outcome.status,
        result: outcome.status === 'failed' ? outcome.result : null,
      });
      if (outcome.status === 'saved' && savedToast) this.toast.set(savedToast);
      return;
    }
    this.drawerAction.set(null);
    this.toast.set(this.unsettled(outcome));
  }

  // --------------------------------------------------------------------------

  private cell(
    scope: ProviderAccountScope,
    selection: ProviderAccountSelection,
  ): RoutingCell {
    const copy = SCOPE_COPY[scope];
    const base = { scope, title: copy.title, sentence: copy.sentence };
    if (selection.kind !== 'named') {
      return {
        ...base,
        name: 'Use existing default',
        status: 'Existing Claude login',
        suffix: '',
        initials: 'CL',
      };
    }
    const account = this.accountList().find(
      (row) => row.profileId === selection.profileId,
    );
    return {
      ...base,
      name: account?.label ?? 'Unavailable profile',
      status: account
        ? STATE_LABEL[account.state]
        : 'This profile is no longer available.',
      suffix: suffix(selection.profileId),
      initials: account ? initials(account.label) : '?',
    };
  }

  private safe(result: ProviderAccountActionResult): string {
    return isSafeProviderAccountSummary(result.summary)
      ? result.summary
      : FALLBACK_ERROR;
  }

  private unsettled(
    outcome: Extract<
      ProviderAccountActionOutcome,
      { status: 'unconfirmed' | 'unavailable' }
    >,
  ): string {
    return outcome.status === 'unconfirmed' ? UNCONFIRMED : FALLBACK_ERROR;
  }
}
